const appUrl = process.env.SHOPIFY_APP_URL?.trim();
const secret = process.env.INVENTORY_RECONCILIATION_SECRET?.trim();
const shop = process.env.INVENTORY_RECONCILIATION_SHOP?.trim();

if (!appUrl) {
  throw new Error("Falta SHOPIFY_APP_URL para ejecutar la conciliación.");
}

if (!secret) {
  throw new Error("Falta INVENTORY_RECONCILIATION_SECRET para ejecutar la conciliación.");
}

const endpoint = new URL("/api/inventory/reconcile", appUrl);
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(shop ? { shop } : {}),
  signal: AbortSignal.timeout(15 * 60 * 1000),
});

const body = await response.text();
if (!response.ok) {
  throw new Error(
    `La conciliación respondió ${response.status}: ${body.slice(0, 2_000)}`,
  );
}

process.stdout.write(`${body}\n`);
