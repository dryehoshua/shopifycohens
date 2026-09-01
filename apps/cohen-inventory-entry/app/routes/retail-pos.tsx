import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import stylesheet from "../retail-pos.css?url";
import {
  assertRetailPosEnabled,
  currentRetailSession,
  currentRetailShift,
  retailPosJsonError,
} from "../retail-pos.server";
import { formatMoney, receiptColumns, wrapReceiptText, type CafeReceiptItem } from "../cafe-pos-domain";
import { NfcBridgeReader } from "../components/NfcBridgeReader";
import { NfcReaderDiagnostics } from "../components/NfcReaderDiagnostics";
import { cashbackPercentForTier, type NekudotCardTier } from "../nekudot-domain";
import "../nfc-bridge.css";
import "../nfc-reader-diagnostics.css";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "manifest", href: "/retail-pos.webmanifest" },
  { rel: "icon", href: "/favicon.ico" },
];

export const meta: MetaFunction = () => [
  { title: "Cohen's Store · Retail POS" },
  { name: "theme-color", content: "#173f32" },
  { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const shop = assertRetailPosEnabled();
    const session = await currentRetailSession(request, false);
    return {
      enabled: true as const,
      shop,
      staff: session ? { id: session.staff.id, name: session.staff.name, role: session.staff.role } : null,
      shift: session ? await currentRetailShift(shop) : null,
    };
  } catch (error) {
    const response = retailPosJsonError(error);
    if (response.status === 404) throw new Response("No encontrado", { status: 404 });
    throw response;
  }
}

type Variant = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number;
  tracked: boolean;
  available: number;
  inventoryPolicy: "DENY" | "CONTINUE";
};
type Product = {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  imageUrl: string | null;
  imageAlt: string;
  variants: Variant[];
};
type CartLine = { product: Product; variant: Variant; quantity: number };
type Shift = {
  id: string;
  status: string;
  openedAt: string;
  openingCashCents: number;
  staff: { id: string; name: string };
  expectedCashCents?: number | null;
  cashVarianceCents?: number | null;
  terminalExpectedCents?: number | null;
  terminalVarianceCents?: number | null;
};
type CustomerMembership = {
  id: string;
  cardTier: NekudotCardTier;
  cashbackBasisPoints: number;
  availableCents: number;
  balanceCents: number;
  reservedCents: number;
  credentialCount: number;
  credentialLastFour: string | null;
  broker: { displayName: string; code: string } | null;
};
type Customer = {
  id: string;
  displayName: string;
  email: string | null;
  phone?: string | null;
  numberOfOrders?: number;
  amountSpent?: string;
  member?: CustomerMembership | null;
};
type Member = {
  id: string;
  cardTier: NekudotCardTier;
  cashbackBasisPoints: number;
  displayName: string;
  email: string | null;
  availableCents: number;
  broker: { displayName: string; code: string } | null;
  customer: Customer | null;
};
type ReceiptItem = CafeReceiptItem & { variantId?: string; barcode?: string | null; vendor?: string };
type Sale = {
  id: string;
  status: string;
  paymentMethod: string;
  grossCents: number;
  discountCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  cashPaidCents: number;
  terminalPaidCents: number;
  cashReceivedCents?: number | null;
  changeCents: number;
  nekudotRedeemedCents: number;
  customerName?: string | null;
  customerEmail?: string | null;
  currencyCode: string;
  items: ReceiptItem[];
  shopifyOrderName: string | null;
  createdAt: string;
  staff: { name: string };
  errorMessage?: string | null;
  printCount?: number;
  refundedAt?: string | null;
  refundedByName?: string | null;
};
type StaffMember = { id: string; name: string; role: string; active: boolean };
type SuspendedSale = {
  id: string;
  createdAt: string;
  cart: CartLine[];
  customer: Customer | null;
  discountAmount: string;
};
type Drawer = "orders" | "shift" | "staff" | "customers" | "catalog" | "suspended" | "reader" | null;

type CatalogMeta = {
  productCount: number;
  variantCount: number;
  syncedAt: string;
  location: { id: string; name: string; isActive: boolean };
};

function cardTierLabel(cardTier: NekudotCardTier) {
  return cardTier === "SILVER" ? "Plata" : cardTier === "BLUE" ? "Blue" : cardTier === "GOLDEN" ? "Golden" : "Vales";
}

function membershipLabel(member: Pick<CustomerMembership, "cardTier" | "cashbackBasisPoints">) {
  return `${cardTierLabel(member.cardTier)} · ${member.cashbackBasisPoints / 100}%`;
}

type UsbEndpoint = { direction: string; endpointNumber: number };
type UsbAlternate = { alternateSetting: number; endpoints: UsbEndpoint[] };
type UsbInterface = { interfaceNumber: number; alternates: UsbAlternate[] };
type UsbDevice = {
  opened: boolean;
  productName?: string;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<unknown>;
};
type UsbApi = {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: { filters: Array<{ classCode?: number; vendorId?: number }> }): Promise<UsbDevice>;
};
type UsbNavigator = Navigator & { usb?: UsbApi };

function newSaleKey() {
  const values = new Uint8Array(18);
  globalThis.crypto?.getRandomValues(values);
  return `retail_${[...values].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function moneyInputCents(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return 0;
  return Math.max(0, Math.round(Number(normalized) * 100));
}

function variantCanSell(variant: Variant) {
  return !variant.tracked || variant.available > 0 || variant.inventoryPolicy === "CONTINUE";
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(
      body.error || "No se pudo completar la operación.",
      response.status,
      body.code || "API_ERROR",
    );
  }
  return body;
}

function Login() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      await api("/api/retail-pos/auth", { method: "POST", body: JSON.stringify({ intent: "login", pin }) });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo iniciar sesión."); setPin("");
    } finally { setPending(false); }
  }
  return <main className="retail-login"><form className="retail-login-card" onSubmit={submit}>
    <div className="retail-logo">C</div>
    <span className="retail-kicker">COHEN&apos;S KOSHER &amp; DELI</span>
    <h1>Retail POS</h1>
    <p>Ingresa tu PIN para abrir la tienda.</p>
    <label className="retail-field">PIN<input className="retail-pin" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" type="password" autoComplete="current-password" /></label>
    {error ? <div className="retail-alert error">{error}</div> : null}
    <button className="retail-button primary wide" disabled={pending || pin.length < 4}>{pending ? "Entrando…" : "Entrar a tienda"}</button>
  </form></main>;
}

function cp850(value: string) {
  const special: Record<string, number> = {
    "á": 160, "é": 130, "í": 161, "ó": 162, "ú": 163, "ü": 129, "ñ": 164,
    "Á": 181, "É": 144, "Í": 214, "Ó": 224, "Ú": 233, "Ü": 154, "Ñ": 165,
    "¿": 168, "¡": 173, "°": 248,
  };
  return [...value].map((character) => special[character] ?? (character.charCodeAt(0) < 128 ? character.charCodeAt(0) : 63));
}

function paymentLabel(sale: Sale) {
  if (sale.paymentMethod === "CASH") return "Efectivo";
  if (sale.paymentMethod === "EXTERNAL_CARD") return "Terminal";
  if (sale.paymentMethod === "SPLIT") return "Pago mixto";
  return "Nekudot";
}

function buildReceipt(sale: Sale) {
  const bytes: number[] = [];
  const command = (...values: number[]) => bytes.push(...values);
  const text = (value = "") => bytes.push(...cp850(value), 10);
  command(27, 64, 27, 116, 2, 27, 97, 1, 27, 69, 1);
  text("COHEN'S KOSHER & DELI"); command(27, 69, 0);
  text("Ticket de tienda"); text(sale.shopifyOrderName || sale.id.slice(-10));
  text(new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(sale.createdAt)));
  if (sale.customerName) text(`Cliente: ${sale.customerName}`);
  command(27, 97, 0); text("--------------------------------");
  for (const item of sale.items) {
    for (const line of wrapReceiptText(`${item.quantity} x ${item.title}${item.variantTitle ? ` (${item.variantTitle})` : ""}`)) text(line);
    text(receiptColumns(`  ${formatMoney(item.unitPriceCents)}`, formatMoney(item.totalCents)));
  }
  text("--------------------------------");
  text(receiptColumns("Artículos", formatMoney(sale.grossCents)));
  if (sale.discountCents) text(receiptColumns("Descuento", `-${formatMoney(sale.discountCents)}`));
  if (sale.nekudotRedeemedCents) text(receiptColumns("Nekudot", `-${formatMoney(sale.nekudotRedeemedCents)}`));
  text(receiptColumns("IVA incluido", formatMoney(sale.taxCents)));
  command(27, 69, 1, 29, 33, 17); text(receiptColumns("TOTAL", formatMoney(sale.totalCents))); command(29, 33, 0, 27, 69, 0);
  text(receiptColumns("Pago", paymentLabel(sale)));
  if (sale.paymentMethod === "SPLIT") {
    text(receiptColumns("  Efectivo", formatMoney(sale.cashPaidCents)));
    text(receiptColumns("  Terminal", formatMoney(sale.terminalPaidCents)));
  }
  if (sale.cashReceivedCents != null) text(receiptColumns("Recibido", formatMoney(sale.cashReceivedCents)));
  if (sale.changeCents) text(receiptColumns("Cambio", formatMoney(sale.changeCents)));
  text(`Atendió: ${sale.staff.name}`); command(27, 97, 1);
  text(""); text("Tus compras suman Nekudot"); text("Gracias por volver"); text(""); text(""); text("");
  return new Uint8Array(bytes);
}

export default function RetailPos() {
  const initial = useLoaderData<typeof loader>();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [shift, setShift] = useState<Shift | null>(initial.shift as Shift | null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [search, setSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [scanQuantity, setScanQuantity] = useState(1);
  const [lastScannedVariantId, setLastScannedVariantId] = useState<string | null>(null);
  const [vendor, setVendor] = useState("Todos");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomerCredential, setNewCustomerCredential] = useState("");
  const [credentialLabel, setCredentialLabel] = useState("Tarjeta de prueba POS");
  const [cardTier, setCardTier] = useState<NekudotCardTier | "">("");
  const [replaceCredential, setReplaceCredential] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [credential, setCredential] = useState("");
  const [nekudotAmount, setNekudotAmount] = useState("0");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("");
  const [terminalCounted, setTerminalCounted] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffPin, setStaffPin] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [suspendedSales, setSuspendedSales] = useState<SuspendedSale[]>([]);
  const [suspendedLoaded, setSuspendedLoaded] = useState(false);
  const [cashCheckoutOpen, setCashCheckoutOpen] = useState(false);
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [cardAssignmentOpen, setCardAssignmentOpen] = useState(false);
  const printer = useRef<{ device: UsbDevice; endpoint: number } | null>(null);
  const saleKey = useRef(newSaleKey());
  const searchRef = useRef<HTMLInputElement>(null);
  const cashInputRef = useRef<HTMLInputElement>(null);
  const cardCustomerSearchRef = useRef<HTMLInputElement>(null);
  const catalogRequestRef = useRef(0);

  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true);
    try {
      const result = await api<{ customers: Customer[] }>("/api/retail-pos/customers");
      setCustomers(result.customers);
      setCustomersLoaded(true);
    } finally {
      setCustomersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cashCheckoutOpen) return;
    const frame = window.requestAnimationFrame(() => cashInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [cashCheckoutOpen]);

  useEffect(() => {
    if (!cardAssignmentOpen) return;
    const frame = window.requestAnimationFrame(() => cardCustomerSearchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [cardAssignmentOpen]);

  useEffect(() => {
    if (drawer !== "customers" && !cardAssignmentOpen) return;
    if (customersLoaded || customersLoading) return;
    void loadCustomers().catch((error) => setMessage({
      tone: "error",
      text: error instanceof Error ? error.message : "No se pudo cargar la lista de clientes.",
    }));
  }, [cardAssignmentOpen, customersLoaded, customersLoading, drawer, loadCustomers]);

  const loadCatalog = useCallback(async () => {
    const requestId = catalogRequestRef.current + 1;
    catalogRequestRef.current = requestId;
    setCatalogRefreshing(true);
    try {
      const result = await api<{ products: Product[] } & CatalogMeta>("/api/retail-pos/catalog");
      if (catalogRequestRef.current !== requestId) return;
      setProducts(result.products);
      setCatalogMeta({
        productCount: result.productCount,
        variantCount: result.variantCount,
        syncedAt: result.syncedAt,
        location: result.location,
      });
      setLastUpdatedAt(new Date(result.syncedAt));
    } finally {
      if (catalogRequestRef.current === requestId) setCatalogRefreshing(false);
    }
  }, []);

  const loadOperations = useCallback(async () => {
    const [salesResult, shiftResult] = await Promise.all([
      api<{ sales: Sale[] }>("/api/retail-pos/orders?limit=50"),
      api<{ shift: Shift | null }>("/api/retail-pos/shift"),
    ]);
    setSales(salesResult.sales);
    setShift(shiftResult.shift);
  }, []);

  const loadData = useCallback(async () => {
    await Promise.all([loadCatalog(), loadOperations()]);
  }, [loadCatalog, loadOperations]);

  useEffect(() => {
    const reportError = (error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo actualizar Shopify." });
    void loadData().catch(reportError);
    const catalogInterval = window.setInterval(() => { void loadCatalog().catch(reportError); }, 30_000);
    const operationsInterval = window.setInterval(() => { void loadOperations().catch(reportError); }, 45_000);
    const refreshVisibleCatalog = () => {
      if (document.visibilityState === "visible") void loadCatalog().catch(reportError);
    };
    window.addEventListener("focus", refreshVisibleCatalog);
    document.addEventListener("visibilitychange", refreshVisibleCatalog);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/retail-pos-sw.js").catch(() => undefined);
    return () => {
      window.clearInterval(catalogInterval);
      window.clearInterval(operationsInterval);
      window.removeEventListener("focus", refreshVisibleCatalog);
      document.removeEventListener("visibilitychange", refreshVisibleCatalog);
    };
  }, [loadCatalog, loadData, loadOperations]);

  useEffect(() => {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) return;
    usb.getDevices().then((devices) => { if (devices[0]) setPrinterName(devices[0].productName || "Impresora autorizada"); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("cohens-retail-suspended-sales");
      if (stored) {
        const parsed = JSON.parse(stored) as Array<SuspendedSale & {
          member?: unknown;
          credential?: unknown;
          nekudotAmount?: unknown;
        }>;
        setSuspendedSales(parsed.map((sale) => ({
          id: sale.id,
          createdAt: sale.createdAt,
          cart: sale.cart,
          customer: sale.customer,
          discountAmount: sale.discountAmount,
        })).slice(0, 20));
      }
    } catch {
      setMessage({ tone: "warning", text: "No se pudieron recuperar las ventas en espera de esta terminal." });
    } finally {
      setSuspendedLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!suspendedLoaded) return;
    window.localStorage.setItem("cohens-retail-suspended-sales", JSON.stringify(suspendedSales));
  }, [suspendedLoaded, suspendedSales]);

  const vendors = useMemo(() => ["Todos", ...new Set(products.map((product) => product.vendor).filter(Boolean))], [products]);
  const normalizedSearch = catalogSearch.trim().toLocaleLowerCase("es-MX");
  const visibleProducts = useMemo(() => products.filter((product) => {
    if (vendor !== "Todos" && product.vendor !== vendor) return false;
    if (!normalizedSearch) return true;
    return [product.title, product.vendor, product.productType, ...product.variants.flatMap((variant) => [variant.sku || "", variant.barcode || "", variant.title])]
      .some((value) => value.toLocaleLowerCase("es-MX").includes(normalizedSearch));
  }), [products, vendor, normalizedSearch]);
  const quickVariants = useMemo(() => products.flatMap((product) => product.variants.slice(0, 1).map((variant) => ({ product, variant }))).slice(0, 12), [products]);
  const normalizedCustomerSearch = customerSearch.trim().toLocaleLowerCase("es-MX");
  const visibleCustomers = useMemo(() => customers.filter((item) => {
    if (!normalizedCustomerSearch) return true;
    return [item.displayName, item.phone || "", item.email || ""]
      .some((value) => value.toLocaleLowerCase("es-MX").includes(normalizedCustomerSearch));
  }), [customers, normalizedCustomerSearch]);
  const grossCents = useMemo(() => cart.reduce((sum, line) => sum + line.variant.priceCents * line.quantity, 0), [cart]);
  const discountCents = Math.min(moneyInputCents(discountAmount), Math.max(0, grossCents - 1));
  const afterDiscountCents = grossCents - discountCents;
  const requestedNekudotCents = moneyInputCents(nekudotAmount);
  const appliedNekudotCents = member ? Math.min(requestedNekudotCents, member.availableCents, afterDiscountCents) : 0;
  const amountDueCents = afterDiscountCents - appliedNekudotCents;
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const activeMembership = member || customer?.member || null;
  const activeCashbackCents = activeMembership
    ? Math.floor(amountDueCents * activeMembership.cashbackBasisPoints / 10_000)
    : 0;

  function add(product: Product, variant: Variant, amount = 1) {
    if (!variantCanSell(variant)) return;
    const safeAmount = Math.max(1, Math.min(99, Math.trunc(amount)));
    setCart((current) => {
      const index = current.findIndex((line) => line.variant.id === variant.id);
      if (index === -1) {
        if (variant.tracked && variant.inventoryPolicy === "DENY" && safeAmount > variant.available) return current;
        return [...current, { product, variant, quantity: safeAmount }];
      }
      const nextQuantity = current[index].quantity + safeAmount;
      if (variant.tracked && variant.inventoryPolicy === "DENY" && nextQuantity > variant.available) return current;
      const next = [...current]; next[index] = { ...next[index], quantity: nextQuantity }; return next;
    });
    setLastScannedVariantId(variant.id);
  }

  function changeQuantity(variantId: string, delta: number) {
    setCart((current) => current.flatMap((line) => {
      if (line.variant.id !== variantId) return [line];
      const next = line.quantity + delta;
      if (next <= 0) return [];
      if (line.variant.tracked && line.variant.inventoryPolicy === "DENY" && next > line.variant.available) return [line];
      return [{ ...line, quantity: next }];
    }));
  }

  function scanOrSearch(event: React.FormEvent) {
    event.preventDefault();
    const exact = products.flatMap((product) => product.variants.map((variant) => ({ product, variant })))
      .find(({ variant }) => variant.barcode === search.trim() || variant.sku === search.trim());
    if (exact) {
      add(exact.product, exact.variant, scanQuantity); setSearch(""); setScanQuantity(1); setMessage({ tone: "success", text: `${scanQuantity} × ${exact.product.title} agregado.` });
      window.requestAnimationFrame(() => searchRef.current?.focus());
    } else if (search.trim()) {
      setCatalogSearch(search.trim()); setSearch(""); setDrawer("catalog");
      setMessage({ tone: "info", text: "Código no exacto. Revisa las coincidencias del catálogo Shopify." });
    }
  }

  function clearCurrentSale() {
    setCart([]); setCustomer(null); setMember(null); setCredential(""); setNekudotAmount("0"); setDiscountAmount("0"); setLastScannedVariantId(null);
    saleKey.current = newSaleKey();
  }

  function suspendCurrentSale() {
    if (!cart.length) return;
    const suspended: SuspendedSale = {
      id: `espera-${Date.now()}`,
      createdAt: new Date().toISOString(),
      cart,
      customer,
      discountAmount,
    };
    setSuspendedSales((current) => [suspended, ...current].slice(0, 20));
    clearCurrentSale();
    setMessage({ tone: "success", text: "Venta puesta en espera. Puedes recuperarla desde En espera." });
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }

  function resumeSuspendedSale(suspended: SuspendedSale) {
    if (cart.length && !window.confirm("La venta actual tiene artículos. ¿Deseas ponerla en espera y recuperar esta venta?")) return;
    if (cart.length) {
      setSuspendedSales((current) => [{
        id: `espera-${Date.now()}`,
        createdAt: new Date().toISOString(),
        cart,
        customer,
        discountAmount,
      }, ...current.filter((item) => item.id !== suspended.id)].slice(0, 20));
    } else {
      setSuspendedSales((current) => current.filter((item) => item.id !== suspended.id));
    }
    setCart(suspended.cart); setCustomer(suspended.customer); setMember(null); setCredential("");
    setDiscountAmount(suspended.discountAmount); setNekudotAmount("0"); setDrawer(null); saleKey.current = newSaleKey();
    setMessage({ tone: "success", text: "Venta recuperada. Vuelve a leer la tarjeta si el cliente desea usar Nekudot." });
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }

  async function openPrinter(device: UsbDevice) {
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    if (!device.configuration) throw new Error("La impresora no tiene configuración USB activa.");
    for (const iface of device.configuration.interfaces) for (const alternate of iface.alternates) {
      const endpoint = alternate.endpoints.find((candidate) => candidate.direction === "out");
      if (!endpoint) continue;
      await device.claimInterface(iface.interfaceNumber);
      if (alternate.alternateSetting) await device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting);
      printer.current = { device, endpoint: endpoint.endpointNumber };
      setPrinterName(device.productName || "Impresora conectada"); return;
    }
    throw new Error("La impresora no expone un canal USB compatible.");
  }

  async function connectPrinter() {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) return setMessage({ tone: "error", text: "Usa Chrome para conectar la impresora USB." });
    try {
      const device = await usb.requestDevice({ filters: [{ classCode: 7 }, { vendorId: 0x1a86 }, { vendorId: 0x0403 }] });
      await openPrinter(device); setMessage({ tone: "success", text: "Impresora de tickets conectada." });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo conectar." }); }
  }

  async function printSale(sale: Sale) {
    try {
      if (!printer.current) {
        const devices = await ((navigator as UsbNavigator).usb?.getDevices() ?? Promise.resolve([]));
        if (!devices[0]) throw new Error("Toca Conectar impresora antes de imprimir.");
        await openPrinter(devices[0]);
      }
      const data = buildReceipt(sale);
      for (let offset = 0; offset < data.length; offset += 64) await printer.current!.device.transferOut(printer.current!.endpoint, data.slice(offset, offset + 64));
      await api(`/api/retail-pos/receipt/${sale.id}`, { method: "POST", body: "{}" });
      setMessage({ tone: "success", text: `Ticket ${sale.shopifyOrderName || sale.id.slice(-8)} impreso.` });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo imprimir." }); }
  }

  function generateTestCredential() {
    const values = new Uint8Array(6);
    globalThis.crypto.getRandomValues(values);
    const suffix = [...values].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    setNewCustomerCredential(`COHENS-TEST-${suffix}`);
    setCredentialLabel("Tarjeta de prueba POS");
    setCardTier("");
    setReplaceCredential(false);
    setIdentityVerified(false);
  }

  function selectCustomerForSale(item: Customer) {
    setCustomer(item); setMember(null); setCredential(""); setNekudotAmount("0"); setDrawer(null);
    setMessage({
      tone: item.member ? "success" : "info",
      text: item.member
        ? `${item.displayName} identificado por su perfil Shopify. Tarjeta ${membershipLabel(item.member)}; para canjear saldo, lee su tarjeta.`
        : `${item.displayName} seleccionado. Asigna una tarjeta para activar su membresía Nekudot.`,
    });
  }

  async function assignCustomerCredential() {
    if (!selectedCustomer || newCustomerCredential.trim().length < 4 || !cardTier) return;
    let managerPin: string | undefined;
    if (initial.staff?.role !== "MANAGER") {
      const pin = window.prompt("Ingresa el PIN del gerente para asignar esta tarjeta:");
      if (pin === null) return;
      managerPin = pin;
    }
    if (replaceCredential && !identityVerified) {
      setMessage({ tone: "error", text: "Confirma que verificaste la identificación antes de reemplazar una tarjeta." });
      return;
    }
    const rawCredential = newCustomerCredential.trim();
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ member: CustomerMembership; message: string }>("/api/retail-pos/customers", {
        method: "POST",
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          credential: rawCredential,
          label: credentialLabel,
          cardTier,
          managerPin,
          replace: replaceCredential,
          identityVerified: identityVerified ? "yes" : "no",
        }),
      });
      const updatedCustomer = { ...selectedCustomer, member: result.member };
      setSelectedCustomer(updatedCustomer);
      setCustomers((current) => current.map((item) => item.id === updatedCustomer.id ? updatedCustomer : item));
      setCustomer(updatedCustomer); setCredential(rawCredential);
      setMessage({ tone: "success", text: `${result.message} Ya puede identificarse con la tarjeta o con su teléfono.` });
      await identifyCredential(rawCredential);
      setCardAssignmentOpen(false);
      setCardTier(""); setReplaceCredential(false); setIdentityVerified(false);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo asignar la tarjeta." });
    } finally { setBusy(false); }
  }

  async function identifyCredential(raw: string) {
    const value = raw.trim(); if (!value) return;
    setCredential(value); setBusy(true); setMessage(null);
    try {
      const result = await api<{ member: Member }>("/api/retail-pos/nekudot", {
        method: "POST",
        body: JSON.stringify({ intent: "lookup", credential: value }),
      });
      setMember(result.member); setNekudotAmount("0");
      if (result.member.customer) setCustomer(result.member.customer);
      setMessage({ tone: "success", text: `${result.member.displayName} identificado. Tarjeta ${cardTierLabel(result.member.cardTier)} · ${result.member.cashbackBasisPoints / 100}% de cashback.` });
    } catch (error) {
      setMember(null);
      if (error instanceof ApiError && error.code === "CREDENTIAL_NOT_FOUND") {
        setNewCustomerCredential(value);
        setCredentialLabel("Tarjeta NFC Retail POS");
        setCardTier("");
        setSelectedCustomer(customer);
        setCustomerSearch("");
        setReplaceCredential(false);
        setIdentityVerified(false);
        setDrawer(null);
        setCashCheckoutOpen(false);
        setCardAssignmentOpen(true);
        setMessage({ tone: "info", text: "Tarjeta nueva detectada. Selecciona el cliente al que deseas asignarla." });
      } else {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo leer la tarjeta." });
      }
    }
    finally { setBusy(false); }
  }

  function closeCardAssignment() {
    if (busy) return;
    setCardAssignmentOpen(false);
    setNewCustomerCredential("");
    setCustomerSearch("");
    setSelectedCustomer(null);
    setCardTier("");
    setReplaceCredential(false);
    setIdentityVerified(false);
    setCredential("");
  }

  async function charge(paymentMethod: "CASH" | "EXTERNAL_CARD" | "SPLIT", receivedCash?: string) {
    if (!shift || !cart.length) return false;
    let cashPaid: string | undefined;
    let cashReceived: string | undefined;
    let externalReference: string | undefined;
    if (paymentMethod === "CASH" && amountDueCents > 0) {
      if (receivedCash === undefined) return false;
      cashReceived = receivedCash;
    }
    if (paymentMethod === "SPLIT") {
      const cash = window.prompt(`Total ${formatMoney(amountDueCents)}. ¿Cuánto se pagará en efectivo?`, (amountDueCents / 200).toFixed(2));
      if (cash === null) return; cashPaid = cash; cashReceived = cash;
    }
    if ((paymentMethod === "EXTERNAL_CARD" || paymentMethod === "SPLIT") && amountDueCents > 0) {
      if (!window.confirm("Confirma que la terminal externa aprobó el cobro.")) return;
      externalReference = window.prompt("Referencia de terminal (opcional):", "") ?? undefined;
    }
    let managerPin: string | undefined;
    if (discountCents > 0 && initial.staff?.role !== "MANAGER") {
      const pin = window.prompt(`Descuento de ${formatMoney(discountCents)}. Ingresa el PIN del gerente:`);
      if (pin === null) return; managerPin = pin;
    }
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ sale: Sale }>("/api/retail-pos/orders", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: saleKey.current,
          paymentMethod,
          cashPaid,
          cashReceived,
          externalReference,
          managerPin,
          discountAmount: (discountCents / 100).toFixed(2),
          customerId: customer?.id,
          items: cart.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })),
          ...(member ? { nekudotCredential: credential, nekudotRedeemAmount: (appliedNekudotCents / 100).toFixed(2) } : {}),
        }),
      });
      clearCurrentSale(); setSales((current) => [result.sale, ...current.filter((sale) => sale.id !== result.sale.id)]);
      setMessage({ tone: "success", text: `Venta ${result.sale.shopifyOrderName || result.sale.id.slice(-8)} registrada en Shopify${result.sale.changeCents ? `. Cambio: ${formatMoney(result.sale.changeCents)}` : ""}.` });
      await printSale(result.sale); await loadData();
      return true;
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cobrar." }); return false; }
    finally { setBusy(false); }
  }

  function openCashCheckout() {
    setCashReceivedInput("");
    setCashCheckoutOpen(true);
  }

  async function submitCashCheckout(event: React.FormEvent) {
    event.preventDefault();
    const receivedCents = moneyInputCents(cashReceivedInput);
    if (receivedCents < amountDueCents) return;
    const completed = await charge("CASH", (receivedCents / 100).toFixed(2));
    if (completed) setCashCheckoutOpen(false);
  }

  async function retrySale(sale: Sale) {
    setBusy(true);
    try {
      const result = await api<{ sale: Sale }>("/api/retail-pos/orders", { method: "POST", body: JSON.stringify({ retrySaleId: sale.id }) });
      setSales((current) => [result.sale, ...current.filter((item) => item.id !== result.sale.id)]);
      setMessage({ tone: "success", text: `Venta ${result.sale.shopifyOrderName} sincronizada.` }); await printSale(result.sale); await loadData();
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo reintentar." }); }
    finally { setBusy(false); }
  }

  async function refundSale(sale: Sale) {
    if (!window.confirm(`¿Reembolsar completamente ${sale.shopifyOrderName}? Las existencias regresarán al inventario de Shopify.`)) return;
    const managerPin = initial.staff?.role === "MANAGER" ? undefined : window.prompt("PIN del gerente:");
    if (initial.staff?.role !== "MANAGER" && managerPin === null) return;
    setBusy(true);
    try {
      const result = await api<{ sale: Sale }>("/api/retail-pos/orders", { method: "POST", body: JSON.stringify({ refundSaleId: sale.id, managerPin }) });
      setSales((current) => current.map((item) => item.id === result.sale.id ? result.sale : item));
      setMessage({ tone: "success", text: `Pedido ${result.sale.shopifyOrderName} reembolsado y devuelto al inventario.` }); await loadData();
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo reembolsar." }); }
    finally { setBusy(false); }
  }

  async function openShift() {
    setBusy(true);
    try {
      const result = await api<{ shift: Shift }>("/api/retail-pos/shift", { method: "POST", body: JSON.stringify({ intent: "open", openingCash }) });
      setShift(result.shift); setDrawer(null); setMessage({ tone: "success", text: "Caja de tienda abierta." });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo abrir." }); }
    finally { setBusy(false); }
  }

  async function closeShift() {
    if (!window.confirm("¿Cerrar y conciliar la caja de tienda?")) return;
    setBusy(true);
    try {
      const result = await api<{ shift: Shift }>("/api/retail-pos/shift", { method: "POST", body: JSON.stringify({ intent: "close", closingCash, terminalCounted, notes: closeNotes }) });
      setShift(null); setDrawer(null);
      setMessage({ tone: "success", text: `Caja cerrada. Diferencia efectivo: ${formatMoney(result.shift.cashVarianceCents ?? 0)} · terminal: ${formatMoney(result.shift.terminalVarianceCents ?? 0)}.` });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cerrar." }); }
    finally { setBusy(false); }
  }

  async function openStaff() {
    setBusy(true);
    try { const result = await api<{ staff: StaffMember[] }>("/api/retail-pos/staff"); setStaffMembers(result.staff); setDrawer("staff"); }
    catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo abrir empleados." }); }
    finally { setBusy(false); }
  }

  async function saveStaff(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const result = await api<{ staff: StaffMember[] }>("/api/retail-pos/staff", { method: "POST", body: JSON.stringify({ intent: "create", name: staffName, pin: staffPin }) });
      setStaffMembers(result.staff); setStaffName(""); setStaffPin(""); setMessage({ tone: "success", text: "Empleado guardado." });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo guardar." }); }
    finally { setBusy(false); }
  }

  async function toggleStaff(staff: StaffMember) {
    setBusy(true);
    try {
      const result = await api<{ staff: StaffMember[] }>("/api/retail-pos/staff", { method: "POST", body: JSON.stringify({ intent: "toggle", staffId: staff.id, active: !staff.active }) });
      setStaffMembers(result.staff);
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se actualizó el acceso." }); }
    finally { setBusy(false); }
  }

  async function logout() {
    await api("/api/retail-pos/auth", { method: "POST", body: JSON.stringify({ intent: "logout" }) }).catch(() => undefined);
    window.location.reload();
  }

  if (!initial.staff) return <Login />;

  return <div className="retail-shell">
    <header className="retail-topbar">
      <div className="retail-brand"><div className="retail-logo small">C</div><div><h1>Cohen&apos;s Store</h1><small>Retail POS · {initial.staff.name}{initial.staff.role === "MANAGER" ? " · Gerente" : ""}</small></div></div>
      <div className="retail-top-actions">
        <button className="retail-button dark" onClick={connectPrinter}>Impresora <span>{printerName ? "✓" : ""}</span></button>
        <button className="retail-button dark" onClick={() => setDrawer("catalog")}>Catálogo</button>
        <button className="retail-button dark" onClick={() => setDrawer("customers")}>Clientes</button>
        <button className="retail-button dark" onClick={() => setDrawer("reader")}>Lectores</button>
        <button className="retail-button dark" onClick={() => setDrawer("suspended")}>En espera <span className="retail-counter">{suspendedSales.length}</span></button>
        <button className="retail-button dark" onClick={() => setDrawer("orders")}>Pedidos</button>
        <button className="retail-button dark" onClick={() => setDrawer("shift")}>Caja</button>
        {initial.staff.role === "MANAGER" ? <button className="retail-button dark" onClick={openStaff}>Equipo</button> : null}
        <button className="retail-button dark" onClick={logout}>Salir</button>
      </div>
    </header>
    <div className="retail-layout">
      <main className="retail-sale-workspace">
        <section className="retail-scan-station">
          <div className="retail-scan-heading"><div><span className="retail-kicker">CAJA DE SUPERMERCADO</span><h2>Escanea el siguiente artículo</h2></div><div className="retail-sync"><span>{lastUpdatedAt ? `Shopify en vivo · ${catalogMeta?.productCount ?? products.length} productos · ${lastUpdatedAt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Sincronizando catálogo completo…"}</span><button type="button" disabled={catalogRefreshing} onClick={() => { void loadCatalog().catch((error) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo actualizar Shopify." })); }}>{catalogRefreshing ? "Actualizando…" : "Actualizar"}</button></div></div>
          <form className="retail-search" onSubmit={scanOrSearch}>
            <span className="retail-scan-icon">▣</span>
            <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código de barras, SKU o nombre del producto" autoComplete="off" />
            <label className="retail-scan-quantity"><span>Cant.</span><input type="number" min="1" max="99" value={scanQuantity} onChange={(event) => setScanQuantity(Math.max(1, Math.min(99, Number(event.target.value) || 1)))} /></label>
            <button>Agregar</button>
          </form>
          <div className="retail-operation-actions">
            <button onClick={() => setDrawer("catalog")}>⌕ Buscar en catálogo</button>
            <button disabled={!cart.length} onClick={suspendCurrentSale}>Ⅱ Poner venta en espera</button>
            <button disabled={!suspendedSales.length} onClick={() => setDrawer("suspended")}>↶ Recuperar venta ({suspendedSales.length})</button>
            <button className="danger" disabled={!cart.length} onClick={() => { if (window.confirm("¿Cancelar la venta actual?")) clearCurrentSale(); }}>Cancelar venta</button>
          </div>
        </section>
        {message ? <div className={`retail-alert ${message.tone}`}>{message.text}</div> : null}
        {!shift ? <div className="retail-alert warning">Abre la caja antes de registrar ventas.</div> : null}
        <section className="retail-basket-panel">
          <div className="retail-basket-head"><div><span className="retail-kicker">VENTA ACTUAL</span><h2>{itemCount} {itemCount === 1 ? "artículo" : "artículos"}</h2></div><strong>{formatMoney(grossCents)}</strong></div>
          <div className="retail-basket-columns"><span>Artículo</span><span>Cant.</span><span>Precio</span><span>Importe</span><span /></div>
          <div className="retail-basket-lines">{cart.length === 0 ? <div className="retail-empty basket"><span className="retail-empty-scan">▣</span><strong>Lista para escanear</strong><span>El lector agrega cada artículo directamente a esta venta.</span></div> : cart.map((line) => <div className={`retail-basket-line ${lastScannedVariantId === line.variant.id ? "latest" : ""}`} key={line.variant.id}>
            <div className="retail-basket-product"><strong>{line.product.title}</strong><small>{line.variant.title !== "Default Title" ? line.variant.title : line.variant.barcode || line.variant.sku || line.product.vendor || "Producto Shopify"}</small></div>
            <div className="retail-qty"><button aria-label="Restar uno" onClick={() => changeQuantity(line.variant.id, -1)}>−</button><span>{line.quantity}</span><button aria-label="Sumar uno" onClick={() => changeQuantity(line.variant.id, 1)}>+</button></div>
            <span>{formatMoney(line.variant.priceCents)}</span><b>{formatMoney(line.variant.priceCents * line.quantity)}</b>
            <button className="retail-line-remove" aria-label={`Quitar ${line.product.title}`} onClick={() => setCart((current) => current.filter((item) => item.variant.id !== line.variant.id))}>×</button>
          </div>)}</div>
        </section>
        <section className="retail-quick-panel"><div className="retail-quick-heading"><div><span className="retail-kicker">TECLAS RÁPIDAS</span><strong>Productos frecuentes / sin código a la mano</strong></div><button onClick={() => setDrawer("catalog")}>Ver todo</button></div><div className="retail-quick-grid">{quickVariants.map(({ product, variant }) => <button key={variant.id} disabled={!variantCanSell(variant)} onClick={() => add(product, variant)}><span>{product.title}</span><b>{formatMoney(variant.priceCents)}</b></button>)}</div></section>
      </main>
      <aside className="retail-cart retail-checkout">
        <div className="retail-cart-title"><div><span className="retail-kicker">CLIENTE Y COBRO</span><h2>Finalizar venta</h2></div><span className={`retail-shift-dot ${shift ? "open" : ""}`}>{shift ? "Caja abierta" : "Caja cerrada"}</span></div>
        <section className="retail-customer-card">
          <div>{customer ? <><strong>{customer.displayName}</strong><small>{customer.phone || customer.email || "Cliente Shopify"}{member ? ` · ${membershipLabel(member)}` : customer.member ? ` · ${membershipLabel(customer.member)}` : ""}</small></> : <><strong>¿Tiene tarjeta Cohen&apos;s?</strong><small>Escanéala o búscalo por teléfono para sumar 2%, 5% u 8%</small></>}</div>
          <button onClick={() => setDrawer("customers")}>{customer ? "Cambiar" : "Leer tarjeta"}</button>
        </section>
        {!member && drawer !== "customers" && drawer !== "reader" ? <NfcBridgeReader compact className="retail-checkout-reader" onCredential={(value) => { void identifyCredential(value); }} /> : null}
        <div className={`retail-loyalty-summary ${activeMembership ? "active" : ""}`}><span>Nekudot Cohen&apos;s</span>{member ? <><strong>{formatMoney(member.availableCents)} disponibles · {membershipLabel(member)}</strong><small>Esta compra generará aproximadamente {formatMoney(activeCashbackCents)}.</small></> : customer?.member ? <><strong>{formatMoney(customer.member.availableCents)} disponibles · {membershipLabel(customer.member)}</strong><small>Identificado por teléfono/perfil; lee su tarjeta para canjear.</small></> : <><strong>2%, 5% u 8% de regreso</strong><small>Identifica al cliente antes de cobrar.</small></>}</div>
        <section className="retail-adjustments">
          <label>Descuento autorizado<input type="number" min="0" max={(Math.max(0, grossCents - 1) / 100).toFixed(2)} step="0.01" value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} /></label>
          {member ? <label>Usar Nekudot<div><input type="number" min="0" max={(Math.min(afterDiscountCents, member.availableCents) / 100).toFixed(2)} step="0.01" value={nekudotAmount} onChange={(event) => setNekudotAmount(event.target.value)} /><button onClick={() => setNekudotAmount((Math.min(afterDiscountCents, member.availableCents) / 100).toFixed(2))}>Máximo</button></div></label> : null}
        </section>
        <div className="retail-totals">
          <div><span>{itemCount} artículos</span><span>{formatMoney(grossCents)}</span></div>{discountCents ? <div className="deduction"><span>Descuento</span><span>−{formatMoney(discountCents)}</span></div> : null}{appliedNekudotCents ? <div className="deduction"><span>Nekudot usados</span><span>−{formatMoney(appliedNekudotCents)}</span></div> : null}
          <div className="grand"><span>A pagar</span><span>{formatMoney(amountDueCents)}</span></div><small>Pedido, cliente e inventario se registran en Shopify</small>
        </div>
        <div className="retail-payment-grid"><button className="cash" disabled={busy || !shift || !cart.length} onClick={openCashCheckout}><span>EFECTIVO</span><b>{formatMoney(amountDueCents)}</b></button><button className="card" disabled={busy || !shift || !cart.length} onClick={() => charge("EXTERNAL_CARD")}><span>TARJETA</span><b>Terminal</b></button><button className="split" disabled={busy || !shift || !cart.length || amountDueCents <= 1} onClick={() => charge("SPLIT")}><span>PAGO</span><b>Mixto</b></button></div>
      </aside>
    </div>
    {cardAssignmentOpen ? <div className="retail-card-assignment-backdrop">
      <button type="button" className="retail-card-assignment-dismiss" aria-label="Cerrar asignación de tarjeta" disabled={busy} onClick={closeCardAssignment} />
      <section className="retail-card-assignment-modal" role="dialog" aria-modal="true" aria-labelledby="retail-card-assignment-title">
        <button type="button" className="retail-cash-close" aria-label="Cerrar asignación de tarjeta" disabled={busy} onClick={closeCardAssignment}>×</button>
        <span className="retail-kicker">TARJETA NUEVA DETECTADA</span>
        <h2 id="retail-card-assignment-title">¿A qué cliente pertenece?</h2>
        <div className="retail-new-card-summary"><span>Tarjeta lista para vincular</span><strong>•••• {newCustomerCredential.slice(-4).toUpperCase()}</strong></div>
        <p>Selecciona al cliente y el tipo de tarjeta. La lista de Shopify aparece automáticamente y este campo solo la filtra.</p>
        <div className="retail-customer-search retail-card-customer-search">
          <input ref={cardCustomerSearchRef} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Filtrar por nombre, teléfono o correo…" aria-label="Filtrar clientes para asignar tarjeta" />
        </div>
        <div className="retail-customer-results retail-card-customer-results">
          {visibleCustomers.map((item) => <button type="button" key={item.id} className={selectedCustomer?.id === item.id ? "selected" : ""} onClick={() => { setSelectedCustomer(item); setCardTier(""); }}>
            <span className="retail-customer-avatar">{item.displayName.slice(0, 2).toUpperCase()}</span>
            <span><strong>{item.displayName}</strong><small>{item.phone || item.email || "Sin teléfono ni correo"} · {item.numberOfOrders || 0} pedidos</small><em className={item.member ? "active" : ""}>{item.member ? `${membershipLabel(item.member)} · ${formatMoney(item.member.availableCents)} Nekudot · ${item.member.credentialCount} tarjeta(s)` : "Sin tarjeta Nekudot"}</em></span>
            <i>{selectedCustomer?.id === item.id ? "✓" : "›"}</i>
          </button>)}
        </div>
        {customersLoading ? <div className="retail-empty compact"><strong>Cargando clientes…</strong></div> : null}
        {customersLoaded && !customersLoading && !visibleCustomers.length ? <div className="retail-empty compact"><strong>No encontramos coincidencias</strong><span>Prueba otro nombre, teléfono o correo.</span></div> : null}
        {selectedCustomer ? <div className="retail-card-selected-customer">
          <span className="retail-customer-avatar large">{selectedCustomer.displayName.slice(0, 2).toUpperCase()}</span>
          <div><small>CLIENTE SELECCIONADO</small><strong>{selectedCustomer.displayName}</strong><span>{selectedCustomer.phone || selectedCustomer.email || "Cliente Shopify"}</span></div>
        </div> : <div className="retail-card-selection-help">Selecciona un cliente para continuar.</div>}
        <label className="retail-field">Tipo de tarjeta
          <select value={cardTier} onChange={(event) => setCardTier(event.target.value as NekudotCardTier | "")} required>
            <option value="">Selecciona el tipo de tarjeta…</option>
            <option value="SILVER">Silver · {cashbackPercentForTier("SILVER")}% cashback · venta en tienda</option>
            <option value="BLUE">Blue · {cashbackPercentForTier("BLUE")}% cashback · Bet Midrash / Bet Knesiot</option>
            <option value="GOLDEN">Golden · {cashbackPercentForTier("GOLDEN")}% cashback · mensualidad</option>
          </select>
        </label>
        <div className="retail-card-modal-actions">
          <button type="button" disabled={busy} onClick={closeCardAssignment}>Cancelar</button>
          <button type="button" className="primary" disabled={busy || !selectedCustomer || !cardTier || newCustomerCredential.trim().length < 4} onClick={assignCustomerCredential}>{busy ? "Asignando…" : selectedCustomer && cardTier ? `Asignar ${cardTierLabel(cardTier)} a ${selectedCustomer.displayName}` : "Selecciona cliente y tipo"}</button>
        </div>
      </section>
    </div> : null}
    {cashCheckoutOpen ? <div className="retail-cash-backdrop">
      <button type="button" className="retail-cash-dismiss" aria-label="Cerrar cobro en efectivo" disabled={busy} onClick={() => setCashCheckoutOpen(false)} />
      <section className="retail-cash-modal" role="dialog" aria-modal="true" aria-labelledby="retail-cash-title">
        <button type="button" className="retail-cash-close" aria-label="Cerrar cobro en efectivo" disabled={busy} onClick={() => setCashCheckoutOpen(false)}>×</button>
        <span className="retail-kicker">COBRO EN EFECTIVO</span>
        <h2 id="retail-cash-title">¿Con cuánto paga?</h2>
        <div className="retail-cash-total"><span>Total de la venta</span><strong>{formatMoney(amountDueCents)}</strong></div>
        <form onSubmit={submitCashCheckout}>
          <label htmlFor="retail-cash-received">Efectivo recibido</label>
          <div className="retail-cash-input"><span>$</span><input ref={cashInputRef} id="retail-cash-received" inputMode="decimal" type="number" min={(amountDueCents / 100).toFixed(2)} step="0.01" value={cashReceivedInput} onChange={(event) => setCashReceivedInput(event.target.value)} placeholder={(amountDueCents / 100).toFixed(2)} /></div>
          <div className="retail-cash-bills" aria-label="Billetes sugeridos">
            {[amountDueCents, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000]
              .filter((value, index, values) => value >= amountDueCents && values.indexOf(value) === index)
              .sort((left, right) => left - right)
              .map((value) => <button type="button" key={value} onClick={() => setCashReceivedInput((value / 100).toFixed(2))}>{value === amountDueCents ? "Pago exacto" : formatMoney(value)}</button>)}
          </div>
          {moneyInputCents(cashReceivedInput) >= amountDueCents ? <div className="retail-cash-change ready"><span>Cambio a entregar</span><strong>{formatMoney(moneyInputCents(cashReceivedInput) - amountDueCents)}</strong></div> : <div className="retail-cash-change"><span>{cashReceivedInput ? "Falta para cubrir el total" : "Selecciona un billete o escribe el importe"}</span><strong>{cashReceivedInput ? formatMoney(amountDueCents - moneyInputCents(cashReceivedInput)) : "—"}</strong></div>}
          <div className="retail-cash-actions"><button type="button" disabled={busy} onClick={() => setCashCheckoutOpen(false)}>Cancelar</button><button type="submit" className="primary" disabled={busy || moneyInputCents(cashReceivedInput) < amountDueCents}>{busy ? "Registrando…" : `Cobrar ${formatMoney(amountDueCents)}`}</button></div>
        </form>
      </section>
    </div> : null}
    {drawer ? <><button type="button" className="retail-drawer-backdrop" aria-label="Cerrar panel" onClick={() => setDrawer(null)} /><aside className="retail-drawer"><button className="retail-button secondary" onClick={() => setDrawer(null)}>Cerrar</button>
      {drawer === "catalog" ? <><span className="retail-kicker">CATÁLOGO SHOPIFY</span><h2>Buscar producto</h2>
        <div className="retail-catalog-status"><div><strong>{catalogMeta?.productCount ?? products.length} productos · {catalogMeta?.variantCount ?? products.reduce((sum, product) => sum + product.variants.length, 0)} variantes</strong><small>Ubicación: {catalogMeta?.location.name ?? "Plaza Victoria"} · incluye productos sin existencia</small></div><button type="button" disabled={catalogRefreshing} onClick={() => { void loadCatalog().catch((error) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo actualizar Shopify." })); }}>{catalogRefreshing ? "Consultando…" : "Actualizar Shopify"}</button></div>
        <input className="retail-catalog-search" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Nombre, SKU, código o marca" />
        <div className="retail-filters">{vendors.slice(0, 16).map((item) => <button key={item} className={vendor === item ? "active" : ""} onClick={() => setVendor(item)}>{item}</button>)}</div>
        <div className="retail-product-grid drawer-grid">{visibleProducts.map((product) => <article className="retail-product" key={product.id}>
          {product.imageUrl ? <img src={product.imageUrl} alt={product.imageAlt} /> : <div className="retail-placeholder">C</div>}
          <div className="retail-product-copy"><small>{product.vendor || product.productType || "COHEN'S"}</small><strong>{product.title}</strong><div className="retail-variants">{product.variants.map((variant) => {
            const soldOut = !variantCanSell(variant);
            const stockLabel = !variant.tracked
              ? "Sin control de inventario"
              : variant.available > 0
                ? `${variant.available} en stock`
                : variant.inventoryPolicy === "CONTINUE"
                  ? "0 en stock · Shopify permite vender"
                  : "Agotado · visible, no vendible";
            return <button key={variant.id} disabled={soldOut} onClick={() => { add(product, variant); setDrawer(null); window.requestAnimationFrame(() => searchRef.current?.focus()); }}><span>{variant.title === "Default Title" ? "Agregar" : variant.title}</span><b>{formatMoney(variant.priceCents)}</b><em>{stockLabel}</em></button>;
          })}</div></div>
        </article>)}</div>
        {!visibleProducts.length ? <div className="retail-empty"><strong>Sin coincidencias</strong><span>Prueba con otro nombre, SKU o código.</span></div> : null}
      </> : null}
      {drawer === "suspended" ? <><span className="retail-kicker">CONTINUIDAD DE CAJA</span><h2>Ventas en espera</h2>
        {!suspendedSales.length ? <div className="retail-empty"><strong>No hay ventas en espera</strong><span>Puedes apartar temporalmente una venta sin perder sus artículos ni su cliente.</span></div> : <div className="retail-suspended-list">{suspendedSales.map((suspended) => <article key={suspended.id}><div><strong>{suspended.customer?.displayName || "Cliente ocasional"}</strong><b>{formatMoney(suspended.cart.reduce((sum, line) => sum + line.variant.priceCents * line.quantity, 0))}</b></div><small>{new Date(suspended.createdAt).toLocaleString("es-MX")} · {suspended.cart.reduce((sum, line) => sum + line.quantity, 0)} artículos</small><div><button onClick={() => resumeSuspendedSale(suspended)}>Recuperar venta</button><button className="danger" onClick={() => setSuspendedSales((current) => current.filter((item) => item.id !== suspended.id))}>Eliminar</button></div></article>)}</div>}
      </> : null}
      {drawer === "customers" ? <><span className="retail-kicker">CLIENTES SHOPIFY + NEKUDOT</span><h2>Clientes</h2>
        <div className="retail-member-scan"><strong>Identificación inmediata por tarjeta</strong><form onSubmit={(event) => { event.preventDefault(); void identifyCredential(credential); }}><input value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="Código de barras / QR / NFC" autoComplete="off" /><button disabled={busy || credential.length < 4}>Leer</button></form><NfcBridgeReader onCredential={(value) => { void identifyCredential(value); }} /></div>
        {member ? <div className="retail-selected"><strong>{member.displayName}</strong><span>{formatMoney(member.availableCents)} disponible · Tarjeta {membershipLabel(member)}{member.broker ? ` · Broker ${member.broker.displayName}` : ""}</span></div> : null}
        <div className="retail-customer-search-heading"><strong>Clientes de Cohen&apos;s</strong><small>La lista completa aparece abajo; escribe solo para filtrar</small></div>
        <div className="retail-customer-search"><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Filtrar por nombre, teléfono o correo…" /></div>
        <div className="retail-customer-results">{visibleCustomers.map((item) => <button key={item.id} className={selectedCustomer?.id === item.id ? "selected" : ""} onClick={() => { setSelectedCustomer(item); setNewCustomerCredential(""); setCardTier(""); setReplaceCredential(false); setIdentityVerified(false); }}><span className="retail-customer-avatar">{item.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{item.displayName}</strong><small>{item.phone || item.email || "Sin teléfono ni correo"} · {item.numberOfOrders || 0} pedidos</small><em className={item.member ? "active" : ""}>{item.member ? `${membershipLabel(item.member)} · ${formatMoney(item.member.availableCents)} Nekudot · ${item.member.credentialCount} tarjeta(s)` : "Sin tarjeta Nekudot"}</em></span><i>{selectedCustomer?.id === item.id ? "✓" : "›"}</i></button>)}</div>
        {customersLoading ? <div className="retail-empty compact"><strong>Cargando clientes…</strong></div> : null}
        {customersLoaded && !customersLoading && !visibleCustomers.length ? <div className="retail-empty compact"><strong>No encontramos coincidencias</strong><span>Prueba otro nombre, teléfono o correo.</span></div> : null}
        {selectedCustomer ? <section className="retail-customer-profile">
          <div className="retail-customer-profile-head"><span className="retail-customer-avatar large">{selectedCustomer.displayName.slice(0, 2).toUpperCase()}</span><div><span className="retail-kicker">CLIENTE SELECCIONADO</span><h3>{selectedCustomer.displayName}</h3><p>{selectedCustomer.phone || "Sin teléfono"} · {selectedCustomer.email || "Sin correo"}</p></div></div>
          {selectedCustomer.member ? <div className="retail-membership-status active"><strong>Tarjeta {membershipLabel(selectedCustomer.member)}</strong><span>{formatMoney(selectedCustomer.member.availableCents)} disponibles · {selectedCustomer.member.credentialCount} tarjeta(s){selectedCustomer.member.credentialLastFour ? ` · termina ${selectedCustomer.member.credentialLastFour}` : ""}</span></div> : <div className="retail-membership-status"><strong>Aún no tiene tarjeta</strong><span>Al asignarla se crea su wallet compartida con la cafetería.</span></div>}
          <button className="retail-button primary wide" onClick={() => selectCustomerForSale(selectedCustomer)}>Usar este cliente en la venta</button>
          <div className="retail-card-assignment"><span className="retail-kicker">ASIGNAR TARJETA RFID / QR</span><label>ID de la tarjeta<input value={newCustomerCredential} onChange={(event) => setNewCustomerCredential(event.target.value)} placeholder="Acerca la tarjeta o genera una de prueba" /></label><NfcBridgeReader compact onCredential={setNewCustomerCredential} /><label>Etiqueta<input value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} maxLength={80} /></label><label>Tipo de tarjeta<select value={cardTier} onChange={(event) => setCardTier(event.target.value as NekudotCardTier | "")} required><option value="">Selecciona el tipo…</option><option value="SILVER">Silver · 2% · venta en tienda</option><option value="BLUE">Blue · 5% · Bet Midrash / Bet Knesiot</option><option value="GOLDEN">Golden · 8% · mensualidad</option></select></label><div className="retail-card-actions"><button type="button" onClick={generateTestCredential}>Generar ID de prueba</button><button type="button" className="primary" disabled={busy || !cardTier || newCustomerCredential.trim().length < 4 || (replaceCredential && !identityVerified)} onClick={assignCustomerCredential}>{busy ? "Asignando…" : cardTier ? `Asignar ${cardTierLabel(cardTier)}` : "Selecciona el tipo"}</button></div>
            {selectedCustomer.member ? <div className="retail-replace-option"><label><input type="checkbox" checked={replaceCredential} onChange={(event) => { setReplaceCredential(event.target.checked); if (!event.target.checked) setIdentityVerified(false); }} /> Reemplazar tarjetas anteriores</label>{replaceCredential ? <label><input type="checkbox" checked={identityVerified} onChange={(event) => setIdentityVerified(event.target.checked)} /> Verifiqué personalmente su identificación</label> : null}</div> : null}
          </div>
        </section> : null}
        {customer ? <button className="retail-button danger wide" onClick={() => { setCustomer(null); setMember(null); setCredential(""); setDrawer(null); }}>Continuar sin cliente</button> : null}
      </> : null}
      {drawer === "reader" ? <><span className="retail-kicker">HARDWARE Y CONTROL DE CALIDAD</span><h2>Prueba del lector</h2><NfcReaderDiagnostics lookupEndpoint="/api/retail-pos/nekudot" locationLabel="Tienda" /></> : null}
      {drawer === "orders" ? <><span className="retail-kicker">SHOPIFY</span><h2>Ventas recientes</h2>{sales.map((sale) => <article className="retail-sale" key={sale.id}><div><strong>{sale.shopifyOrderName || sale.id.slice(-8)}</strong><b>{formatMoney(sale.totalCents)}</b></div><small>{new Date(sale.createdAt).toLocaleString("es-MX")} · {sale.staff.name}{sale.customerName ? ` · ${sale.customerName}` : ""}</small><span className={`retail-badge ${sale.status.toLowerCase()}`}>{sale.status === "SYNCED" ? "Shopify sincronizado" : sale.status === "REFUNDED" ? "Reembolsado" : "Pendiente"}</span>{sale.errorMessage ? <div className="retail-alert warning">{sale.errorMessage}</div> : null}<div className="retail-sale-actions"><button onClick={() => printSale(sale)}>Reimprimir</button>{sale.status === "SYNCED" ? <button className="danger" disabled={busy} onClick={() => refundSale(sale)}>Reembolsar y reponer</button> : null}{sale.status === "PENDING_SYNC" ? <button disabled={busy} onClick={() => retrySale(sale)}>Reintentar</button> : null}</div></article>)}</> : null}
      {drawer === "shift" ? <><span className="retail-kicker">CONTROL DE CAJA</span><h2>Turno de tienda</h2>{!shift ? <><p>No hay una caja abierta.</p><label className="retail-field">Fondo inicial<input type="number" min="0" step="0.01" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label><button className="retail-button primary wide" disabled={busy} onClick={openShift}>Abrir caja</button></> : <><div className="retail-selected"><strong>Abierta por {shift.staff.name}</strong><span>{new Date(shift.openedAt).toLocaleString("es-MX")} · Fondo {formatMoney(shift.openingCashCents)}</span></div><label className="retail-field">Efectivo contado<input type="number" min="0" step="0.01" value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><label className="retail-field">Total de terminal<input type="number" min="0" step="0.01" value={terminalCounted} onChange={(event) => setTerminalCounted(event.target.value)} /></label><label className="retail-field">Notas<textarea value={closeNotes} onChange={(event) => setCloseNotes(event.target.value)} /></label><button className="retail-button danger wide" disabled={busy || closingCash === "" || terminalCounted === ""} onClick={closeShift}>Cerrar y conciliar</button></>}</> : null}
      {drawer === "staff" ? <><span className="retail-kicker">SEGURIDAD</span><h2>Equipo de tienda</h2><form onSubmit={saveStaff}><label className="retail-field">Nombre<input value={staffName} onChange={(event) => setStaffName(event.target.value)} required /></label><label className="retail-field">PIN<input value={staffPin} onChange={(event) => setStaffPin(event.target.value.replace(/\D/g, "").slice(0, 8))} type="password" inputMode="numeric" required /></label><button className="retail-button primary wide" disabled={busy || staffPin.length < 4}>Guardar cajero</button></form><div className="retail-staff-list">{staffMembers.map((item) => <div key={item.id}><span><strong>{item.name}</strong><small>{item.role === "MANAGER" ? "Gerente" : "Cajero"} · {item.active ? "Activo" : "Desactivado"}</small></span><button disabled={item.role === "MANAGER" || busy} onClick={() => toggleStaff(item)}>{item.active ? "Desactivar" : "Activar"}</button></div>)}</div></> : null}
    </aside></> : null}
  </div>;
}
