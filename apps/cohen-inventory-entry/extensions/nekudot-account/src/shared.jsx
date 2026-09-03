import "@shopify/ui-extensions/preact";
import { useEffect, useState } from "preact/hooks";

const DEFAULT_BACKEND = "https://cohens-operations-production.up.railway.app";

export function money(cents) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format((Number(cents) || 0) / 100);
}

export function tierLabel(tier) {
  return tier === "SILVER" ? "Plata · 2%" : tier === "BLUE" ? "Blue · 5%" : tier === "GOLDEN" ? "Golden · 8%" : "Vales";
}

export function useNekudotAccount() {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const token = await shopify.sessionToken.get();
        const configured = String(shopify.settings?.value?.backend_url || "").trim().replace(/\/$/, "");
        const response = await fetch(`${configured || DEFAULT_BACKEND}/api/customer-account/nekudot`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) throw new Error(data?.message || "No pudimos consultar tus Nekudot.");
        if (active) setState({ loading: false, data, error: "" });
      } catch (error) {
        if (active) setState({ loading: false, data: null, error: error instanceof Error ? error.message : "No pudimos consultar tus Nekudot." });
      }
    }
    load();
    return () => { active = false; };
  }, []);
  return state;
}

export function LoadingOrError({ state }) {
  if (state.loading) return <s-banner tone="info">Consultando tu saldo Nekudot…</s-banner>;
  if (state.error) return <s-banner tone="critical" heading="No pudimos cargar Nekudot">{state.error}</s-banner>;
  if (!state.data?.registered) return <s-banner tone="info" heading="Activa tus Nekudot">{state.data?.message}<s-link href={state.data?.registrationUrl}>Crear mi tarjeta</s-link></s-banner>;
  return null;
}
