import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { memberCardData, memberOrders } from "../nekudot-registration.server";
import { claimPendingNekudotOrders, NekudotError } from "../nekudot.server";
import { createOnlineNekudotRedemption } from "../nekudot-online-redemption.server";
import { authenticate } from "../shopify.server";

type ProxyContext = Awaited<ReturnType<typeof authenticate.public.appProxy>>;
type PortalMessage = { tone: "success" | "error"; text: string; applyUrl?: string };

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

function tierLabel(tier: string) {
  if (tier === "BLUE") return "Blue · 5%";
  if (tier === "GOLDEN") return "Golden · 8%";
  if (tier === "VOUCHER") return "Vales";
  return "Plata · 2%";
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    PAID: "Pagado",
    PARTIALLY_PAID: "Pago parcial",
    PARTIALLY_REFUNDED: "Reembolso parcial",
    REFUNDED: "Reembolsado",
    PENDING: "Pendiente",
    FULFILLED: "Entregado",
    UNFULFILLED: "Por preparar",
    IN_PROGRESS: "En preparación",
  };
  return labels[value] || value.replaceAll("_", " ").toLowerCase();
}

function loginHtml() {
  return portalShell(`
    <section class="nk-hero nk-login">
      <span class="nk-kicker">NEKUDOT COHEN'S</span>
      <h1>Entra para ver y usar tus Nekudot</h1>
      <p>Tu cuenta de la tienda reúne saldo, compras, movimientos y recompra. No necesitas otro acceso.</p>
      <a class="nk-button" href="/customer_authentication/redirect?return_url=%2Fapps%2Fnekudot">Iniciar sesión en Cohen's</a>
      <small>Después de entrar regresarás directamente a Mis Nekudot.</small>
    </section>
  `);
}

function registrationHtml() {
  return portalShell(`
    <section class="nk-hero nk-login">
      <span class="nk-kicker">TU CUENTA YA ESTÁ IDENTIFICADA</span>
      <h1>Activa Nekudot en tu cuenta Cohen's</h1>
      <p>Ya iniciaste sesión. Elige tu tarjeta para conectar tus compras y comenzar a recibir cashback.</p>
      <div class="nk-actions">
        <a class="nk-button" href="https://cohens-operations-production.up.railway.app/registro/plata">Crear tarjeta Plata</a>
        <a class="nk-button nk-secondary" href="https://cohens-operations-production.up.railway.app/registro/blue">Activar Blue</a>
      </div>
    </section>
  `);
}

function portalShell(content: string) {
  return `
    <style>
      .nk-store{--ink:#17251f;--green:#123b2a;--gold:#c99a46;--cream:#f8f4ea;--line:#e4dac7;color:var(--ink);font-family:inherit;max-width:1180px;margin:0 auto;padding:32px 18px 64px}.nk-store *{box-sizing:border-box}.nk-hero{background:linear-gradient(135deg,#0f3627,#1e5b42);border-radius:26px;color:#fff;padding:34px;box-shadow:0 18px 45px rgba(18,59,42,.15)}.nk-hero h1{color:#fff;font-size:clamp(30px,5vw,54px);line-height:1.02;margin:8px 0 12px}.nk-hero p{max-width:720px;font-size:17px;line-height:1.55;margin:0 0 20px;color:#edf7f1}.nk-kicker{color:#ebc77e;font-size:12px;letter-spacing:.18em;font-weight:800}.nk-button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:12px 20px;border:0;border-radius:999px;background:var(--gold);color:#18251f!important;font-weight:800;text-decoration:none;cursor:pointer}.nk-button:hover{filter:brightness(.97)}.nk-secondary{background:#fff;color:var(--green)!important;border:1px solid var(--line)}.nk-login{max-width:760px;margin:20px auto}.nk-login small{display:block;margin-top:14px;color:#dbe9e1}.nk-actions{display:flex;flex-wrap:wrap;gap:10px}.nk-summary{display:grid;grid-template-columns:1.3fr .8fr .8fr;gap:14px;margin-top:18px}.nk-stat{background:#fff;color:var(--ink);border-radius:18px;padding:20px}.nk-stat span{display:block;color:#6f776f;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.nk-stat strong{display:block;font-size:clamp(24px,4vw,38px);margin-top:6px}.nk-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-top:18px}.nk-panel{border:1px solid var(--line);border-radius:22px;background:#fff;padding:24px}.nk-panel h2{font-size:23px;margin:0 0 8px}.nk-panel>p{color:#657067;margin-top:0}.nk-redeem{background:var(--cream);border-color:#ddc99e}.nk-form{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;margin-top:16px}.nk-field label{display:block;font-weight:750;margin-bottom:6px}.nk-field input{width:100%;min-height:48px;border:1px solid #bdae91;border-radius:12px;padding:11px 14px;font:inherit;background:#fff}.nk-hint{display:block;color:#707a72;font-size:12px;margin-top:7px}.nk-message{border-radius:14px;padding:14px 16px;margin:16px 0;font-weight:700}.nk-message.success{background:#def3e6;color:#165f39}.nk-message.error{background:#fde7e3;color:#8e382b}.nk-apply{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:10px}.nk-card{background:linear-gradient(150deg,#183f30,#081e16);border-radius:22px;color:#fff;padding:24px;min-height:245px;position:relative;overflow:hidden}.nk-card:after{content:"";position:absolute;width:230px;height:230px;border:1px solid rgba(255,255,255,.1);border-radius:50%;right:-80px;top:-80px}.nk-card small{color:#d8e7df}.nk-card h2{color:#fff;margin:8px 0 2px}.nk-card-balance{display:block;font-size:29px;color:#edc979;margin:18px 0}.nk-codes{display:flex;gap:14px;align-items:end;position:relative;z-index:1}.nk-codes img{background:#fff;border-radius:10px;padding:5px;max-width:110px}.nk-codes img:last-child{max-width:210px;width:58%}.nk-section-title{display:flex;justify-content:space-between;gap:14px;align-items:end;margin:34px 0 12px}.nk-section-title h2{font-size:28px;margin:0}.nk-section-title a{color:var(--green);font-weight:750}.nk-orders{display:grid;gap:12px}.nk-order{border:1px solid var(--line);border-radius:17px;background:#fff;padding:17px;display:grid;grid-template-columns:1fr auto;gap:14px}.nk-order-meta{color:#707a72;font-size:13px;margin-top:4px}.nk-earned{display:block;color:#167044;font-weight:800;margin-top:7px}.nk-order-total{text-align:right;font-weight:800}.nk-rebuy{margin-top:10px;background:transparent;border:0;padding:0;color:var(--green);text-decoration:underline;font:inherit;font-weight:750;cursor:pointer}.nk-empty{border:1px dashed var(--line);border-radius:17px;padding:22px;color:#707a72}.nk-ledger{display:grid;gap:8px}.nk-ledger-row{display:grid;grid-template-columns:1fr auto;gap:12px;padding:12px 0;border-bottom:1px solid #eee7db}.nk-ledger-row:last-child{border-bottom:0}.nk-positive{color:#167044}.nk-negative{color:#a44735}.nk-ib-link{text-align:center;margin:42px 0 0;font-size:12px}.nk-ib-link a{color:#7e847f;text-decoration:underline}.nk-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#17251f;color:#fff;padding:12px 18px;border-radius:999px;z-index:20;display:none}.nk-toast.show{display:block}@media(max-width:760px){.nk-store{padding:18px 12px 46px}.nk-hero{padding:24px 20px;border-radius:19px}.nk-summary,.nk-grid{grid-template-columns:1fr}.nk-form{grid-template-columns:1fr}.nk-order{grid-template-columns:1fr}.nk-order-total{text-align:left}.nk-panel{padding:19px}.nk-section-title{align-items:start;flex-direction:column}.nk-codes img:last-child{max-width:190px}}
    </style>
    <main class="nk-store">${content}<div class="nk-toast" id="nk-toast" role="status"></div></main>
  `;
}

function dashboardHtml(card: Awaited<ReturnType<typeof memberCardData>>, orders: Awaited<ReturnType<typeof memberOrders>>, message?: PortalMessage) {
  const availablePesos = (card.availableCents / 100).toFixed(2);
  const recentLedgerPromise = db.nekudotLedgerEntry.findMany({
    where: { memberId: card.id, walletType: "CLIENT" },
    orderBy: { occurredAt: "desc" },
    take: 12,
  });
  return recentLedgerPromise.then((ledger) => portalShell(`
    <section class="nk-hero">
      <span class="nk-kicker">MI CUENTA NEKUDOT</span>
      <h1>Hola, ${escapeHtml(card.displayName)}</h1>
      <p>Tu saldo, tus compras y el canje viven aquí, dentro de la tienda Cohen's.</p>
      <div class="nk-summary">
        <div class="nk-stat"><span>Disponible para comprar</span><strong>${escapeHtml(money(card.availableCents))}</strong></div>
        <div class="nk-stat"><span>Tarjeta</span><strong>${escapeHtml(tierLabel(card.cardTier))}</strong></div>
        <div class="nk-stat"><span>Ganado históricamente</span><strong>${escapeHtml(money(card.lifetimeEarnedCents))}</strong></div>
      </div>
    </section>

    ${message ? `<div class="nk-message ${message.tone}">${escapeHtml(message.text)}${message.applyUrl ? `<div class="nk-apply"><a class="nk-button" href="${escapeHtml(message.applyUrl)}">Aplicar descuento en mi carrito</a><small>El canje queda reservado durante 30 minutos.</small></div>` : ""}</div>` : ""}

    <div class="nk-grid">
      <section class="nk-panel nk-redeem">
        <span class="nk-kicker" style="color:#80601f">PAGAR CON NEKUDOT</span>
        <h2>¿Cuántos quieres usar?</h2>
        <p>Un peso de saldo equivale a un peso de descuento. El código será personal, de un solo uso y sólo funcionará con esta cuenta.</p>
        <form class="nk-form" method="post" action="/apps/nekudot">
          <input type="hidden" name="intent" value="redeem">
          <div class="nk-field"><label for="nk-amount">Cantidad en pesos</label><input id="nk-amount" name="amount" type="number" min="1" max="${availablePesos}" step="0.01" inputmode="decimal" required placeholder="Ej. 50.00"><small class="nk-hint">Máximo disponible: ${escapeHtml(money(card.availableCents))}</small></div>
          <button class="nk-button" type="submit" ${card.availableCents < 100 ? "disabled" : ""}>Usar mis Nekudot</button>
        </form>
      </section>
      <aside class="nk-card">
        <small>TARJETA DIGITAL · ${escapeHtml(tierLabel(card.cardTier))}</small>
        <h2>${escapeHtml(card.displayName)}</h2>
        <span class="nk-card-balance">${escapeHtml(money(card.availableCents))}</span>
        <div class="nk-codes"><img src="${card.qrDataUrl}" alt="Código QR Nekudot"><img src="${card.barcodeDataUrl}" alt="Código de barras Nekudot"></div>
      </aside>
    </div>

    <div class="nk-section-title"><h2>Mis compras</h2><a href="/collections/all">Seguir comprando</a></div>
    <section class="nk-orders">
      ${orders.length ? orders.map((order) => {
        const items = order.lineItems.nodes.filter((item) => item.variant?.id).map((item) => ({
          id: item.variant!.id.replace("gid://shopify/ProductVariant/", ""),
          quantity: Math.max(1, Math.min(10, item.quantity)),
        }));
        const productSummary = order.lineItems.nodes.slice(0, 3).map((item) => `${item.quantity}× ${item.product?.title || item.variant?.title || "Producto"}`).join(" · ");
        const extraProducts = Math.max(0, order.lineItems.nodes.length - 3);
        return `<article class="nk-order"><div><strong>${escapeHtml(order.name)}</strong><div class="nk-order-meta">${escapeHtml(new Date(order.processedAt).toLocaleDateString("es-MX"))} · ${escapeHtml(statusLabel(order.displayFinancialStatus))} · ${escapeHtml(statusLabel(order.displayFulfillmentStatus))}</div>${productSummary ? `<div class="nk-order-meta">${escapeHtml(productSummary)}${extraProducts ? ` · +${extraProducts} más` : ""}</div>` : ""}${order.cashbackProcessed ? `<span class="nk-earned">+${escapeHtml(money(order.clientEarnedCents))} Nekudot</span>` : `<span class="nk-order-meta">Cashback pendiente de confirmación</span>`}${items.length ? `<button type="button" class="nk-rebuy" data-items="${escapeHtml(JSON.stringify(items))}">Comprar nuevamente</button>` : ""}</div><div class="nk-order-total">${escapeHtml(new Intl.NumberFormat("es-MX", { style: "currency", currency: order.currentTotalPriceSet.shopMoney.currencyCode }).format(Number(order.currentTotalPriceSet.shopMoney.amount)))}</div></article>`;
      }).join("") : `<div class="nk-empty">Aún no hay compras vinculadas a esta cuenta.</div>`}
    </section>

    <div class="nk-section-title"><h2>Movimientos de Nekudot</h2></div>
    <section class="nk-panel nk-ledger">
      ${ledger.length ? ledger.map((entry) => `<div class="nk-ledger-row"><div><strong>${escapeHtml(entry.description)}</strong><div class="nk-order-meta">${escapeHtml(new Date(entry.occurredAt).toLocaleDateString("es-MX"))}</div></div><strong class="${entry.amountCents >= 0 ? "nk-positive" : "nk-negative"}">${entry.amountCents >= 0 ? "+" : ""}${escapeHtml(money(entry.amountCents))}</strong></div>`).join("") : `<div class="nk-empty">Tus movimientos aparecerán aquí después de tu primera compra.</div>`}
    </section>

    <p class="nk-ib-link"><a href="https://cohens-operations-production.up.railway.app/registro/ib">Programa de IBs</a></p>
    <script>
      document.querySelectorAll('.nk-rebuy').forEach(function(button){
        button.addEventListener('click', async function(){
          var toast=document.getElementById('nk-toast');
          try{
            button.disabled=true;button.textContent='Agregando…';
            var items=JSON.parse(button.dataset.items || '[]');
            var response=await fetch('/cart/add.js',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({items:items})});
            if(!response.ok) throw new Error('No se pudieron agregar los productos.');
            window.location.href='/cart';
          }catch(error){
            toast.textContent=error.message || 'No se pudo repetir la compra.';toast.classList.add('show');button.disabled=false;button.textContent='Comprar nuevamente';
          }
        });
      });
    </script>
  `));
}

async function proxyIdentity(request: Request) {
  const proxy = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = String(url.searchParams.get("shop") || proxy.session?.shop || "").toLowerCase();
  const legacyCustomerId = String(url.searchParams.get("logged_in_customer_id") || "").trim();
  const customerId = /^\d+$/.test(legacyCustomerId) ? `gid://shopify/Customer/${legacyCustomerId}` : null;
  return { proxy, shop, customerId };
}

async function dashboard(proxy: ProxyContext, shop: string, customerId: string) {
  if (!proxy.admin) throw new NekudotError("La conexión de la tienda necesita actualizarse.", 503, "APP_SESSION_MISSING");
  const identity = await db.nekudotCustomerIdentity.findUnique({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customerId } },
    include: { member: true },
  });
  if (!identity?.member.active) return null;
  const response = await proxy.admin.graphql(`#graphql
    query NekudotStorefrontContact($id: ID!) {
      customer(id: $id) {
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
      }
    }
  `, { variables: { id: customerId } });
  const payload = await response.json() as { data?: { customer?: { defaultEmailAddress?: { emailAddress?: string }; defaultPhoneNumber?: { phoneNumber?: string } } } };
  await claimPendingNekudotOrders({
    memberId: identity.memberId,
    email: payload.data?.customer?.defaultEmailAddress?.emailAddress || null,
    phone: payload.data?.customer?.defaultPhoneNumber?.phoneNumber || null,
  });
  const [card, orders] = await Promise.all([memberCardData(identity.memberId), memberOrders(identity.memberId)]);
  return { identity, card, orders };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { proxy, shop, customerId } = await proxyIdentity(request);
  if (!customerId) return proxy.liquid(loginHtml());
  const data = await dashboard(proxy, shop, customerId);
  if (!data) return proxy.liquid(registrationHtml());
  return proxy.liquid(await dashboardHtml(data.card, data.orders));
}

export async function action({ request }: ActionFunctionArgs) {
  const { proxy, shop, customerId } = await proxyIdentity(request);
  if (!customerId) return proxy.liquid(loginHtml(), { status: 401 });
  const data = await dashboard(proxy, shop, customerId);
  if (!data) return proxy.liquid(registrationHtml(), { status: 404 });
  const form = await request.formData();
  try {
    if (String(form.get("intent") || "") !== "redeem") throw new NekudotError("Operación no válida.");
    if (!proxy.admin) throw new NekudotError("La conexión de la tienda necesita actualizarse.", 503);
    const redemption = await createOnlineNekudotRedemption({
      admin: proxy.admin,
      shop,
      customerId,
      memberId: data.identity.memberId,
      amount: form.get("amount"),
      cartReference: "SHOPIFY_STOREFRONT",
    });
    const refreshed = await dashboard(proxy, shop, customerId);
    return proxy.liquid(await dashboardHtml(refreshed!.card, refreshed!.orders, {
      tone: "success",
      text: `${money(redemption.amountCents)} listos para usar en tu compra.`,
      applyUrl: redemption.discountApplyUrl,
    }));
  } catch (error) {
    const caught = error instanceof NekudotError ? error : new NekudotError("No pudimos preparar el canje.", 500);
    const refreshed = await dashboard(proxy, shop, customerId);
    return proxy.liquid(await dashboardHtml(refreshed!.card, refreshed!.orders, { tone: "error", text: caught.message }), { status: caught.status });
  }
}
