import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'vite';

process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-only';
process.env.MERCADOPAGO_WEBHOOK_SECRET = 'test-secret';
process.env.SHOPIFY_APP_URL = 'https://example.test';
let state;
globalThis.__goldDb = {
  nekudotMembershipPayment: {
    findUnique: async () => state.record,
    findFirst: async () => state.record,
    create: async (args) => { if (state.record) throw new Error('unique'); state.record = { ...args.data }; return state.record; },
    update: async (args) => { state.payments.push(args.data); Object.assign(state.record, args.data); return args.data; },
  },
  nekudotMember: {
    findUnique: async () => state.member,
    findUniqueOrThrow: async () => state.member,
    update: async (args) => { state.members.push(args.data); for (const [key, value] of Object.entries(args.data)) state.member[key] = value && typeof value === 'object' && 'increment' in value ? state.member[key] + value.increment : value; return state.member; },
  },
  nekudotLedgerEntry: {
    findUnique: async ({ where }) => state.ledger.find((item) => item.idempotencyKey === where.programKey_idempotencyKey.idempotencyKey),
    create: async ({ data }) => { state.ledger.push(data); return data; },
  },
  nekudotPortalSession: { findUnique: async () => state.session, update: async () => ({}) },
  nekudotCredential: { updateMany: async (args) => { state.revocations.push(args); return { count: 2 }; } },
  $transaction: async (operations) => typeof operations === 'function' ? operations(globalThis.__goldDb) : Promise.all(operations),
};
globalThis.__goldAdmin = { graphql: async () => ({ json: async () => ({ data: { tagsAdd: { userErrors: [] }, tagsRemove: { userErrors: [] } } }) }) };
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', plugins: [{
  name: 'gold-test-services',
  enforce: 'pre',
  resolveId(id) {
    if (/\/db\.server(?:\.ts)?$/.test(id)) return '\0gold-db';
    if (/\/shopify\.server(?:\.ts)?$/.test(id)) return '\0gold-shopify';
  },
  load(id) {
    if (id === '\0gold-db') return 'export default globalThis.__goldDb;';
    if (id === '\0gold-shopify') return 'export const unauthenticated = { admin: async () => ({admin: globalThis.__goldAdmin}) };';
  },
}] });
const originalFetch = globalThis.fetch;
function reset(overrides = {}) {
  state = {
    record: { id: 'membership-payment', memberId: 'member', subscriptionId: 'sub', amountCents: 30000, currencyCode: 'MXN', member: { identities: [{ shop: 'test.myshopify.com', shopifyCustomerId: 'gid://shopify/Customer/1' }] } },
    invoice: { preapproval_id: 'sub', payment: { id: 123 } },
    payment: { id: 123, status: 'approved', external_reference: 'gold-ref', transaction_amount: 300, currency_id: 'MXN' },
    subscription: { id: 'sub', status: 'authorized', auto_recurring: { transaction_amount: 300, currency_id: 'MXN' } },
    member: { id: 'member', cardTier: 'BLUE', active: true, enrollmentStatus: 'ACTIVE', balanceCents: 50000, email: 'test@example.test' },
    payments: [], members: [], requests: [], revocations: [], ledger: [], ...overrides,
  };
}
globalThis.fetch = async (url, options) => {
  state.requests.push(String(url));
  if (String(url).endsWith('/preapproval')) {
    state.createdSubscription = JSON.parse(options.body);
    return Response.json({ id: 'sub-new', status: 'pending', init_point: 'https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=sub-new' });
  }
  const data = String(url).includes('/authorized_payments/') ? state.invoice : String(url).includes('/v1/payments/') ? state.payment : state.subscription;
  return Response.json(data);
};
function request(type = 'subscription_authorized_payment', valid = true) {
  const ts = String(Date.now());
  const signature = createHmac('sha256', 'test-secret').update(`id:123;request-id:test-request;ts:${ts};`).digest('hex');
  return new Request('https://example.test/webhooks/mercadopago?data.id=123', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-request', 'x-signature': `ts=${ts},v1=${valid ? signature : '0'.repeat(64)}` }, body: JSON.stringify({ type, data: { id: 123 } }) });
}
try {
  const { processMercadoPagoWebhook: handle, startGoldenSubscription, portalMemberFromToken } = await vite.ssrLoadModule('/app/nekudot-registration.server.ts');
  reset();
  assert.equal(await portalMemberFromToken('invalid'), null);
  state.session = { member: state.member, expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date(), revokedAt: null };
  assert.equal((await portalMemberFromToken('a'.repeat(43))).id, 'member');
  state.session.revokedAt = new Date();
  assert.equal(await portalMemberFromToken('a'.repeat(43)), null);
  state.session.revokedAt = null;
  state.session.expiresAt = new Date(0);
  assert.equal(await portalMemberFromToken('a'.repeat(43)), null);
  reset({ record: null });
  const checkout = await startGoldenSubscription('member');
  assert.equal(state.createdSubscription.back_url, 'https://cohenskosher.com/apps/nekudot?subscription=return');
  assert.deepEqual(state.createdSubscription.auto_recurring, { frequency: 1, frequency_type: 'months', transaction_amount: 300, currency_id: 'MXN' });
  assert.equal(state.member.cardTier, 'BLUE', 'Opening checkout preserves the existing card');
  assert.equal(state.revocations.length, 0);
  assert.equal(await startGoldenSubscription('member'), checkout);
  assert.equal(state.requests.length, 1, 'Repeated requests reuse the pending subscription');
  state.member.cardTier = 'GOLDEN';
  await assert.rejects(startGoldenSubscription('member'), (error) => error.status === 409);
  reset();
  assert.deepEqual(await handle(request()), { approved: true });
  assert.equal(state.member.active, true);
  assert.equal(state.payments[0].paymentId, '123');
  assert.equal(state.requests.length, 3);
  assert.equal(state.revocations[0].data.revokedReason, 'REPLACED_BY_GOLDEN');
  assert.equal(state.member.balanceCents, 80000);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0].type, 'GOLDEN_RECHARGE');
  assert.equal(state.member.brokerId, null);
  await handle(request());
  assert.equal(state.revocations.length, 1, 'Renewal must preserve the Golden card');
  await handle(request('payment'));
  assert.equal(state.member.balanceCents, 80000, 'Payment and invoice webhooks credit only once');
  state.payment.id = 124;
  state.invoice.payment.id = 124;
  await handle(request());
  assert.equal(state.member.balanceCents, 110000, 'Next paid month buys another 300 Nekudot');
  reset();
  state.member.cardTier = 'SILVER';
  await handle(request('subscription_preapproval'));
  assert.equal(state.revocations.length, 1, 'Subscription activation revokes Silver');
  assert.equal(state.ledger.length, 0, 'Authorization alone is not a collected payment');
  reset();
  state.member.cardTier = 'VOUCHER';
  await handle(request());
  assert.equal(state.revocations.length, 0, 'Voucher credentials remain valid');
  reset();
  state.invoice.payment = {};
  assert.deepEqual(await handle(request()), { approved: false, status: 'SCHEDULED' });
  assert.equal(state.members.length, 0);
  reset();
  state.payment.transaction_amount = 30;
  await assert.rejects(handle(request()), (error) => error.status === 409);
  assert.equal(state.members.length, 0);
  reset();
  state.payment.currency_id = 'USD';
  await assert.rejects(handle(request()), (error) => error.status === 409);
  reset();
  state.subscription.status = 'cancelled';
  assert.equal((await handle(request('payment'))).approved, false);
  assert.equal(state.revocations.length, 0);
  assert.equal(state.member.balanceCents, 80000, 'Collected payment is credited even after cancellation');
  reset({ record: null });
  assert.deepEqual(await handle(request('payment')), { ignored: true });
  assert.deepEqual(await handle(request()), { ignored: true });
  reset();
  await assert.rejects(handle(request('payment', false)), (error) => error.status === 401);
  assert.equal(state.requests.length, 0);
  reset();
  state.subscription.status = 'paused';
  state.record.member.cardTier = 'GOLDEN';
  assert.equal((await handle(request('subscription_preapproval'))).approved, false);
  assert.equal(state.members[0].enrollmentStatus, 'SUBSCRIPTION_PAUSED');
  reset();
  state.payment.status = 'rejected';
  assert.equal((await handle(request())).approved, false);
  assert.equal(state.members.length, 0);
  console.log('PASS: recurring payment, scheduled invoice, amount/currency checks, cancelled subscription, unrelated payment, signature, pause, rejected payment. No external requests or real charges.');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
  delete globalThis.__goldDb;
  delete globalThis.__goldAdmin;
}
