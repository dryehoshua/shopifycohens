import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const PAGES = {
  plata: "Registro Nekudot Plata",
  blue: "Registro Nekudot Blue",
  golden: "Registro Nekudot Golden",
  vales: "Vales comunitarios",
  ib: "Programa de IBs",
} as const;

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const proxy = await authenticate.public.appProxy(request);
  const type = String(params.tipo || "").toLowerCase() as keyof typeof PAGES;
  if (!(type in PAGES)) return proxy.liquid("<p>Formulario no encontrado.</p>", { status: 404 });
  const backend = (process.env.SHOPIFY_APP_URL || "https://cohens-operations-production.up.railway.app").replace(/\/$/, "");
  const sourcePath = type === "ib" ? "/registro/ib" : `/registro/${type}`;
  const source = `${backend}${sourcePath}`;
  return proxy.liquid(`
    <style>
      .nk-form-shell{max-width:1180px;margin:0 auto;padding:18px 16px 54px}.nk-form-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding:12px 16px;border:1px solid #e3dac8;border-radius:16px;background:#fff}.nk-form-nav strong{color:#123b2a}.nk-form-nav a{color:#123b2a;font-weight:750;text-decoration:none}.nk-form-frame{display:block;width:100%;height:max(980px,calc(100vh - 130px));border:0;border-radius:22px;background:#f8f4ea;box-shadow:0 14px 38px rgba(18,59,42,.12)}@media(max-width:749px){.nk-form-shell{padding:8px 0 30px}.nk-form-nav{margin:0 10px 10px}.nk-form-frame{border-radius:0;height:1250px}}
    </style>
    <main class="nk-form-shell">
      <nav class="nk-form-nav" aria-label="Registro Cohen's"><strong>${escapeHtml(PAGES[type])}</strong><span><a href="/">Tienda</a> · <a href="/apps/nekudot">Mi portal</a></span></nav>
      <iframe class="nk-form-frame" src="${escapeHtml(source)}" title="${escapeHtml(PAGES[type])}" loading="eager" allow="payment"></iframe>
    </main>
  `);
}
