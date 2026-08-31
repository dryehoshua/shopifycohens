import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import {
  receiveInventory,
  reverseInventory,
} from "../inventory-operations.server";
import {
  domainErrorResponse,
  InventoryDomainError,
  lookupVariantByBarcode,
  type InventoryLookup,
} from "../inventory.server";
import { authenticate } from "../shopify.server";
import { listSuppliers, type SupplierOption } from "../supplier.server";

type Location = {
  id: string;
  name: string;
  isActive: boolean;
};

type LocationResponse = {
  data?: {
    locations?: {
      nodes?: Location[];
    };
  };
  errors?: Array<{ message?: string }>;
};

type MovementView = {
  id: string;
  occurredAt: string;
  type: string;
  status: string;
  productTitle: string;
  variantTitle: string | null;
  barcode: string;
  sku: string | null;
  quantityDelta: number;
  beforeAvailable: number | null;
  afterAvailable: number | null;
  supplier: string | null;
  supplierRecordId: string | null;
  note: string | null;
  locationId: string;
  canReverse: boolean;
};

type MovementResult = {
  id: string;
  type: string;
  status: string;
  occurredAt: string;
  barcode: string;
  sku: string | null;
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string | null;
  inventoryItemId: string;
  locationId: string;
  quantityDelta: number;
  beforeAvailable: number | null;
  afterAvailable: number | null;
  supplier: string | null;
  supplierRecordId: string | null;
  note: string | null;
  referenceDocumentUri: string;
  reversalOfId: string | null;
  idempotent: boolean;
};

type ActionData =
  | { ok: true; intent: "lookup"; variant: InventoryLookup }
  | { ok: true; intent: "receive"; movement: MovementResult }
  | { ok: true; intent: "reverse"; movement: MovementResult }
  | {
      ok: false;
      intent?: string;
      error: string;
      code?: string;
      details?: unknown;
    };

function actionError(error: unknown, intent: string) {
  const response = domainErrorResponse(error);
  return response.json().then((payload) =>
    Response.json(
      { ...payload, intent },
      {
        status: response.status,
        headers: response.headers,
      },
    ),
  );
}

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function makeOperationKey(prefix: "desktop-receipt" | "desktop-reversal") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

const NEW_SUPPLIER_VALUE = "__new_supplier__";
const OPERATION_TIMEZONE = "America/Mexico_City";

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: true,
  }).format(new Date(value));
}

function adminActor(session: { id: string; userId?: unknown }) {
  return {
    userId: session.userId ?? session.id,
    staffMemberId: null,
    deviceId: "desktop-admin",
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [locationResponse, movements, suppliers] = await Promise.all([
    admin.graphql(
      `#graphql
        query CohenDesktopInventoryLocations {
          locations(first: 50, includeInactive: false) {
            nodes {
              id
              name
              isActive
            }
          }
        }
      `,
    ),
    db.inventoryMovement.findMany({
      where: { shop: session.shop, status: "COMMITTED" },
      orderBy: { occurredAt: "desc" },
      take: 20,
      include: {
        reversal: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    }),
    listSuppliers(admin, session.shop),
  ]);

  const locationPayload = (await locationResponse.json()) as LocationResponse;
  const apiErrors =
    locationPayload.errors?.map((error) => error.message).filter(Boolean) ?? [];
  if (apiErrors.length) {
    throw new InventoryDomainError(
      "Shopify no pudo consultar las ubicaciones disponibles.",
      {
        status: 502,
        code: "SHOPIFY_LOCATIONS_FAILED",
        details: apiErrors,
      },
    );
  }

  const locations = (locationPayload.data?.locations?.nodes ?? []).filter(
    (location) => location.isActive,
  );
  const defaultLocation =
    locations.find((location) =>
      /shop location|ubicación de la tienda|tienda|principal|main/i.test(
        location.name,
      ),
    ) ?? locations[0];

  return {
    shop: session.shop,
    shopTimezone: OPERATION_TIMEZONE,
    locations,
    defaultLocationId: defaultLocation?.id ?? "",
    suppliers,
    movements: movements.map((movement): MovementView => ({
      id: movement.id,
      occurredAt: movement.occurredAt.toISOString(),
      type: movement.type,
      status: movement.status,
      productTitle: movement.productTitle,
      variantTitle: movement.variantTitle,
      barcode: movement.barcode,
      sku: movement.sku,
      quantityDelta: movement.quantityDelta,
      beforeAvailable: movement.beforeAvailable,
      afterAvailable: movement.afterAvailable,
      supplier: movement.supplier,
      supplierRecordId: movement.supplierRecordId,
      note: movement.note,
      locationId: movement.locationId,
      canReverse:
        movement.type === "RECEIPT" &&
        movement.reversal?.status !== "COMMITTED",
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formValue(formData, "intent");

  try {
    if (request.method !== "POST") {
      throw new InventoryDomainError("Método no permitido.", {
        status: 405,
        code: "METHOD_NOT_ALLOWED",
      });
    }

    if (intent === "lookup") {
      const variant = await lookupVariantByBarcode(
        admin,
        formValue(formData, "barcode"),
        formValue(formData, "locationId"),
      );
      return Response.json({
        ok: true,
        intent,
        variant,
      } satisfies ActionData);
    }

    if (intent === "receive") {
      const result = await receiveInventory(
        admin,
        session.shop,
        {
          barcode: formValue(formData, "barcode"),
          quantity: formValue(formData, "quantity"),
          idempotencyKey: formValue(formData, "idempotencyKey"),
          locationId: formValue(formData, "locationId"),
          supplierId: formValue(formData, "supplierId"),
          newSupplier: formValue(formData, "newSupplier"),
          note: formValue(formData, "note"),
        },
        adminActor(session),
      );
      return Response.json(
        {
          ok: true,
          intent,
          movement: result.movement,
        } satisfies ActionData,
        { status: result.created ? 201 : 200 },
      );
    }

    if (intent === "reverse") {
      const result = await reverseInventory(
        admin,
        session.shop,
        formValue(formData, "movementId"),
        {
          idempotencyKey: formValue(formData, "idempotencyKey"),
          note: formValue(formData, "note"),
        },
        adminActor(session),
      );
      return Response.json(
        {
          ok: true,
          intent,
          movement: result.movement,
        } satisfies ActionData,
        { status: result.created ? 201 : 200 },
      );
    }

    throw new InventoryDomainError("La acción solicitada no es válida.", {
      status: 400,
      code: "INTENT_INVALID",
    });
  } catch (error) {
    return actionError(error, intent);
  }
};

type Phase = "scan" | "review" | "success" | "reverse" | "reversed";

export default function DesktopInventoryEntry() {
  const {
    shop,
    shopTimezone,
    locations,
    defaultLocationId,
    suppliers,
    movements,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const actionData = fetcher.data as ActionData | undefined;
  const barcodeRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const receiptOperationKeyRef = useRef(makeOperationKey("desktop-receipt"));
  const reversalOperationKeyRef = useRef(makeOperationKey("desktop-reversal"));
  const [phase, setPhase] = useState<Phase>("scan");
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [supplierOptions, setSupplierOptions] =
    useState<SupplierOption[]>(suppliers);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [note, setNote] = useState("");
  const [reversalNote, setReversalNote] = useState("");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [variant, setVariant] = useState<InventoryLookup | null>(null);
  const [lastMovement, setLastMovement] = useState<MovementResult | null>(null);
  const [movementToReverse, setMovementToReverse] = useState<
    MovementView | MovementResult | null
  >(null);
  const [message, setMessage] = useState("");

  const busy = fetcher.state !== "idle";
  const busyIntent = formValue(fetcher.formData ?? new FormData(), "intent");
  const locationName = useMemo(
    () =>
      locations.find((location) => location.id === locationId)?.name ??
      "Ubicación",
    [locationId, locations],
  );
  const projectedAvailable =
    variant && Number.isInteger(Number(quantity))
      ? variant.available + Number(quantity)
      : variant?.available;

  useEffect(() => {
    if (!actionData) return;
    if (!actionData.ok) {
      setMessage(actionData.error);
      return;
    }

    setMessage("");
    if (actionData.intent === "lookup") {
      setVariant(actionData.variant);
      setQuantity("1");
      const productSupplier = supplierOptions.find(
        (option) => option.name === actionData.variant.vendor,
      );
      setSupplierId(productSupplier?.id ?? "");
      setNewSupplier("");
      setPhase("review");
      setTimeout(() => quantityRef.current?.focus(), 0);
    } else if (actionData.intent === "receive") {
      setLastMovement(actionData.movement);
      setMovementToReverse(actionData.movement);
      if (
        actionData.movement.supplier &&
        actionData.movement.supplierRecordId
      ) {
        const receivedSupplierId = actionData.movement.supplierRecordId;
        const receivedSupplierName = actionData.movement.supplier;
        setSupplierOptions((current) => {
          if (current.some((option) => option.id === receivedSupplierId)) {
            return current;
          }
          return [
            ...current,
            {
              id: receivedSupplierId,
              name: receivedSupplierName,
              source: "MANUAL",
            },
          ].sort((a, b) => a.name.localeCompare(b.name, "es-MX"));
        });
      }
      setPhase("success");
    } else if (actionData.intent === "reverse") {
      setLastMovement(actionData.movement);
      setMovementToReverse(null);
      setPhase("reversed");
    }
  }, [actionData, supplierOptions]);

  useEffect(() => {
    if (phase === "scan") {
      setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  }, [phase]);

  function lookup() {
    if (!barcode.trim() || !locationId || busy) return;
    receiptOperationKeyRef.current = makeOperationKey("desktop-receipt");
    setMessage("");
    setVariant(null);
    fetcher.submit(
      { intent: "lookup", barcode: barcode.trim(), locationId },
      { method: "post" },
    );
  }

  function receive() {
    if (!variant || busy) return;
    setMessage("");
    fetcher.submit(
      {
        intent: "receive",
        barcode: variant.barcode,
        quantity,
        supplierId: supplierId === NEW_SUPPLIER_VALUE ? "" : supplierId,
        newSupplier: supplierId === NEW_SUPPLIER_VALUE ? newSupplier : "",
        note,
        locationId,
        idempotencyKey: receiptOperationKeyRef.current,
      },
      { method: "post" },
    );
  }

  function reverse() {
    if (!movementToReverse || !reversalNote.trim() || busy) return;
    setMessage("");
    fetcher.submit(
      {
        intent: "reverse",
        movementId: movementToReverse.id,
        note: reversalNote,
        idempotencyKey: reversalOperationKeyRef.current,
      },
      { method: "post" },
    );
  }

  function resetForNext() {
    setBarcode("");
    setQuantity("1");
    setSupplierId("");
    setNewSupplier("");
    setNote("");
    setReversalNote("");
    setVariant(null);
    setLastMovement(null);
    setMovementToReverse(null);
    setMessage("");
    receiptOperationKeyRef.current = makeOperationKey("desktop-receipt");
    reversalOperationKeyRef.current = makeOperationKey("desktop-reversal");
    setPhase("scan");
  }

  function chooseReversal(movement: MovementView | MovementResult) {
    reversalOperationKeyRef.current = makeOperationKey("desktop-reversal");
    setMovementToReverse(movement);
    setReversalNote("");
    setMessage("");
    setPhase("reverse");
  }

  return (
    <s-page heading="Cohens Operations · Registrar entrada">
      <s-section heading="Recepción por pistola USB o Bluetooth">
        <s-stack direction="block" gap="base">
          <s-banner tone="info" heading="Modo de recepción activo">
            Configura la pistola como teclado/HID y con terminador Enter.
            Escanea una sola pieza, captura la cantidad total recibida y
            confirma.
          </s-banner>
          <s-paragraph>
            Tienda: <strong>{shop}</strong>. Ubicación seleccionada:{" "}
            <strong>{locationName}</strong>. Hora operativa:{" "}
            <strong>{shopTimezone}</strong>.
          </s-paragraph>
        </s-stack>
      </s-section>

      {message ? (
        <s-section>
          <s-banner tone="critical" heading="No se pudo continuar">
            {message}
          </s-banner>
        </s-section>
      ) : null}

      {(phase === "scan" || (busy && busyIntent === "lookup")) && (
        <s-section heading="1. Escanear producto">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              lookup();
            }}
            style={formGridStyle}
          >
            <label style={fieldLabelStyle}>
              Ubicación
              <select
                value={locationId}
                onChange={(event) => {
                  setLocationId(event.currentTarget.value);
                  setVariant(null);
                  setMessage("");
                }}
                style={inputStyle}
                disabled={busy}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...fieldLabelStyle, gridColumn: "1 / -1" }}>
              Código de barras
              <input
                ref={barcodeRef}
                value={barcode}
                onChange={(event) => setBarcode(event.currentTarget.value)}
                placeholder="Escanea o escribe el código y presiona Enter"
                autoComplete="off"
                inputMode="numeric"
                style={{
                  ...inputStyle,
                  fontSize: "20px",
                  letterSpacing: "1px",
                }}
                disabled={busy}
              />
            </label>
            <div>
              <button
                type="submit"
                style={primaryButtonStyle}
                disabled={busy || !barcode.trim() || !locationId}
              >
                {busy && busyIntent === "lookup"
                  ? "Buscando…"
                  : "Buscar producto"}
              </button>
            </div>
          </form>
        </s-section>
      )}

      {phase === "review" && variant ? (
        <s-section heading="2. Confirmar entrada">
          <div style={productCardStyle}>
            {variant.imageUrl ? (
              <img
                src={variant.imageUrl}
                alt={variant.imageAlt ?? variant.productTitle}
                style={productImageStyle}
              />
            ) : (
              <div style={imagePlaceholderStyle}>Sin imagen</div>
            )}
            <div>
              <div style={{ fontSize: "20px", fontWeight: 700 }}>
                {variant.productTitle}
              </div>
              {variant.variantTitle &&
              variant.variantTitle !== "Default Title" ? (
                <div style={mutedStyle}>{variant.variantTitle}</div>
              ) : null}
              <div style={{ marginTop: "8px" }}>
                Código: <strong>{variant.barcode}</strong>
                {variant.sku ? ` · SKU: ${variant.sku}` : ""}
              </div>
              <div style={{ marginTop: "6px" }}>
                Precio: ${Number(variant.price).toLocaleString("es-MX")} MXN
                {variant.cost
                  ? ` · Costo: $${Number(variant.cost).toLocaleString("es-MX")} ${variant.currencyCode ?? "MXN"}`
                  : ""}
              </div>
              <div style={{ marginTop: "6px", fontSize: "17px" }}>
                Existencia actual en {locationName}:{" "}
                <strong>{variant.available}</strong>
              </div>
            </div>
          </div>

          <div style={{ ...formGridStyle, marginTop: "18px" }}>
            <label style={fieldLabelStyle}>
              Cantidad recibida
              <input
                ref={quantityRef}
                type="number"
                min={1}
                max={100000}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(event.currentTarget.value)}
                style={inputStyle}
                disabled={busy}
              />
            </label>
            <label style={fieldLabelStyle}>
              Proveedor
              <select
                value={supplierId}
                onChange={(event) => {
                  setSupplierId(event.currentTarget.value);
                  if (event.currentTarget.value !== NEW_SUPPLIER_VALUE) {
                    setNewSupplier("");
                  }
                }}
                style={inputStyle}
                disabled={busy}
                required
              >
                <option value="">Selecciona un proveedor</option>
                {supplierOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
                <option value={NEW_SUPPLIER_VALUE}>
                  + Registrar nuevo proveedor
                </option>
              </select>
            </label>
            {supplierId === NEW_SUPPLIER_VALUE ? (
              <label style={fieldLabelStyle}>
                Nombre del nuevo proveedor
                <input
                  value={newSupplier}
                  onChange={(event) =>
                    setNewSupplier(event.currentTarget.value)
                  }
                  maxLength={160}
                  autoFocus
                  style={inputStyle}
                  disabled={busy}
                  required
                />
              </label>
            ) : null}
            <label style={{ ...fieldLabelStyle, gridColumn: "1 / -1" }}>
              Nota, factura o referencia (opcional)
              <textarea
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
                maxLength={500}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
                disabled={busy}
              />
            </label>
          </div>

          <div style={projectionStyle}>
            <strong>Resultado esperado:</strong> {variant.available} actuales +{" "}
            {quantity || "0"} recibidas = {projectedAvailable} disponibles.
          </div>

          <div style={buttonRowStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={receive}
              disabled={
                busy ||
                !Number.isInteger(Number(quantity)) ||
                Number(quantity) < 1 ||
                !supplierId ||
                (supplierId === NEW_SUPPLIER_VALUE && !newSupplier.trim())
              }
            >
              {busy && busyIntent === "receive"
                ? "Confirmando…"
                : "Confirmar entrada"}
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={resetForNext}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </s-section>
      ) : null}

      {phase === "success" && lastMovement ? (
        <s-section heading="Entrada registrada">
          <s-stack direction="block" gap="base">
            <s-banner tone="success" heading="Inventario actualizado">
              {lastMovement.productTitle}: {lastMovement.beforeAvailable} +{" "}
              {lastMovement.quantityDelta} = {lastMovement.afterAvailable}.
            </s-banner>
            <s-paragraph>
              Folio: <code>{lastMovement.id}</code>. El movimiento quedó
              registrado como entrada desde escritorio.
            </s-paragraph>
            <s-paragraph>
              Fecha y hora:{" "}
              <strong>
                {formatDateTime(lastMovement.occurredAt, shopTimezone)}
              </strong>{" "}
              ({shopTimezone}). Proveedor:{" "}
              <strong>{lastMovement.supplier ?? "Sin proveedor"}</strong>.
            </s-paragraph>
            <div style={buttonRowStyle}>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={resetForNext}
              >
                Registrar otro producto
              </button>
              <button
                type="button"
                style={dangerButtonStyle}
                onClick={() => chooseReversal(lastMovement)}
              >
                Corregir esta entrada
              </button>
            </div>
          </s-stack>
        </s-section>
      ) : null}

      {phase === "reverse" && movementToReverse ? (
        <s-section heading="Corregir entrada">
          <s-stack direction="block" gap="base">
            <s-banner tone="warning" heading="El original no se borrará">
              Se creará un movimiento inverso por{" "}
              {Math.abs(movementToReverse.quantityDelta)} unidades para{" "}
              {movementToReverse.productTitle}.
            </s-banner>
            <label style={fieldLabelStyle}>
              Motivo obligatorio
              <textarea
                value={reversalNote}
                onChange={(event) => setReversalNote(event.currentTarget.value)}
                maxLength={500}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
                disabled={busy}
              />
            </label>
            <div style={buttonRowStyle}>
              <button
                type="button"
                style={dangerButtonStyle}
                onClick={reverse}
                disabled={busy || !reversalNote.trim()}
              >
                {busy && busyIntent === "reverse"
                  ? "Corrigiendo…"
                  : "Confirmar corrección"}
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => {
                  setMovementToReverse(null);
                  setMessage("");
                  setPhase(lastMovement ? "success" : "scan");
                }}
                disabled={busy}
              >
                Volver
              </button>
            </div>
          </s-stack>
        </s-section>
      ) : null}

      {phase === "reversed" && lastMovement ? (
        <s-section heading="Corrección registrada">
          <s-stack direction="block" gap="base">
            <s-banner tone="success" heading="Movimiento inverso aplicado">
              Existencia: {lastMovement.beforeAvailable}{" "}
              {lastMovement.quantityDelta} = {lastMovement.afterAvailable}.
            </s-banner>
            <s-paragraph>
              Folio de corrección: <code>{lastMovement.id}</code>. La entrada
              original permanece en la bitácora.
            </s-paragraph>
            <s-paragraph>
              Fecha y hora de corrección:{" "}
              <strong>
                {formatDateTime(lastMovement.occurredAt, shopTimezone)}
              </strong>{" "}
              ({shopTimezone}).
            </s-paragraph>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={resetForNext}
            >
              Registrar otra entrada
            </button>
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Últimos movimientos">
        {movements.length === 0 ? (
          <s-banner tone="auto" heading="Todavía no hay movimientos">
            La primera entrada desde PC aparecerá aquí.
          </s-banner>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {[
                    "Fecha y hora",
                    "Tipo",
                    "Producto",
                    "Proveedor",
                    "Código",
                    "Cambio",
                    "Existencia",
                    "Acción",
                  ].map((heading) => (
                    <th key={heading} style={tableHeaderStyle}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td style={cellStyle}>
                      {formatDateTime(movement.occurredAt, shopTimezone)}
                    </td>
                    <td style={cellStyle}>
                      {movement.type === "REVERSAL" ? "Corrección" : "Entrada"}
                    </td>
                    <td style={cellStyle}>
                      <strong>{movement.productTitle}</strong>
                    </td>
                    <td style={cellStyle}>{movement.supplier ?? "—"}</td>
                    <td style={cellStyle}>{movement.barcode}</td>
                    <td style={cellStyle}>
                      {movement.quantityDelta > 0 ? "+" : ""}
                      {movement.quantityDelta}
                    </td>
                    <td style={cellStyle}>
                      {movement.beforeAvailable ?? "—"} →{" "}
                      {movement.afterAvailable ?? "—"}
                    </td>
                    <td style={cellStyle}>
                      {movement.canReverse ? (
                        <button
                          type="button"
                          style={tableActionStyle}
                          onClick={() => chooseReversal(movement)}
                        >
                          Corregir
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "16px",
  maxWidth: "900px",
};

const fieldLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "7px",
  color: "#303030",
  fontSize: "14px",
  fontWeight: 600,
};

const inputStyle = {
  boxSizing: "border-box" as const,
  width: "100%",
  minHeight: "44px",
  padding: "10px 12px",
  border: "1px solid #8a8a8a",
  borderRadius: "8px",
  background: "#fff",
  color: "#202223",
  font: "inherit",
};

const primaryButtonStyle = {
  minHeight: "42px",
  padding: "10px 18px",
  border: 0,
  borderRadius: "8px",
  background: "#303030",
  color: "#fff",
  fontWeight: 650,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  border: "1px solid #8a8a8a",
  background: "#fff",
  color: "#303030",
};

const dangerButtonStyle = {
  ...primaryButtonStyle,
  background: "#b42318",
};

const tableActionStyle = {
  minHeight: "32px",
  padding: "6px 10px",
  border: "1px solid #b42318",
  borderRadius: "7px",
  background: "#fff",
  color: "#b42318",
  cursor: "pointer",
  fontWeight: 600,
};

const buttonRowStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "10px",
  marginTop: "16px",
};

const productCardStyle = {
  display: "grid",
  gridTemplateColumns: "120px minmax(0, 1fr)",
  gap: "18px",
  alignItems: "center",
  padding: "16px",
  border: "1px solid #d5d7da",
  borderRadius: "12px",
  background: "#fafafa",
};

const productImageStyle = {
  width: "120px",
  height: "120px",
  borderRadius: "10px",
  objectFit: "cover" as const,
  background: "#fff",
};

const imagePlaceholderStyle = {
  ...productImageStyle,
  display: "grid",
  placeItems: "center",
  color: "#616161",
  border: "1px dashed #8a8a8a",
};

const projectionStyle = {
  marginTop: "16px",
  padding: "13px 15px",
  borderRadius: "9px",
  background: "#eaf4ff",
  color: "#003a5a",
};

const mutedStyle = {
  marginTop: "4px",
  color: "#616161",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: "14px",
};

const tableHeaderStyle = {
  padding: "10px 8px",
  borderBottom: "1px solid #d5d7da",
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
};

const cellStyle = {
  padding: "12px 8px",
  borderBottom: "1px solid #ebebeb",
  verticalAlign: "top" as const,
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
