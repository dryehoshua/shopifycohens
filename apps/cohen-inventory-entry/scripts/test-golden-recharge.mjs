import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const databasePath = join(mkdtempSync(join(tmpdir(), 'gold-recharge-')), 'test.sqlite');
const sqlite = new DatabaseSync(databasePath);
for (const name of readdirSync('prisma/migrations').filter(name => /^\d/.test(name)).sort()) sqlite.exec(readFileSync(resolve('prisma/migrations', name, 'migration.sql'), 'utf8'));
sqlite.close();
Object.assign(process.env, { DATABASE_URL: `file:${databasePath.replaceAll('\\', '/')}`, NEKUDOT_TOKEN_SECRET: 'test-card-only', MERCADOPAGO_ACCESS_TOKEN: 'test-only', MERCADOPAGO_WEBHOOK_SECRET: 'test-webhook', SHOPIFY_APP_URL: 'https://example.test' });
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', plugins: [{ name: 'mock-shopify', enforce: 'pre',
  resolveId(id) { if (/\/shopify\.server(?:\.ts)?$/.test(id)) return '\0mock-shopify'; },
  load(id) { if (id === '\0mock-shopify') return 'export const unauthenticated = {admin: async () => ({admin: {graphql: async () => ({json: async () => ({data: {tagsAdd: {userErrors: []}, tagsRemove: {userErrors: []}}})})}})};'; },
}] });
const { default: db } = await vite.ssrLoadModule('/app/db.server.ts');
const { processMercadoPagoWebhook: handle, memberCardData } = await vite.ssrLoadModule('/app/nekudot-registration.server.ts');
const originalFetch = globalThis.fetch;
let paymentId = 100;
globalThis.fetch = async (url) => Response.json(String(url).includes('/preapproval/')
  ? { id: 'sub', status: 'authorized', auto_recurring: { transaction_amount: 300, currency_id: 'MXN' } }
  : String(url).includes('/authorized_payments/') ? { preapproval_id: 'sub', payment: { id: paymentId } }
  : { id: paymentId, status: 'approved', external_reference: 'gold-ref', transaction_amount: 300, currency_id: 'MXN' });
function request(type) {
  const ts = '123456';
  const signature = createHmac('sha256', 'test-webhook').update(`id:${paymentId};request-id:test;ts:${ts};`).digest('hex');
  return new Request(`https://example.test/webhooks/mercadopago?data.id=${paymentId}`, { method: 'POST', headers: { 'x-request-id': 'test', 'x-signature': `ts=${ts},v1=${signature}` }, body: JSON.stringify({ type, data: { id: paymentId } }) });
}
try {
  const member = await db.nekudotMember.create({ data: { displayName: 'Gold Test', cardTier: 'BLUE', balanceCents: 1000, email: 'test@example.test' } });
  await db.nekudotCustomerIdentity.create({ data: { memberId: member.id, shop: 'test.myshopify.com', shopifyCustomerId: 'gid://shopify/Customer/1', shopifyLegacyCustomerId: '1', displayName: 'Gold Test' } });
  await db.communityVoucherWallet.create({ data: { memberId: member.id, balanceCents: 2000 } });
  await db.nekudotMembershipPayment.create({ data: { memberId: member.id, externalReference: 'gold-ref', subscriptionId: 'sub', amountCents: 30000 } });
  const before = await memberCardData(member.id);
  const previousIds = before.credentials.map(item => item.id);
  await handle(request('payment'));
  await handle(request('subscription_authorized_payment'));
  assert.equal((await db.nekudotMember.findUnique({ where: { id: member.id } })).balanceCents, 31000);
  assert.equal(await db.nekudotLedgerEntry.count({ where: { memberId: member.id, type: 'GOLDEN_RECHARGE' } }), 1);
  const after = await memberCardData(member.id);
  assert.notEqual(after.cardNumber, before.cardNumber);
  assert.equal(await db.nekudotCredential.count({ where: { id: { in: previousIds }, active: true } }), 0);
  assert.equal(after.credentials.length, 2);
  paymentId = 101;
  await handle(request('subscription_authorized_payment'));
  await handle(request('payment'));
  assert.equal((await memberCardData(member.id)).balanceCents, 61000);
  assert.equal(await db.nekudotLedgerEntry.count({ where: { memberId: member.id, type: 'GOLDEN_RECHARGE' } }), 2);
  const voucher = await db.communityVoucherWallet.findUnique({ where: { memberId: member.id } });
  assert.equal(voucher.balanceCents, 2000);
  assert.equal(voucher.status, 'ACTIVE');
  console.log('PASS: real SQLite transactions, 300 Nekudot per collected payment, invoice/payment deduplication, renewal, old card revocation, new Gold card, preserved vouchers.');
} finally { globalThis.fetch = originalFetch; await db.$disconnect(); await vite.close(); }
