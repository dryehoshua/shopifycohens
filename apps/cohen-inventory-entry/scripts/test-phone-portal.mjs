import assert from 'node:assert/strict';
import { createServer } from 'vite';
const token = 'a'.repeat(43);
let valid = true;
let linkedShop = 'test.myshopify.com';
let revoked = false;
globalThis.__phoneServices = {
  db: {
    nekudotCustomerIdentity: { findUnique: async ({ where }) => ({ memberId: 'member', member: { active: true }, shopifyCustomerId: where.shop_shopifyCustomerId.shopifyCustomerId }) },
    nekudotLedgerEntry: { findMany: async () => [] },
    nekudotPortalSession: { updateMany: async () => { revoked = true; return { count: 1 }; } },
  },
  proxy: { admin: { graphql: async () => ({ json: async () => ({ data: { customer: {} } }) }) }, liquid: (html, options) => new Response(html, options) },
  member: () => valid ? { id: 'member', identities: [{ shop: linkedShop, shopifyCustomerId: 'gid://shopify/Customer/1' }] } : null,
  card: { id: 'member', displayName: 'Phone test', cardTier: 'BLUE', active: true, availableCents: 0, lifetimeEarnedCents: 0, qrDataUrl: '', barcodeDataUrl: '' },
};
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', plugins: [{ name: 'phone-test', enforce: 'pre',
  resolveId(id) { const match = /\/(db|shopify|nekudot-registration|nekudot|community-wallet|nekudot-online-redemption|nekudot-photo-url)\.server(?:\.ts)?$/.exec(id); if(match) return `\0phone-${match[1]}`; },
  load(id) {
    if(id === '\0phone-db') return 'export default globalThis.__phoneServices.db;';
    if(id === '\0phone-shopify') return 'export const authenticate = {public: {appProxy: async () => globalThis.__phoneServices.proxy}};';
    if(id === '\0phone-nekudot-registration') return `export class RegistrationError extends Error {constructor(message,status=400){super(message);this.status=status;}}
      export const sendPortalOtp=async()=>({phone:'+525512345678'});
      export const verifyPortalOtp=async(phone,code)=>{if(code!=='123456')throw new RegistrationError('Código incorrecto',401);return {token:'${token}'};};
      export const portalMemberFromToken=async(value)=>value==='${token}'?globalThis.__phoneServices.member():null;
      export const memberCardData=async()=>globalThis.__phoneServices.card;
      export const memberOrders=async()=>[];
      export const startGoldenSubscription=async()=> 'https://www.mercadopago.com.mx/test';`;
    if(id === '\0phone-nekudot') return 'export class NekudotError extends Error {} export const claimPendingNekudotOrders=async()=>{};';
    if(id === '\0phone-community-wallet') return 'export const communityVoucherForMember=async()=>null; export const activateCommunityVoucher=async()=>{}; export const requestIbGoldWithdrawal=async()=>{}; export const transferIbGoldToNekudot=async()=>{};';
    if(id === '\0phone-nekudot-online-redemption') return 'export const createOnlineNekudotRedemption=async()=>{};';
    if(id === '\0phone-nekudot-photo-url') return 'export const signedMemberPhotoUrl=()=>null;';
  },
}] });
try {
  const { action, loader } = await vite.ssrLoadModule('/app/routes/nekudot-storefront.ts');
  const post = (values) => action({ request: new Request('https://example.test/nekudot-storefront?shop=test.myshopify.com', { method: 'POST', body: new URLSearchParams(values) }) });
  const login = await loader({ request: new Request('https://example.test/nekudot-storefront?shop=test.myshopify.com&login=1') });
  const loginHtml = await login.text();
  assert.match(loginHtml, /Entrar con correo electrónico/);
  assert.match(loginHtml, /Enviar código SMS/);
  assert.equal((await post({ intent: 'phone_verify', phone: '+525512345678', code: '000000' })).status, 401);
  const success = await post({ intent: 'phone_verify', phone: '+525512345678', code: '123456' });
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.match(await success.text(), /Hola, Phone test/);
  assert.equal((await post({ intent: 'phone_resume', phoneSession: 'forged' })).status, 401);
  linkedShop = 'other.myshopify.com';
  assert.equal((await post({ intent: 'phone_resume', phoneSession: token })).status, 401);
  linkedShop = 'test.myshopify.com';
  valid = false;
  assert.equal((await post({ intent: 'phone_resume', phoneSession: token })).status, 401);
  valid = true;
  await post({ intent: 'phone_logout', phoneSession: token });
  assert.equal(revoked, true);
  console.log('PASS: email/SMS options, invalid OTP, verified account, private response, forged/expired session rejection, shop isolation, logout.');
} finally { await vite.close(); delete globalThis.__phoneServices; }
