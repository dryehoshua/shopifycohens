import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export default async () => {
  render(<InventoryEntry />, document.body);
};

function makeOperationKey(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

const NEW_SUPPLIER_VALUE = "__new_supplier__";
const OPERATION_TIMEZONE = "America/Mexico_City";

function formatDateTime(value) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: OPERATION_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: true,
  }).format(new Date(value));
}

async function backendFetch(path, options = {}) {
  const token = await shopify.session.getSessionToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(path, { ...options, headers });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {
      ok: false,
      error: "El servidor devolvió una respuesta que no se pudo leer.",
    };
  }

  if (!response.ok || payload.ok === false) {
    const error = new Error(
      payload.error || "No se pudo completar la operación.",
    );
    error.code = payload.code;
    error.details = payload.details;
    throw error;
  }
  return payload;
}

function sourceLabel(source) {
  if (source === "embedded") return "pistola integrada";
  if (source === "external") return "pistola externa";
  if (source === "camera") return "cámara";
  return "escáner";
}

function InventoryEntry() {
  const session = shopify.session.currentSession;
  const [phase, setPhase] = useState("scanning");
  const [barcode, setBarcode] = useState("");
  const [variant, setVariant] = useState(null);
  const [quantity, setQuantity] = useState("1");
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [note, setNote] = useState("");
  const [reversalNote, setReversalNote] = useState("");
  const [message, setMessage] = useState("");
  const [lastMovement, setLastMovement] = useState(null);
  const [movements, setMovements] = useState([]);
  const [sources, setSources] = useState(
    shopify.scanner.sources.current.value || [],
  );
  const lookupSequence = useRef(0);
  const lookupRef = useRef(null);
  const lastHardwareScan = useRef({ data: "", at: 0 });
  const receiptOperationKey = useRef(makeOperationKey("receipt"));
  const reversalOperationKey = useRef(makeOperationKey("reversal"));

  async function loadMovements() {
    try {
      const payload = await backendFetch(
        `/api/pos/inventory/movements?locationId=${encodeURIComponent(
          session.locationId,
        )}&limit=5`,
      );
      setMovements(payload.movements || []);
    } catch {
      // La bitácora es complementaria y no debe bloquear una recepción.
    }
  }

  async function lookupBarcode(rawBarcode, origin = "manual") {
    const normalized = String(rawBarcode || "").trim();
    if (!normalized) {
      setMessage("Escanea o escribe un código de barras.");
      return;
    }

    const now = Date.now();
    if (
      origin !== "manual" &&
      lastHardwareScan.current.data === normalized &&
      now - lastHardwareScan.current.at < 1800
    ) {
      return;
    }
    if (origin !== "manual") {
      lastHardwareScan.current = { data: normalized, at: now };
    }

    const sequence = ++lookupSequence.current;
    receiptOperationKey.current = makeOperationKey("receipt");
    setBarcode(normalized);
    setVariant(null);
    setLastMovement(null);
    receiptOperationKey.current = makeOperationKey("receipt");
    reversalOperationKey.current = makeOperationKey("reversal");
    setMessage("");
    setPhase("looking-up");

    try {
      const payload = await backendFetch(
        `/api/pos/inventory/lookup?barcode=${encodeURIComponent(
          normalized,
        )}&locationId=${encodeURIComponent(session.locationId)}`,
      );
      if (sequence !== lookupSequence.current) return;
      setVariant(payload.variant);
      setSuppliers(payload.suppliers || []);
      const productSupplier = (payload.suppliers || []).find(
        (option) => option.name === payload.variant.vendor,
      );
      setSupplierId(productSupplier?.id || "");
      setNewSupplier("");
      setQuantity("1");
      setPhase("ready");
    } catch (error) {
      if (sequence !== lookupSequence.current) return;
      setMessage(error.message);
      setPhase("error");
    }
  }

  lookupRef.current = lookupBarcode;

  useEffect(() => {
    loadMovements();

    const unsubscribeScans = shopify.scanner.scannerData.current.subscribe(
      (scan) => {
        if (scan?.data) lookupRef.current?.(scan.data, scan.source);
      },
    );
    const unsubscribeSources = shopify.scanner.sources.current.subscribe(
      (availableSources) => setSources(availableSources || []),
    );

    return () => {
      unsubscribeScans();
      unsubscribeSources();
      shopify.scanner.hideCameraScanner();
    };
  }, []);

  function resetForNextScan() {
    lookupSequence.current += 1;
    setPhase("scanning");
    setBarcode("");
    setVariant(null);
    setQuantity("1");
    setSupplierId("");
    setNewSupplier("");
    setNote("");
    setReversalNote("");
    setMessage("");
    setLastMovement(null);
  }

  async function submitReceipt() {
    const parsedQuantity = Number(quantity);
    if (
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > 100000
    ) {
      setMessage("La cantidad debe ser un número entero mayor que cero.");
      return;
    }
    if (!variant) return;
    if (!supplierId) {
      setMessage("Selecciona o registra un proveedor.");
      return;
    }
    if (supplierId === NEW_SUPPLIER_VALUE && !newSupplier.trim()) {
      setMessage("Escribe el nombre del nuevo proveedor.");
      return;
    }

    setMessage("");
    setPhase("submitting");
    const idempotencyKey = receiptOperationKey.current;

    try {
      const payload = await backendFetch("/api/pos/inventory/receive", {
        method: "POST",
        body: JSON.stringify({
          barcode: variant.barcode,
          quantity: parsedQuantity,
          idempotencyKey,
          locationId: session.locationId,
          staffMemberId:
            shopify.session.staffMember.value?.id ?? session.staffMemberId,
          deviceId: shopify.session.deviceId,
          supplierId: supplierId === NEW_SUPPLIER_VALUE ? "" : supplierId,
          newSupplier: supplierId === NEW_SUPPLIER_VALUE ? newSupplier : "",
          note,
        }),
      });
      setLastMovement(payload.movement);
      setPhase("success");
      loadMovements();
    } catch (error) {
      setMessage(error.message);
      setPhase("ready");
    }
  }

  async function submitReversal() {
    if (!lastMovement) return;
    if (!reversalNote.trim()) {
      setMessage("Escribe por qué estás corrigiendo la entrada.");
      return;
    }

    setMessage("");
    setPhase("reversing");
    try {
      const payload = await backendFetch(
        `/api/pos/inventory/reverse/${encodeURIComponent(lastMovement.id)}`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: reversalOperationKey.current,
            staffMemberId:
              shopify.session.staffMember.value?.id ?? session.staffMemberId,
            deviceId: shopify.session.deviceId,
            note: reversalNote,
          }),
        },
      );
      setLastMovement(payload.movement);
      setPhase("reversed");
      loadMovements();
    } catch (error) {
      setMessage(error.message);
      setPhase("reversal-confirm");
    }
  }

  const scannerDescription =
    sources.length > 0
      ? `Listo para ${sources.map(sourceLabel).join(", ")}.`
      : "No se detectó hardware; puedes escribir el código manualmente.";
  const parsedQuantity = Number(quantity);
  const projectedAvailable =
    variant && Number.isInteger(parsedQuantity)
      ? variant.available + parsedQuantity
      : variant?.available;

  return (
    <s-page heading="Registrar entrada de mercancía">
      <s-scroll-box>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-banner
              tone={sources.length > 0 ? "info" : "warning"}
              heading="Modo recepción activo"
            >
              {scannerDescription} Escanea una pieza una sola vez y después
              captura la cantidad recibida.
            </s-banner>

            {message ? (
              <s-banner tone="critical" heading="No se pudo continuar">
                {message}
              </s-banner>
            ) : null}

            {phase === "scanning" || phase === "error" ? (
              <s-section heading="1. Escanear producto">
                <s-stack direction="block" gap="base">
                  <s-text-field
                    label="Código de barras"
                    value={barcode}
                    placeholder="Escanea o escribe el código"
                    onInput={(event) => setBarcode(event.currentTarget.value)}
                  />
                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="primary"
                      onClick={() => lookupBarcode(barcode)}
                    >
                      Buscar producto
                    </s-button>
                    {sources.includes("camera") ? (
                      <s-button
                        variant="secondary"
                        onClick={() => shopify.scanner.showCameraScanner()}
                      >
                        Usar cámara
                      </s-button>
                    ) : null}
                  </s-stack>
                </s-stack>
              </s-section>
            ) : null}

            {phase === "looking-up" ? (
              <s-banner tone="info" heading={`Buscando ${barcode}`}>
                Consultando producto y existencia de la sucursal activa…
              </s-banner>
            ) : null}

            {variant && ["ready", "submitting"].includes(phase) ? (
              <s-section heading="2. Confirmar entrada">
                <s-stack direction="block" gap="base">
                  <s-box
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="block" gap="small">
                      <s-heading>{variant.productTitle}</s-heading>
                      {variant.variantTitle &&
                      variant.variantTitle !== "Default Title" ? (
                        <s-text>{variant.variantTitle}</s-text>
                      ) : null}
                      <s-text>
                        Código: {variant.barcode}
                        {variant.sku ? ` · SKU: ${variant.sku}` : ""}
                      </s-text>
                      <s-text>Existencia actual: {variant.available}</s-text>
                    </s-stack>
                  </s-box>

                  <s-number-field
                    label="Cantidad recibida"
                    value={quantity}
                    min={1}
                    max={100000}
                    step={1}
                    controls="stepper"
                    onInput={(event) => setQuantity(event.currentTarget.value)}
                  />
                  <s-select
                    label="Proveedor"
                    value={supplierId}
                    required
                    onChange={(event) => {
                      setSupplierId(event.currentTarget.value);
                      if (event.currentTarget.value !== NEW_SUPPLIER_VALUE) {
                        setNewSupplier("");
                      }
                    }}
                  >
                    <s-option value="">Selecciona un proveedor</s-option>
                    {suppliers.map((option) => (
                      <s-option key={option.id} value={option.id}>
                        {option.name}
                      </s-option>
                    ))}
                    <s-option value={NEW_SUPPLIER_VALUE}>
                      + Registrar nuevo proveedor
                    </s-option>
                  </s-select>
                  {supplierId === NEW_SUPPLIER_VALUE ? (
                    <s-text-field
                      label="Nombre del nuevo proveedor"
                      value={newSupplier}
                      maxLength={160}
                      required
                      onInput={(event) =>
                        setNewSupplier(event.currentTarget.value)
                      }
                    />
                  ) : null}
                  <s-text-area
                    label="Nota o referencia (opcional)"
                    value={note}
                    rows={2}
                    maxLength={500}
                    onInput={(event) => setNote(event.currentTarget.value)}
                  />

                  <s-banner tone="info" heading="Resultado esperado">
                    {variant.available} actuales + {quantity || "0"} recibidas ={" "}
                    {projectedAvailable} disponibles.
                  </s-banner>

                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="primary"
                      loading={phase === "submitting"}
                      disabled={
                        !supplierId ||
                        (supplierId === NEW_SUPPLIER_VALUE &&
                          !newSupplier.trim())
                      }
                      onClick={submitReceipt}
                    >
                      Confirmar entrada
                    </s-button>
                    <s-button
                      variant="secondary"
                      disabled={phase === "submitting"}
                      onClick={resetForNextScan}
                    >
                      Cancelar
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-section>
            ) : null}

            {phase === "success" && lastMovement ? (
              <s-section heading="Entrada registrada">
                <s-stack direction="block" gap="base">
                  <s-banner tone="success" heading="Inventario actualizado">
                    {lastMovement.productTitle}: {lastMovement.beforeAvailable}{" "}
                    + {lastMovement.quantityDelta} ={" "}
                    {lastMovement.afterAvailable}.
                  </s-banner>
                  <s-text>
                    Folio de auditoría: {lastMovement.id}. El registro ya quedó
                    guardado con usuario, sucursal y dispositivo.
                  </s-text>
                  <s-text>
                    Fecha y hora: {formatDateTime(lastMovement.occurredAt)} ·
                    Proveedor: {lastMovement.supplier}.
                  </s-text>
                  <s-stack direction="inline" gap="base">
                    <s-button variant="primary" onClick={resetForNextScan}>
                      Registrar otro
                    </s-button>
                    <s-button
                      variant="secondary"
                      tone="critical"
                      onClick={() => {
                        setMessage("");
                        reversalOperationKey.current = makeOperationKey("reversal");
                        setPhase("reversal-confirm");
                      }}
                    >
                      Corregir esta entrada
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-section>
            ) : null}

            {["reversal-confirm", "reversing"].includes(phase) &&
            lastMovement ? (
              <s-section heading="Corregir entrada">
                <s-stack direction="block" gap="base">
                  <s-banner tone="warning" heading="El original no se borrará">
                    Se registrará un movimiento inverso por{" "}
                    {Math.abs(lastMovement.quantityDelta)} unidades y ambos
                    folios quedarán enlazados.
                  </s-banner>
                  <s-text-area
                    label="Motivo de la corrección"
                    value={reversalNote}
                    rows={2}
                    maxLength={500}
                    required
                    onInput={(event) =>
                      setReversalNote(event.currentTarget.value)
                    }
                  />
                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="primary"
                      tone="critical"
                      loading={phase === "reversing"}
                      onClick={submitReversal}
                    >
                      Confirmar corrección
                    </s-button>
                    <s-button
                      variant="secondary"
                      disabled={phase === "reversing"}
                      onClick={() => {
                        setMessage("");
                        setPhase("success");
                      }}
                    >
                      Volver
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-section>
            ) : null}

            {phase === "reversed" && lastMovement ? (
              <s-section heading="Corrección registrada">
                <s-stack direction="block" gap="base">
                  <s-banner
                    tone="success"
                    heading="Movimiento inverso aplicado"
                  >
                    Existencia: {lastMovement.beforeAvailable}{" "}
                    {lastMovement.quantityDelta} = {lastMovement.afterAvailable}
                    .
                  </s-banner>
                  <s-text>
                    Folio de corrección: {lastMovement.id}. La entrada original
                    permanece en la bitácora.
                  </s-text>
                  <s-text>
                    Fecha y hora de corrección:{" "}
                    {formatDateTime(lastMovement.occurredAt)}.
                  </s-text>
                  <s-button variant="primary" onClick={resetForNextScan}>
                    Registrar otra entrada
                  </s-button>
                </s-stack>
              </s-section>
            ) : null}

            {movements.length > 0 ? (
              <s-section heading="Últimos movimientos">
                <s-stack direction="block" gap="small">
                  {movements.map((movement) => (
                    <s-box
                      key={movement.id}
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                    >
                      <s-stack direction="block" gap="small">
                        <s-text>
                          {movement.type === "REVERSAL"
                            ? "Corrección"
                            : "Entrada"}{" "}
                          · {movement.productTitle}
                        </s-text>
                        <s-text>
                          {movement.quantityDelta > 0 ? "+" : ""}
                          {movement.quantityDelta} unidades ·{" "}
                          {formatDateTime(movement.occurredAt)}
                          {movement.supplier ? ` · ${movement.supplier}` : ""}
                        </s-text>
                      </s-stack>
                    </s-box>
                  ))}
                </s-stack>
              </s-section>
            ) : null}
          </s-stack>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
}
