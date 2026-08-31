import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import stylesheet from "../cafe-pos.css?url";
import {
  assertCafePosEnabled,
  cafePosJsonError,
  currentCafeSession,
  currentCafeShift,
} from "../cafe-pos.server";
import { formatMoney, receiptColumns, wrapReceiptText, type CafeReceiptItem } from "../cafe-pos-domain";
import { NfcBridgeReader } from "../components/NfcBridgeReader";
import { NfcReaderDiagnostics } from "../components/NfcReaderDiagnostics";
import "../nfc-bridge.css";
import "../nfc-reader-diagnostics.css";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "manifest", href: "/cafe-pos.webmanifest" },
  { rel: "icon", href: "/favicon.ico" },
];

export const meta: MetaFunction = () => [
  { title: "Cohen's Cafe · POS" },
  { name: "theme-color", content: "#321f18" },
  { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const shop = assertCafePosEnabled();
    const session = await currentCafeSession(request, false);
    return {
      enabled: true as const,
      shop,
      staff: session ? { id: session.staff.id, name: session.staff.name, role: session.staff.role } : null,
      shift: session ? await currentCafeShift(shop) : null,
    };
  } catch (error) {
    const response = cafePosJsonError(error);
    if (response.status === 404) throw new Response("No encontrado", { status: 404 });
    throw response;
  }
}

type Variant = {
  id: string;
  title: string;
  sku: string | null;
  priceCents: number;
  tracked: boolean;
  available: number;
};

type Product = {
  id: string;
  title: string;
  handle: string;
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
type Sale = {
  id: string;
  idempotencyKey: string;
  status: string;
  paymentMethod: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  nekudotMemberId?: string | null;
  nekudotRedemptionId?: string | null;
  nekudotRedeemedCents?: number;
  currencyCode: string;
  items: Array<CafeReceiptItem & { variantId?: string }>;
  shopifyOrderName: string | null;
  createdAt: string;
  staff: { name: string };
  errorMessage?: string | null;
  printCount?: number;
  cancelledAt?: string | null;
  cancelledByName?: string | null;
  refundedAt?: string | null;
  refundedByName?: string | null;
};
type StaffMember = {
  id: string;
  name: string;
  role: string;
  active: boolean;
};
type NekudotMember = {
  id: string;
  displayName: string;
  email: string | null;
  balanceCents: number;
  reservedCents: number;
  availableCents: number;
  broker: { displayName: string; code: string } | null;
  linkedToCafeShop: boolean;
};

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
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256);
  }
  return `sale_${[...values].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
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
    event.preventDefault();
    setPending(true); setError("");
    try {
      await api("/api/cafe-pos/auth", { method: "POST", body: JSON.stringify({ intent: "login", pin }) });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo iniciar sesión.");
      setPin("");
    } finally { setPending(false); }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <div className="cafe-brand-mark">C</div>
    <h1>Cohen&apos;s Cafe</h1>
    <p>Ingresa tu PIN personal para abrir la caja.</p>
    <label className="field">PIN<input className="pin-input" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" type="password" autoComplete="current-password" /></label>
    {error ? <div className="status status-error">{error}</div> : null}
    <button className="btn btn-primary btn-wide" disabled={pending || pin.length < 4}>{pending ? "Entrando…" : "Entrar"}</button>
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

function buildReceipt(sale: Sale) {
  const bytes: number[] = [];
  const command = (...values: number[]) => bytes.push(...values);
  const text = (value = "") => bytes.push(...cp850(value), 10);
  command(27, 64, 27, 116, 2, 27, 97, 1, 27, 69, 1);
  text("COHEN'S CAFE");
  command(27, 69, 0);
  text("Ticket de venta");
  text(sale.shopifyOrderName || sale.id.slice(-10));
  text(new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(sale.createdAt)));
  command(27, 97, 0);
  text("--------------------------------");
  for (const item of sale.items) {
    for (const line of wrapReceiptText(`${item.quantity} x ${item.title}${item.variantTitle ? ` (${item.variantTitle})` : ""}`)) text(line);
    text(receiptColumns(`  ${formatMoney(item.unitPriceCents)}`, formatMoney(item.totalCents)));
  }
  text("--------------------------------");
  if (sale.nekudotRedeemedCents) {
    const grossCents = sale.items.reduce((sum, item) => sum + item.totalCents, 0);
    text(receiptColumns("Total artículos", formatMoney(grossCents)));
    text(receiptColumns("Nekudot", `-${formatMoney(sale.nekudotRedeemedCents)}`));
  }
  text(receiptColumns("Subtotal", formatMoney(sale.subtotalCents)));
  text(receiptColumns("IVA incluido", formatMoney(sale.taxCents)));
  command(27, 69, 1, 29, 33, 17);
  text(receiptColumns("TOTAL", formatMoney(sale.totalCents)));
  command(29, 33, 0, 27, 69, 0);
  text(receiptColumns("Pago", sale.paymentMethod === "CASH" ? "Efectivo" : "Terminal"));
  text(`Atendió: ${sale.staff.name}`);
  command(27, 97, 1);
  text(""); text("Gracias por tu compra"); text(""); text(""); text("");
  return new Uint8Array(bytes);
}

export default function CafePos() {
  const initial = useLoaderData<typeof loader>();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [shift, setShift] = useState<Shift | null>(initial.shift as Shift | null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);
  const [drawer, setDrawer] = useState<"orders" | "shift" | "staff" | "reader" | null>(null);
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("");
  const [terminalCounted, setTerminalCounted] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffPin, setStaffPin] = useState("");
  const [nekudotCredential, setNekudotCredential] = useState("");
  const [nekudotMember, setNekudotMember] = useState<NekudotMember | null>(null);
  const [nekudotRedeemAmount, setNekudotRedeemAmount] = useState("0");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const printer = useRef<{ device: UsbDevice; endpoint: number } | null>(null);
  const saleKey = useRef(newSaleKey());

  const loadData = useCallback(async () => {
    const [catalogResult, salesResult, shiftResult] = await Promise.all([
      api<{ products: Product[] }>("/api/cafe-pos/catalog"),
      api<{ sales: Sale[] }>("/api/cafe-pos/orders?limit=40"),
      api<{ shift: Shift | null }>("/api/cafe-pos/shift"),
    ]);
    setProducts(catalogResult.products); setSales(salesResult.sales); setShift(shiftResult.shift); setLastUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    const refresh = () => loadData().catch((error) => setMessage({ tone: "error", text: error.message }));
    const refreshWhenVisible = () => { if (!document.hidden) refresh(); };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/cafe-pos-sw.js").catch(() => undefined);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadData]);

  useEffect(() => {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) return;
    usb.getDevices().then((devices) => {
      const device = devices[0];
      if (device) setPrinterName(device.productName || "POS58D autorizada");
    }).catch(() => undefined);
  }, []);

  const totalCents = useMemo(() => cart.reduce((sum, line) => sum + line.variant.priceCents * line.quantity, 0), [cart]);
  const requestedNekudotCents = useMemo(() => {
    const normalized = nekudotRedeemAmount.trim().replace(",", ".");
    if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return 0;
    return Math.max(0, Math.round(Number(normalized) * 100));
  }, [nekudotRedeemAmount]);
  const appliedNekudotCents = nekudotMember
    ? Math.min(requestedNekudotCents, nekudotMember.availableCents, totalCents)
    : 0;
  const amountDueCents = totalCents - appliedNekudotCents;

  function add(product: Product, variant: Variant) {
    if (variant.tracked && variant.available < 1) return;
    setCart((current) => {
      const index = current.findIndex((line) => line.variant.id === variant.id);
      if (index === -1) return [...current, { product, variant, quantity: 1 }];
      const next = [...current];
      const quantity = next[index].quantity + 1;
      if (variant.tracked && quantity > variant.available) return current;
      next[index] = { ...next[index], quantity };
      return next;
    });
  }

  function quantity(variantId: string, delta: number) {
    setCart((current) => current.flatMap((line) => {
      if (line.variant.id !== variantId) return [line];
      const next = line.quantity + delta;
      if (next <= 0) return [];
      if (line.variant.tracked && next > line.variant.available) return [line];
      return [{ ...line, quantity: next }];
    }));
  }

  async function openPrinter(device: UsbDevice) {
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    const configuration = device.configuration;
    if (!configuration) throw new Error("La impresora no tiene una configuración USB activa.");
    for (const iface of configuration.interfaces) {
      for (const alternate of iface.alternates) {
        const endpoint = alternate.endpoints.find((candidate) => candidate.direction === "out");
        if (!endpoint) continue;
        await device.claimInterface(iface.interfaceNumber);
        if (alternate.alternateSetting) await device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting);
        printer.current = { device, endpoint: endpoint.endpointNumber };
        setPrinterName(device.productName || "POS58D conectada");
        return;
      }
    }
    throw new Error("La impresora no expone un canal USB de salida compatible.");
  }

  async function connectPrinter() {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) {
      setMessage({ tone: "error", text: "Este navegador no ofrece WebUSB. Usa Chrome actualizado en Android." }); return;
    }
    try {
      const device = await usb.requestDevice({ filters: [{ classCode: 7 }, { vendorId: 0x1a86 }, { vendorId: 0x0403 }] });
      await openPrinter(device);
      setMessage({ tone: "success", text: "Impresora conectada. Imprime una venta o usa un ticket reciente para probar." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo conectar la impresora." });
    }
  }

  async function printSale(sale: Sale) {
    try {
      if (!printer.current) {
        const usb = (navigator as UsbNavigator).usb;
        const devices = usb ? await usb.getDevices() : [];
        if (!devices[0]) throw new Error("Toca Conectar impresora antes de imprimir.");
        await openPrinter(devices[0]);
      }
      const data = buildReceipt(sale);
      for (let offset = 0; offset < data.length; offset += 64) {
        await printer.current!.device.transferOut(printer.current!.endpoint, data.slice(offset, offset + 64));
      }
      await api(`/api/cafe-pos/receipt/${sale.id}`, { method: "POST", body: "{}" });
      setMessage({ tone: "success", text: `Ticket ${sale.shopifyOrderName || sale.id.slice(-8)} impreso.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo imprimir." });
    }
  }

  async function retrySale(sale: Sale) {
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ sale: Sale }>("/api/cafe-pos/orders", {
        method: "POST",
        body: JSON.stringify({ retrySaleId: sale.id }),
      });
      setSales((current) => [result.sale, ...current.filter((item) => item.id !== result.sale.id)]);
      setMessage({ tone: "success", text: `Venta ${result.sale.shopifyOrderName || result.sale.id.slice(-8)} sincronizada.` });
      await printSale(result.sale);
      await loadData();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo reintentar la venta." });
    } finally { setBusy(false); }
  }

  async function refundSale(sale: Sale) {
    if (!window.confirm(`¿Registrar el reembolso completo de ${sale.shopifyOrderName || sale.id.slice(-8)}? La venta permanecerá en el historial como reembolsada.`)) return;
    const managerPin = initial.staff?.role === "MANAGER"
      ? undefined
      : window.prompt("Ingresa el PIN maestro del gerente para reembolsar el pedido:");
    if (initial.staff?.role !== "MANAGER" && managerPin === null) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ sale: Sale }>("/api/cafe-pos/orders", {
        method: "POST",
        body: JSON.stringify({ refundSaleId: sale.id, managerPin }),
      });
      setSales((current) => current.map((item) => item.id === result.sale.id ? result.sale : item));
      setMessage({
        tone: "success",
        text: `Pedido ${result.sale.shopifyOrderName || result.sale.id.slice(-8)} reembolsado en Shopify. Devuelve el efectivo o revierte el cobro en la terminal física si corresponde.`,
      });
      await loadData();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo reembolsar el pedido." });
    } finally { setBusy(false); }
  }

  async function openStaff() {
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ staff: StaffMember[] }>("/api/cafe-pos/staff");
      setStaffMembers(result.staff); setDrawer("staff");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo abrir Empleados." });
    } finally { setBusy(false); }
  }

  async function saveStaff(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const result = await api<{ staff: StaffMember[] }>("/api/cafe-pos/staff", {
        method: "POST",
        body: JSON.stringify({ intent: "create", name: staffName, pin: staffPin }),
      });
      setStaffMembers(result.staff); setStaffName(""); setStaffPin("");
      setMessage({ tone: "success", text: "Empleado guardado. Ya puede entrar con su PIN." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo guardar el empleado." });
    } finally { setBusy(false); }
  }

  async function toggleStaff(member: StaffMember) {
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ staff: StaffMember[] }>("/api/cafe-pos/staff", {
        method: "POST",
        body: JSON.stringify({ intent: "toggle", staffId: member.id, active: !member.active }),
      });
      setStaffMembers(result.staff);
      setMessage({ tone: "success", text: `Acceso de ${member.name} actualizado.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo actualizar el acceso." });
    } finally { setBusy(false); }
  }

  async function charge(paymentMethod: "CASH" | "EXTERNAL_CARD") {
    if (!shift || !cart.length) return;
    if (paymentMethod === "EXTERNAL_CARD" && !window.confirm("Confirma que la terminal externa aprobó el cobro antes de registrar la venta.")) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ sale: Sale }>("/api/cafe-pos/orders", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: saleKey.current,
          paymentMethod,
          items: cart.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })),
          ...(nekudotMember
            ? {
                nekudotCredential,
                nekudotRedeemAmount: (appliedNekudotCents / 100).toFixed(2),
              }
            : {}),
        }),
      });
      setCart([]);
      setNekudotCredential("");
      setNekudotMember(null);
      setNekudotRedeemAmount("0");
      saleKey.current = newSaleKey();
      setSales((current) => [result.sale, ...current.filter((sale) => sale.id !== result.sale.id)]);
      setMessage({ tone: "success", text: `Venta ${result.sale.shopifyOrderName || result.sale.id.slice(-8)} registrada.` });
      await printSale(result.sale);
      await loadData();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo registrar la venta." });
    } finally { setBusy(false); }
  }

  async function identifyNekudotCredential(rawCredential: string) {
    const credential = rawCredential.trim();
    if (!credential) return;
    setNekudotCredential(credential);
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ member: NekudotMember }>("/api/cafe-pos/nekudot", {
        method: "POST",
        body: JSON.stringify({ intent: "lookup", credential }),
      });
      setNekudotMember(result.member);
      setNekudotRedeemAmount("0");
      setMessage({
        tone: "success",
        text: `${result.member.displayName} identificado. Esta compra acumulará 5% en Nekudot.`,
      });
    } catch (error) {
      setNekudotMember(null);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo leer la membresía." });
    } finally { setBusy(false); }
  }

  async function identifyNekudot(event?: React.FormEvent) {
    event?.preventDefault();
    await identifyNekudotCredential(nekudotCredential);
  }

  async function openShift() {
    setBusy(true);
    try {
      const result = await api<{ shift: Shift }>("/api/cafe-pos/shift", { method: "POST", body: JSON.stringify({ intent: "open", openingCash }) });
      setShift(result.shift); setDrawer(null); setMessage({ tone: "success", text: "Turno abierto." });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo abrir el turno." }); }
    finally { setBusy(false); }
  }

  async function closeShift() {
    if (!window.confirm("¿Cerrar el turno? Después tendrás que abrir uno nuevo para vender.")) return;
    setBusy(true);
    try {
      const result = await api<{ shift: Shift }>("/api/cafe-pos/shift", { method: "POST", body: JSON.stringify({ intent: "close", closingCash, terminalCounted, notes: closeNotes }) });
      setShift(null); setDrawer(null);
      setMessage({ tone: "success", text: `Turno cerrado. Diferencia de efectivo: ${formatMoney(result.shift.cashVarianceCents ?? 0)}. Diferencia de terminal: ${formatMoney(result.shift.terminalVarianceCents ?? 0)}.` });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cerrar el turno." }); }
    finally { setBusy(false); }
  }

  async function logout() {
    await api("/api/cafe-pos/auth", { method: "POST", body: JSON.stringify({ intent: "logout" }) }).catch(() => undefined);
    window.location.reload();
  }

  if (!initial.staff) return <Login />;

  return <div className="cafe-shell">
    <header className="cafe-topbar">
      <div className="cafe-brand"><div className="cafe-brand-mark">C</div><div><h1>Cohen&apos;s Cafe</h1><small>Bienvenido, {initial.staff.name}{initial.staff.role === "MANAGER" ? " · Gerente" : ""} · {shift ? "Turno abierto" : "Sin turno"}</small></div></div>
      <div className="top-actions">
        <button className="btn btn-dark" onClick={connectPrinter}>🖨️ <span className="label">{printerName || "Conectar impresora"}</span></button>
        <button className="btn btn-dark" onClick={() => setDrawer("reader")}>◉ <span className="label">Lector NFC</span></button>
        <button className="btn btn-dark" onClick={() => setDrawer("orders")}>🧾 <span className="label">Pedidos</span></button>
        <button className="btn btn-dark" onClick={() => setDrawer("shift")}>💵 <span className="label">Turno</span></button>
        {initial.staff.role === "MANAGER" ? <button className="btn btn-dark" disabled={busy} onClick={openStaff}>👥 <span className="label">Empleados</span></button> : null}
        <button className="btn btn-dark" onClick={logout}>Salir</button>
      </div>
    </header>
    <div className="pos-layout">
      <main className="menu-pane">
        <div className="section-title"><h2>Menú</h2><div className="section-title-actions"><span>{products.length} productos{lastUpdatedAt ? ` · ${lastUpdatedAt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : ""}</span><button className="btn btn-secondary" onClick={() => loadData().catch((error) => setMessage({ tone: "error", text: error.message }))}>Actualizar</button></div></div>
        {message ? <div className={`status status-${message.tone}`}>{message.text}</div> : null}
        {!shift ? <div className="status status-warning">Abre un turno de caja antes de registrar ventas.</div> : null}
        <div className="product-grid">{products.map((product) => <article className="product-card" key={product.id}>
          {product.imageUrl ? <img className="product-image" src={product.imageUrl} alt={product.imageAlt} /> : <div className="product-placeholder">☕</div>}
          <div className="product-copy"><strong>{product.title}</strong><div className="variant-list">{product.variants.map((variant) => {
            const soldOut = variant.tracked && variant.available <= 0;
            return <button key={variant.id} className="variant-button" disabled={soldOut} onClick={() => add(product, variant)}>
              {variant.title === "Default Title" ? "Agregar" : variant.title}
              <span className="variant-meta"><span>{formatMoney(variant.priceCents)}</span><span>{variant.tracked ? (soldOut ? "Agotado" : `${variant.available} disp.`) : "Disponible"}</span></span>
            </button>;
          })}</div></div>
        </article>)}</div>
      </main>
      <aside className="cart-pane"><h2>Cuenta</h2>
        {cart.length === 0 ? <div className="cart-empty">Toca un producto para agregarlo.</div> : cart.map((line) => <div className="cart-row" key={line.variant.id}>
          <div className="cart-row-head"><div><strong>{line.product.title}</strong>{line.variant.title !== "Default Title" ? <small><br />{line.variant.title}</small> : null}</div><strong>{formatMoney(line.variant.priceCents * line.quantity)}</strong></div>
          <div className="qty-controls"><button onClick={() => quantity(line.variant.id, -1)}>−</button><strong>{line.quantity}</strong><button onClick={() => quantity(line.variant.id, 1)}>+</button><button className="remove" onClick={() => setCart((current) => current.filter((item) => item.variant.id !== line.variant.id))}>Quitar</button></div>
        </div>)}
        <section className="nekudot-card">
          <div className="nekudot-heading"><strong>¿Tiene tarjeta Cohen&apos;s?</strong><span>5% cashback</span></div>
          {!nekudotMember ? <small className="nekudot-prompt">Pregunta antes de cobrar. Si responde que sí, acerca la tarjeta al lector.</small> : null}
          {!nekudotMember ? <form className="nekudot-scan" onSubmit={identifyNekudot}>
            <input
              value={nekudotCredential}
              onChange={(event) => setNekudotCredential(event.target.value)}
              placeholder="Escanea RFID / QR o escribe el ID"
              autoComplete="off"
            />
            <button className="btn btn-secondary" disabled={busy || nekudotCredential.trim().length < 4}>Identificar</button>
          </form> : <div className="nekudot-member">
            <div><strong>{nekudotMember.displayName}</strong><small>Saldo disponible: {formatMoney(nekudotMember.availableCents)}{nekudotMember.broker ? ` · Broker ${nekudotMember.broker.displayName}` : ""}</small></div>
            <button className="btn btn-secondary" type="button" onClick={() => { setNekudotMember(null); setNekudotCredential(""); setNekudotRedeemAmount("0"); }}>Cambiar</button>
            <label className="field">Usar en esta compra
              <div className="nekudot-amount"><input type="number" min="0" max={(Math.min(totalCents, nekudotMember.availableCents) / 100).toFixed(2)} step="0.01" value={nekudotRedeemAmount} onChange={(event) => setNekudotRedeemAmount(event.target.value)} /><button className="btn btn-secondary" type="button" onClick={() => setNekudotRedeemAmount((Math.min(totalCents, nekudotMember.availableCents) / 100).toFixed(2))}>Máximo</button></div>
            </label>
          </div>}
          {!nekudotMember && drawer !== "reader" ? <NfcBridgeReader compact onCredential={(credential) => { void identifyNekudotCredential(credential); }} /> : null}
        </section>
        <div className="totals">
          {appliedNekudotCents ? <><div className="total-line"><span>Total artículos</span><span>{formatMoney(totalCents)}</span></div><div className="total-line nekudot-discount"><span>Nekudot</span><span>−{formatMoney(appliedNekudotCents)}</span></div></> : null}
          <div className="total-line grand"><span>A pagar</span><span>{formatMoney(amountDueCents)}</span></div><small>IVA incluido</small>
        </div>
        <div className="payment-grid"><button className="btn btn-success" disabled={busy || !shift || !cart.length} onClick={() => charge("CASH")}>Cobrar {formatMoney(amountDueCents)} efectivo</button><button className="btn btn-primary" disabled={busy || !shift || !cart.length} onClick={() => charge("EXTERNAL_CARD")}>Registrar {formatMoney(amountDueCents)} terminal</button></div>
      </aside>
    </div>
    {drawer ? <><button type="button" className="drawer-backdrop" aria-label="Cerrar panel" onClick={() => setDrawer(null)} /><aside className="drawer">
      <button className="btn btn-secondary" onClick={() => setDrawer(null)}>Cerrar</button>
      {drawer === "orders" ? <><h2>Pedidos recientes</h2>{sales.map((sale) => <div className="sale-card" key={sale.id}>
        <div className="sale-card-head"><div><strong>{sale.shopifyOrderName || sale.id.slice(-8)}</strong><br /><small>{new Date(sale.createdAt).toLocaleString("es-MX")} · {sale.staff.name}</small></div><strong>{formatMoney(sale.totalCents)}</strong></div>
        <span className={`badge ${sale.status !== "SYNCED" && sale.status !== "REFUNDED" && sale.status !== "CANCELLED" ? "pending" : ""}`}>{sale.status === "SYNCED" ? "Sincronizado" : sale.status === "REFUNDED" ? "Reembolsado" : sale.status === "CANCELLED" ? "Cancelado" : "Pendiente"}</span>
        {sale.status === "REFUNDED" && sale.refundedByName ? <div className="status status-info">Reembolsado por {sale.refundedByName}. Se conserva en el historial.</div> : null}
        {sale.status === "CANCELLED" && sale.cancelledByName ? <div className="status status-info">Cancelado por {sale.cancelledByName}.</div> : null}
        {sale.errorMessage ? <div className="status status-warning">{sale.errorMessage}</div> : null}
        <div className="sale-card-actions">
          <button className="btn btn-secondary" onClick={() => printSale(sale)}>Reimprimir</button>
          {sale.status === "SYNCED" ? <button className="btn btn-danger" disabled={busy} onClick={() => refundSale(sale)}>Reembolsar pedido</button> : null}
          {sale.status !== "SYNCED" && sale.status !== "REFUNDED" && sale.status !== "CANCELLED" ? <button className="btn btn-primary" disabled={busy} onClick={() => retrySale(sale)}>Reintentar sincronización</button> : null}
        </div>
      </div>)}</> : null}
      {drawer === "shift" ? <><h2>Turno de caja</h2>{!shift ? <><p>No hay turno abierto.</p><label className="field">Fondo inicial<input type="number" min="0" step="0.01" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label><button className="btn btn-success btn-wide" disabled={busy} onClick={openShift}>Abrir turno</button></> : <><div className="status status-info">Abierto por {shift.staff.name} el {new Date(shift.openedAt).toLocaleString("es-MX")}. Fondo: {formatMoney(shift.openingCashCents)}</div><label className="field">Efectivo contado<input type="number" min="0" step="0.01" value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><label className="field">Total de terminal<input type="number" min="0" step="0.01" value={terminalCounted} onChange={(event) => setTerminalCounted(event.target.value)} /></label><label className="field">Notas<textarea value={closeNotes} onChange={(event) => setCloseNotes(event.target.value)} /></label><button className="btn btn-danger btn-wide" disabled={busy || closingCash === "" || terminalCounted === ""} onClick={closeShift}>Cerrar y conciliar turno</button></>}</> : null}
      {drawer === "reader" ? <><h2>Prueba del lector NFC</h2><NfcReaderDiagnostics lookupEndpoint="/api/cafe-pos/nekudot" locationLabel="Cafetería" /></> : null}
      {drawer === "staff" ? <><h2>Empleados</h2>
        <div className="status status-info">Solo el gerente puede crear, cambiar PINes o desactivar usuarios.</div>
        <p>Para cambiar un PIN, escribe exactamente el mismo primer nombre y asigna el PIN nuevo.</p>
        <form onSubmit={saveStaff}>
          <label className="field">Nombre<input value={staffName} onChange={(event) => setStaffName(event.target.value)} required minLength={2} maxLength={80} /></label>
          <label className="field">PIN de 4 a 8 dígitos<input value={staffPin} onChange={(event) => setStaffPin(event.target.value.replace(/\D/g, "").slice(0, 8))} required pattern="[0-9]{4,8}" inputMode="numeric" type="password" autoComplete="new-password" /></label>
          <button className="btn btn-success btn-wide" disabled={busy || staffName.trim().length < 2 || staffPin.length < 4}>Guardar usuario o actualizar PIN</button>
        </form>
        <h3>Usuarios autorizados</h3>
        {staffMembers.map((member) => <div className="staff-row" key={member.id}>
          <div><strong>{member.name}</strong><br /><small>{member.role === "MANAGER" ? "Gerente" : "Empleado"} · {member.active ? "Activo" : "Desactivado"}</small></div>
          {member.role !== "MANAGER" ? <button className={`btn ${member.active ? "btn-danger" : "btn-success"}`} disabled={busy} onClick={() => toggleStaff(member)}>{member.active ? "Desactivar" : "Activar"}</button> : null}
        </div>)}
      </> : null}
    </aside></> : null}
  </div>;
}
