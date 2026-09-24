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
    update: async (args) => { state.payments.push(args.data); return args.data; },
  },
  nekudotMember: { update: async (args) => { state.members.push(args.data); return args.data; } },
  $transaction: async (operations) => Promise.all(operations),
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
    payments: [], members: [], requests: [], ...overrides,
  };
}
globalThis.fetch = async (url) => {
  state.requests.push(String(url));
  const data = String(url).includes('/authorized_payments/') ? state.invoice : String(url).includes('/v1/payments/') ? state.payment : state.subscription;
  return Response.json(data);
};
function request(type = 'subscription_authorized_payment', valid = true) {
  const ts = String(Date.now());
  const signature = createHmac('sha256', 'test-secret').update(`id:123;request-id:test-request;ts:${ts};`).digest('hex');
  return new Request('https://example.test/webhooks/mercadopago?data.id=123', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-request', 'x-signature': `ts=${ts},v1=${valid ? signature : '0'.repeat(64)}` }, body: JSON.stringify({ type, data: { id: 123 } }) });
}
try {
  const { processMercadoPagoWebhook: handle } = await vite.ssrLoadModule('/app/nekudot-registration.server.ts');
  reset();
  assert.deepEqual(await handle(request()), { approved: true });
  assert.equal(state.members[0].active, true);
  assert.equal(state.payments[0].paymentId, '123');
  assert.equal(state.requests.length, 3);
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
  assert.equal(state.members.length, 0);
  reset({ record: null });
  assert.deepEqual(await handle(request('payment')), { ignored: true });
  assert.deepEqual(await handle(request()), { ignored: true });
  reset();
  await assert.rejects(handle(request('payment', false)), (error) => error.status === 401);
  assert.equal(state.requests.length, 0);
  reset();
  state.subscription.status = 'paused';
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
