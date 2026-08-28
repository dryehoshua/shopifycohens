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
import "../nfc-bridge.css";

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
type Customer = { id: string; displayName: string; email: string | null; numberOfOrders?: number; amountSpent?: string };
type Member = {
  id: string;
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
type Drawer = "orders" | "shift" | "staff" | "customers" | null;

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

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "No se pudo completar la operación.");
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
  const [vendor, setVendor] = useState("Todos");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
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
  const printer = useRef<{ device: UsbDevice; endpoint: number } | null>(null);
  const saleKey = useRef(newSaleKey());
  const searchRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const [catalogResult, salesResult, shiftResult] = await Promise.all([
      api<{ products: Product[] }>("/api/retail-pos/catalog"),
      api<{ sales: Sale[] }>("/api/retail-pos/orders?limit=50"),
      api<{ shift: Shift | null }>("/api/retail-pos/shift"),
    ]);
    setProducts(catalogResult.products); setSales(salesResult.sales); setShift(shiftResult.shift); setLastUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    const refresh = () => loadData().catch((error) => setMessage({ tone: "error", text: error.message }));
    refresh();
    const interval = window.setInterval(refresh, 45_000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/retail-pos-sw.js").catch(() => undefined);
    return () => window.clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) return;
    usb.getDevices().then((devices) => { if (devices[0]) setPrinterName(devices[0].productName || "Impresora autorizada"); }).catch(() => undefined);
  }, []);

  const vendors = useMemo(() => ["Todos", ...new Set(products.map((product) => product.vendor).filter(Boolean))], [products]);
  const normalizedSearch = search.trim().toLocaleLowerCase("es-MX");
  const visibleProducts = useMemo(() => products.filter((product) => {
    if (vendor !== "Todos" && product.vendor !== vendor) return false;
    if (!normalizedSearch) return true;
    return [product.title, product.vendor, product.productType, ...product.variants.flatMap((variant) => [variant.sku || "", variant.barcode || "", variant.title])]
      .some((value) => value.toLocaleLowerCase("es-MX").includes(normalizedSearch));
  }), [products, vendor, normalizedSearch]);
  const grossCents = useMemo(() => cart.reduce((sum, line) => sum + line.variant.priceCents * line.quantity, 0), [cart]);
  const discountCents = Math.min(moneyInputCents(discountAmount), Math.max(0, grossCents - 1));
  const afterDiscountCents = grossCents - discountCents;
  const requestedNekudotCents = moneyInputCents(nekudotAmount);
  const appliedNekudotCents = member ? Math.min(requestedNekudotCents, member.availableCents, afterDiscountCents) : 0;
  const amountDueCents = afterDiscountCents - appliedNekudotCents;
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  function add(product: Product, variant: Variant) {
    if (variant.tracked && variant.available < 1) return;
    setCart((current) => {
      const index = current.findIndex((line) => line.variant.id === variant.id);
      if (index === -1) return [...current, { product, variant, quantity: 1 }];
      const nextQuantity = current[index].quantity + 1;
      if (variant.tracked && nextQuantity > variant.available) return current;
      const next = [...current]; next[index] = { ...next[index], quantity: nextQuantity }; return next;
    });
  }

  function changeQuantity(variantId: string, delta: number) {
    setCart((current) => current.flatMap((line) => {
      if (line.variant.id !== variantId) return [line];
      const next = line.quantity + delta;
      if (next <= 0) return [];
      if (line.variant.tracked && next > line.variant.available) return [line];
      return [{ ...line, quantity: next }];
    }));
  }

  function scanOrSearch(event: React.FormEvent) {
    event.preventDefault();
    const exact = products.flatMap((product) => product.variants.map((variant) => ({ product, variant })))
      .find(({ variant }) => variant.barcode === search.trim() || variant.sku === search.trim());
    if (exact) {
      add(exact.product, exact.variant); setSearch(""); setMessage({ tone: "success", text: `${exact.product.title} agregado.` });
      window.requestAnimationFrame(() => searchRef.current?.focus());
    }
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

  async function findCustomers(event: React.FormEvent) {
    event.preventDefault();
    if (customerSearch.trim().length < 2) return;
    setBusy(true);
    try {
      const result = await api<{ customers: Customer[] }>(`/api/retail-pos/customers?q=${encodeURIComponent(customerSearch)}`);
      setCustomers(result.customers);
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se encontraron clientes." }); }
    finally { setBusy(false); }
  }

  async function identifyCredential(raw: string) {
    const value = raw.trim(); if (!value) return;
    setCredential(value); setBusy(true); setMessage(null);
    try {
      const result = await api<{ member: Member }>(`/api/retail-pos/nekudot?credential=${encodeURIComponent(value)}`);
      setMember(result.member); setNekudotAmount("0");
      if (result.member.customer) setCustomer(result.member.customer);
      setMessage({ tone: "success", text: `${result.member.displayName} identificado. La compra acumulará 5% en Nekudot.` });
    } catch (error) { setMember(null); setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo leer la tarjeta." }); }
    finally { setBusy(false); }
  }

  async function charge(paymentMethod: "CASH" | "EXTERNAL_CARD" | "SPLIT") {
    if (!shift || !cart.length) return;
    let cashPaid: string | undefined;
    let cashReceived: string | undefined;
    let externalReference: string | undefined;
    if (paymentMethod === "CASH" && amountDueCents > 0) {
      const received = window.prompt(`Total ${formatMoney(amountDueCents)}. ¿Cuánto efectivo recibiste?`, (amountDueCents / 100).toFixed(2));
      if (received === null) return; cashReceived = received;
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
      setCart([]); setCustomer(null); setMember(null); setCredential(""); setNekudotAmount("0"); setDiscountAmount("0");
      saleKey.current = newSaleKey(); setSales((current) => [result.sale, ...current.filter((sale) => sale.id !== result.sale.id)]);
      setMessage({ tone: "success", text: `Venta ${result.sale.shopifyOrderName || result.sale.id.slice(-8)} registrada en Shopify${result.sale.changeCents ? `. Cambio: ${formatMoney(result.sale.changeCents)}` : ""}.` });
      await printSale(result.sale); await loadData();
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cobrar." }); }
    finally { setBusy(false); }
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
        <button className="retail-button dark" onClick={() => setDrawer("orders")}>Pedidos</button>
        <button className="retail-button dark" onClick={() => setDrawer("shift")}>Caja</button>
        {initial.staff.role === "MANAGER" ? <button className="retail-button dark" onClick={openStaff}>Equipo</button> : null}
        <button className="retail-button dark" onClick={logout}>Salir</button>
      </div>
    </header>
    <div className="retail-layout">
      <main className="retail-catalog">
        <div className="retail-catalog-head"><div><span className="retail-kicker">CATÁLOGO SHOPIFY</span><h2>Productos de tienda</h2></div><span className="retail-sync">{lastUpdatedAt ? `Actualizado ${lastUpdatedAt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : "Sincronizando…"}</span></div>
        <form className="retail-search" onSubmit={scanOrSearch}>
          <span>⌕</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Escanea código de barras o busca producto, SKU, marca…" autoComplete="off" /><button>Agregar código</button>
        </form>
        <div className="retail-filters">{vendors.slice(0, 12).map((item) => <button key={item} className={vendor === item ? "active" : ""} onClick={() => setVendor(item)}>{item}</button>)}</div>
        {message ? <div className={`retail-alert ${message.tone}`}>{message.text}</div> : null}
        {!shift ? <div className="retail-alert warning">Abre la caja antes de registrar ventas.</div> : null}
        <div className="retail-product-grid">{visibleProducts.map((product) => <article className="retail-product" key={product.id}>
          {product.imageUrl ? <img src={product.imageUrl} alt={product.imageAlt} /> : <div className="retail-placeholder">C</div>}
          <div className="retail-product-copy"><small>{product.vendor || product.productType || "COHEN'S"}</small><strong>{product.title}</strong>
            <div className="retail-variants">{product.variants.map((variant) => {
              const soldOut = variant.tracked && variant.available <= 0;
              return <button key={variant.id} disabled={soldOut} onClick={() => add(product, variant)}>
                <span>{variant.title === "Default Title" ? "Agregar" : variant.title}</span><b>{formatMoney(variant.priceCents)}</b><em>{variant.tracked ? (soldOut ? "Agotado" : `${variant.available} en stock`) : "Disponible"}</em>
              </button>;
            })}</div>
          </div>
        </article>)}</div>
        {!visibleProducts.length ? <div className="retail-empty"><strong>Sin coincidencias</strong><span>Prueba con otro nombre, SKU o código.</span></div> : null}
      </main>
      <aside className="retail-cart">
        <div className="retail-cart-title"><div><span className="retail-kicker">VENTA ACTUAL</span><h2>{itemCount} {itemCount === 1 ? "artículo" : "artículos"}</h2></div>{cart.length ? <button onClick={() => setCart([])}>Vaciar</button> : null}</div>
        <section className="retail-customer-card">
          <div>{customer ? <><strong>{customer.displayName}</strong><small>{customer.email || "Cliente Shopify"}{member ? ` · ${formatMoney(member.availableCents)} Nekudot` : ""}</small></> : <><strong>Cliente ocasional</strong><small>Identifica al cliente para sumar Nekudot</small></>}</div>
          <button onClick={() => setDrawer("customers")}>{customer ? "Cambiar" : "Agregar"}</button>
        </section>
        <div className="retail-cart-lines">{cart.length === 0 ? <div className="retail-empty compact"><strong>Carrito vacío</strong><span>Escanea o selecciona un producto.</span></div> : cart.map((line) => <div className="retail-cart-line" key={line.variant.id}>
          <div><strong>{line.product.title}</strong><small>{line.variant.title !== "Default Title" ? line.variant.title : line.variant.sku || line.variant.barcode || "Producto"}</small></div><b>{formatMoney(line.variant.priceCents * line.quantity)}</b>
          <div className="retail-qty"><button onClick={() => changeQuantity(line.variant.id, -1)}>−</button><span>{line.quantity}</span><button onClick={() => changeQuantity(line.variant.id, 1)}>+</button><button className="remove" onClick={() => setCart((current) => current.filter((item) => item.variant.id !== line.variant.id))}>Quitar</button></div>
        </div>)}</div>
        <section className="retail-adjustments">
          <label>Descuento autorizado<input type="number" min="0" max={(Math.max(0, grossCents - 1) / 100).toFixed(2)} step="0.01" value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} /></label>
          {member ? <label>Usar Nekudot<div><input type="number" min="0" max={(Math.min(afterDiscountCents, member.availableCents) / 100).toFixed(2)} step="0.01" value={nekudotAmount} onChange={(event) => setNekudotAmount(event.target.value)} /><button onClick={() => setNekudotAmount((Math.min(afterDiscountCents, member.availableCents) / 100).toFixed(2))}>Máximo</button></div></label> : null}
        </section>
        <div className="retail-totals">
          <div><span>Artículos</span><span>{formatMoney(grossCents)}</span></div>{discountCents ? <div className="deduction"><span>Descuento</span><span>−{formatMoney(discountCents)}</span></div> : null}{appliedNekudotCents ? <div className="deduction"><span>Nekudot</span><span>−{formatMoney(appliedNekudotCents)}</span></div> : null}
          <div className="grand"><span>A pagar</span><span>{formatMoney(amountDueCents)}</span></div><small>Precios e IVA sincronizados con Shopify</small>
        </div>
        <div className="retail-payment-grid"><button className="cash" disabled={busy || !shift || !cart.length} onClick={() => charge("CASH")}>Efectivo</button><button className="card" disabled={busy || !shift || !cart.length} onClick={() => charge("EXTERNAL_CARD")}>Terminal</button><button className="split" disabled={busy || !shift || !cart.length || amountDueCents <= 1} onClick={() => charge("SPLIT")}>Pago mixto</button></div>
      </aside>
    </div>
    {drawer ? <><button type="button" className="retail-drawer-backdrop" aria-label="Cerrar panel" onClick={() => setDrawer(null)} /><aside className="retail-drawer"><button className="retail-button secondary" onClick={() => setDrawer(null)}>Cerrar</button>
      {drawer === "customers" ? <><span className="retail-kicker">CLIENTES Y NEKUDOT</span><h2>Identificar cliente</h2>
        <div className="retail-member-scan"><strong>¿Tiene tarjeta Cohen&apos;s?</strong><form onSubmit={(event) => { event.preventDefault(); void identifyCredential(credential); }}><input value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="RFID / QR" /><button disabled={busy || credential.length < 4}>Leer</button></form><NfcBridgeReader onCredential={(value) => { void identifyCredential(value); }} /></div>
        {member ? <div className="retail-selected"><strong>{member.displayName}</strong><span>{formatMoney(member.availableCents)} disponible · 5% en esta compra{member.broker ? ` · Broker ${member.broker.displayName}` : ""}</span></div> : null}
        <form className="retail-customer-search" onSubmit={findCustomers}><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Nombre, correo o teléfono" /><button disabled={busy || customerSearch.length < 2}>Buscar Shopify</button></form>
        <div className="retail-customer-results">{customers.map((item) => <button key={item.id} onClick={() => { setCustomer(item); setMember(null); setCredential(""); setDrawer(null); }}><strong>{item.displayName}</strong><span>{item.email || "Sin correo"} · {item.numberOfOrders || 0} pedidos</span></button>)}</div>
        {customer ? <button className="retail-button danger wide" onClick={() => { setCustomer(null); setMember(null); setCredential(""); setDrawer(null); }}>Continuar sin cliente</button> : null}
      </> : null}
      {drawer === "orders" ? <><span className="retail-kicker">SHOPIFY</span><h2>Ventas recientes</h2>{sales.map((sale) => <article className="retail-sale" key={sale.id}><div><strong>{sale.shopifyOrderName || sale.id.slice(-8)}</strong><b>{formatMoney(sale.totalCents)}</b></div><small>{new Date(sale.createdAt).toLocaleString("es-MX")} · {sale.staff.name}{sale.customerName ? ` · ${sale.customerName}` : ""}</small><span className={`retail-badge ${sale.status.toLowerCase()}`}>{sale.status === "SYNCED" ? "Shopify sincronizado" : sale.status === "REFUNDED" ? "Reembolsado" : "Pendiente"}</span>{sale.errorMessage ? <div className="retail-alert warning">{sale.errorMessage}</div> : null}<div className="retail-sale-actions"><button onClick={() => printSale(sale)}>Reimprimir</button>{sale.status === "SYNCED" ? <button className="danger" disabled={busy} onClick={() => refundSale(sale)}>Reembolsar y reponer</button> : null}{sale.status === "PENDING_SYNC" ? <button disabled={busy} onClick={() => retrySale(sale)}>Reintentar</button> : null}</div></article>)}</> : null}
      {drawer === "shift" ? <><span className="retail-kicker">CONTROL DE CAJA</span><h2>Turno de tienda</h2>{!shift ? <><p>No hay una caja abierta.</p><label className="retail-field">Fondo inicial<input type="number" min="0" step="0.01" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label><button className="retail-button primary wide" disabled={busy} onClick={openShift}>Abrir caja</button></> : <><div className="retail-selected"><strong>Abierta por {shift.staff.name}</strong><span>{new Date(shift.openedAt).toLocaleString("es-MX")} · Fondo {formatMoney(shift.openingCashCents)}</span></div><label className="retail-field">Efectivo contado<input type="number" min="0" step="0.01" value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><label className="retail-field">Total de terminal<input type="number" min="0" step="0.01" value={terminalCounted} onChange={(event) => setTerminalCounted(event.target.value)} /></label><label className="retail-field">Notas<textarea value={closeNotes} onChange={(event) => setCloseNotes(event.target.value)} /></label><button className="retail-button danger wide" disabled={busy || closingCash === "" || terminalCounted === ""} onClick={closeShift}>Cerrar y conciliar</button></>}</> : null}
      {drawer === "staff" ? <><span className="retail-kicker">SEGURIDAD</span><h2>Equipo de tienda</h2><form onSubmit={saveStaff}><label className="retail-field">Nombre<input value={staffName} onChange={(event) => setStaffName(event.target.value)} required /></label><label className="retail-field">PIN<input value={staffPin} onChange={(event) => setStaffPin(event.target.value.replace(/\D/g, "").slice(0, 8))} type="password" inputMode="numeric" required /></label><button className="retail-button primary wide" disabled={busy || staffPin.length < 4}>Guardar cajero</button></form><div className="retail-staff-list">{staffMembers.map((item) => <div key={item.id}><span><strong>{item.name}</strong><small>{item.role === "MANAGER" ? "Gerente" : "Cajero"} · {item.active ? "Activo" : "Desactivado"}</small></span><button disabled={item.role === "MANAGER" || busy} onClick={() => toggleStaff(item)}>{item.active ? "Desactivar" : "Activar"}</button></div>)}</div></> : null}
    </aside></> : null}
  </div>;
}
