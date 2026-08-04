export type CafePaymentMethod = "CASH" | "EXTERNAL_CARD";

export type CafeCartInput = {
  variantId: string;
  quantity: number;
};

export type CafeReceiptItem = {
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

export function normalizeCafeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function parseMoneyToCents(value: unknown, field = "importe") {
  const normalized = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${field} no es válido.`);
  }
  return Math.round(normalized * 100);
}

export function parseShopifyMoneyToCents(value: string) {
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(value)) throw new Error("Shopify devolvió un precio inválido.");
  return Math.round(Number(value) * 100);
}

export function assertCartInput(value: unknown): CafeCartInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error("El carrito debe contener entre 1 y 50 partidas.");
  }
  const merged = new Map<string, number>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new Error("El carrito contiene una partida inválida.");
    const variantId = String((raw as Record<string, unknown>).variantId ?? "");
    const quantity = Number((raw as Record<string, unknown>).quantity);
    if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)) {
      throw new Error("El carrito contiene una variante inválida.");
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error("La cantidad debe ser un entero entre 1 y 99.");
    }
    merged.set(variantId, (merged.get(variantId) ?? 0) + quantity);
  }
  return [...merged].map(([variantId, quantity]) => {
    if (quantity > 99) throw new Error("La cantidad acumulada no puede exceder 99.");
    return { variantId, quantity };
  });
}

export function includedTaxCents(grossCents: number, rateBasisPoints: number) {
  if (!Number.isInteger(grossCents) || grossCents < 0) throw new Error("El total bruto no es válido.");
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) {
    throw new Error("La tasa de impuesto no es válida.");
  }
  if (rateBasisPoints === 0) return 0;
  return Math.round((grossCents * rateBasisPoints) / (10_000 + rateBasisPoints));
}

export function formatMoney(cents: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function safeIdempotencyKey(value: unknown) {
  const key = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    throw new Error("La llave de la venta no es válida.");
  }
  return key;
}

export function wrapReceiptText(value: string, width = 32) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) lines.push(current);
      for (let offset = 0; offset < word.length; offset += width) lines.push(word.slice(offset, offset + width));
      current = "";
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function receiptColumns(left: string, right: string, width = 32) {
  if (right.length >= width) return right.slice(0, width);
  const available = width - right.length - 1;
  return `${left.slice(0, available).padEnd(available + 1, " ")}${right}`;
}
