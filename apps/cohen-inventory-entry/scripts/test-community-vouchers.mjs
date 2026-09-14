import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const directory = mkdtempSync(join(tmpdir(), 'cohens-vouchers-'));
const databasePath = join(directory, 'test.sqlite');
const sqlite = new DatabaseSync(databasePath);
const migrations = resolve('prisma/migrations');
for (const name of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) {
  sqlite.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'));
}
sqlite.close();
process.env.DATABASE_URL = `file:${databasePath.replaceAll('\\', '/')}`;
process.env.NEKUDOT_TOKEN_SECRET = 'local-voucher-test-only';
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const { default: db } = await vite.ssrLoadModule('/app/db.server.ts');
const wallet = await vite.ssrLoadModule('/app/community-wallet.server.ts');
const rewards = await vite.ssrLoadModule('/app/nekudot.server.ts');
const shop = 'voucher-test.myshopify.com';
const customerId = 'gid://shopify/Customer/123';
const admin = { graphql: async () => ({ json: async () => ({ data: { customer: { id: customerId, legacyResourceId: '123', displayName: 'Cliente de prueba', defaultEmailAddress: null } } }) }) };
try {
  const member = await rewards.bindNekudotCredential({ admin, shop, customerId, rawToken: 'TEST-NFC-1234', cardTier: 'VOUCHER' });
  const voucher = await wallet.communityVoucherForMember(member.id);
  assert.ok(voucher, 'Asignar tarjeta de vales crea su cartera');
  assert.equal((await rewards.lookupNekudotMember(shop, `COHENS:VALES:${voucher.id}`)).id, member.id);
  await assert.rejects(rewards.lookupNekudotMember('other.myshopify.com', `COHENS:VALES:${voucher.id}`));
  await wallet.loadCommunityVoucherFund({ amount: '100', actor: 'Prueba', idempotencyKey: 'test:fund:load:0001' });
  await wallet.loadCommunityVoucherFund({ amount: '100', actor: 'Prueba', idempotencyKey: 'test:fund:load:0001' });
  assert.equal((await wallet.communityVoucherFundSummary()).balanceCents, 10000);
  await assert.rejects(wallet.loadCommunityVoucherFund({ amount: '200', actor: 'Prueba', idempotencyKey: 'test:fund:load:0001' }));
  const allocation = { memberId: member.id, amount: '60', actor: 'Prueba', idempotencyKey: 'test:allocate:0001' };
  await wallet.allocateCommunityVoucher(allocation);
  await wallet.allocateCommunityVoucher(allocation);
  assert.equal((await wallet.communityVoucherFundSummary()).balanceCents, 4000);
  assert.equal((await wallet.communityVoucherForMember(member.id)).balanceCents, 6000);
  await assert.rejects(wallet.allocateCommunityVoucher({ ...allocation, amount: '50', idempotencyKey: 'test:allocate:0002' }));
  const reserveInput = { shop, memberId: member.id, amount: '20', cartReference: 'test-cart', idempotencyKey: 'test:reserve:0001' };
  const reservation = await wallet.reserveCommunityVoucher(reserveInput);
  assert.equal((await wallet.reserveCommunityVoucher(reserveInput)).id, reservation.id);
  assert.equal((await wallet.communityVoucherForMember(member.id)).availableCents, 4000);
  await assert.rejects(wallet.reserveCommunityVoucher({ ...reserveInput, amount: '30' }));
  const order = { shop, shopifyOrderId: 'gid://shopify/Order/123', orderName: '#TEST123', customerId, currencyCode: 'MXN', eligibleFinancialStatus: true, cancelled: false, orderUpdatedAt: new Date('2026-09-14T12:00:00Z'), purchaseCents: 10000, customAttributes: [{ key: 'community_voucher_redemption_id', value: reservation.id }] };
  await rewards.reconcileNekudotOrder(order);
  await rewards.reconcileNekudotOrder(order);
  assert.equal((await wallet.communityVoucherForMember(member.id)).balanceCents, 4000);
  assert.equal((await wallet.communityVoucherForMember(member.id)).reservedCents, 0);
  await rewards.reconcileNekudotOrder({ ...order, cancelled: true, orderUpdatedAt: new Date('2026-09-14T13:00:00Z') });
  await rewards.reconcileNekudotOrder({ ...order, cancelled: true, orderUpdatedAt: new Date('2026-09-14T13:00:00Z') });
  assert.equal((await wallet.communityVoucherForMember(member.id)).balanceCents, 6000);
  await db.communityVoucherWallet.update({ where: { id: voucher.id }, data: { status: 'SUSPENDED' } });
  await assert.rejects(wallet.allocateCommunityVoucher({ ...allocation, amount: '1', idempotencyKey: 'test:suspended:0001' }));
  await assert.rejects(rewards.lookupNekudotMember(shop, `COHENS:VALES:${voucher.id}`));
  await assert.rejects(wallet.loadCommunityVoucherFund({ amount: '999999999999999999', actor: 'Prueba', idempotencyKey: 'test:overflow:0001' }));
  console.log('PASS: migrations, NFC activation, voucher QR, shop isolation, fund load, allocation, insufficient funds, reservation, idempotency, sale redemption, cancellation/refund, suspended cards, amount limits.');
} finally {
  await db.$disconnect();
  await vite.close();
}
