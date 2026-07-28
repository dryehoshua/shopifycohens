import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [movements, receiptTotals, reversalTotals, failedCount, auditCount] =
    await Promise.all([
      db.inventoryMovement.findMany({
        where: { shop: session.shop },
        orderBy: { occurredAt: "desc" },
        take: 25,
      }),
      db.inventoryMovement.aggregate({
        where: {
          shop: session.shop,
          type: "RECEIPT",
          status: "COMMITTED",
        },
        _count: { id: true },
        _sum: { quantityDelta: true },
      }),
      db.inventoryMovement.aggregate({
        where: {
          shop: session.shop,
          type: "REVERSAL",
          status: "COMMITTED",
        },
        _count: { id: true },
        _sum: { quantityDelta: true },
      }),
      db.inventoryMovement.count({
        where: { shop: session.shop, status: "FAILED" },
      }),
      db.inventoryAuditEvent.count({
        where: { shop: session.shop },
      }),
    ]);

  return {
    shop: session.shop,
    summary: {
      receiptCount: receiptTotals._count.id,
      receiptUnits: receiptTotals._sum.quantityDelta ?? 0,
      reversalCount: reversalTotals._count.id,
      reversalUnits: Math.abs(reversalTotals._sum.quantityDelta ?? 0),
      failedCount,
      auditCount,
    },
    movements: movements.map((movement) => ({
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
      note: movement.note,
      locationId: movement.locationId,
      userId: movement.userId,
      staffMemberId: movement.staffMemberId,
      reversalOfId: movement.reversalOfId,
      errorMessage: movement.errorMessage,
    })),
  };
};

function statusLabel(status: string) {
  if (status === "COMMITTED") return "Confirmado";
  if (status === "FAILED") return "Fallido";
  return "Procesando";
}

function statusTone(status: string) {
  if (status === "COMMITTED") return "success" as const;
  if (status === "FAILED") return "critical" as const;
  return "warning" as const;
}

function movementLabel(type: string) {
  return type === "REVERSAL" ? "Corrección" : "Entrada";
}

export default function InventoryDashboard() {
  const { shop, summary, movements } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Cohens Operations · Inventario">
      <s-section heading="Estado del módulo">
        <s-stack direction="block" gap="base">
          <s-banner tone="info" heading="Objetivo 1: entradas por escáner">
            El módulo registra entradas incrementales desde PC o Shopify POS.
            Cada movimiento conserva su folio, usuario, sucursal, producto,
            existencia anterior y existencia resultante.
          </s-banner>
          <s-paragraph>
            Tienda conectada: <strong>{shop}</strong>
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-badge tone="success">Captura PC preparada</s-badge>
            <s-badge tone="success">Extensión POS preparada</s-badge>
            <s-badge tone="success">Ajustes idempotentes</s-badge>
            <s-badge tone="success">Corrección sin borrado</s-badge>
            <s-badge tone="success">Webhooks de auditoría</s-badge>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Registrar mercancía desde esta computadora">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Conecta una pistola USB o Bluetooth en modo teclado/HID. La pantalla
            de recepción identifica el producto, muestra su imagen y existencia,
            y registra el movimiento con folio de auditoría.
          </s-paragraph>
          <s-link href="/app/receive">Abrir “Registrar entrada PC”</s-link>
        </s-stack>
      </s-section>

      <s-section heading="Resumen acumulado">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <Metric
            label="Entradas confirmadas"
            value={summary.receiptCount}
            detail={`${summary.receiptUnits} unidades`}
          />
          <Metric
            label="Correcciones"
            value={summary.reversalCount}
            detail={`${summary.reversalUnits} unidades revertidas`}
          />
          <Metric
            label="Intentos fallidos"
            value={summary.failedCount}
            detail="Conservados para revisión"
          />
          <Metric
            label="Eventos Shopify"
            value={summary.auditCount}
            detail="Cambios y eliminaciones capturados"
          />
        </div>
      </s-section>

      <s-section heading="Cómo se usa en tienda">
        <ol style={{ margin: 0, paddingLeft: "20px", lineHeight: 1.7 }}>
          <li>Abrir “Registrar entrada PC” desde la navegación de la app.</li>
          <li>Seleccionar la sucursal y escanear el código con la pistola.</li>
          <li>Revisar el producto, capturar la cantidad y confirmar.</li>
          <li>
            Si hubo un error, usar “Corregir esta entrada”; el original nunca se
            borra.
          </li>
        </ol>
      </s-section>

      <s-section heading="Bitácora de movimientos">
        {movements.length === 0 ? (
          <s-banner tone="auto" heading="Todavía no hay movimientos">
            La primera entrada aparecerá aquí después de la prueba física
            controlada.
          </s-banner>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr>
                  {[
                    "Fecha",
                    "Tipo",
                    "Producto",
                    "Código / SKU",
                    "Cambio",
                    "Existencia",
                    "Estado",
                    "Folio",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: "left",
                        padding: "10px 8px",
                        borderBottom: "1px solid #d5d7da",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td style={cellStyle}>
                      {new Date(movement.occurredAt).toLocaleString("es-MX")}
                    </td>
                    <td style={cellStyle}>{movementLabel(movement.type)}</td>
                    <td style={cellStyle}>
                      <strong>{movement.productTitle}</strong>
                      {movement.variantTitle &&
                      movement.variantTitle !== "Default Title" ? (
                        <div>{movement.variantTitle}</div>
                      ) : null}
                    </td>
                    <td style={cellStyle}>
                      <div>{movement.barcode}</div>
                      {movement.sku ? <div>SKU: {movement.sku}</div> : null}
                    </td>
                    <td style={cellStyle}>
                      {movement.quantityDelta > 0 ? "+" : ""}
                      {movement.quantityDelta}
                    </td>
                    <td style={cellStyle}>
                      {movement.beforeAvailable ?? "—"} →{" "}
                      {movement.afterAvailable ?? "—"}
                    </td>
                    <td style={cellStyle}>
                      <s-badge tone={statusTone(movement.status)}>
                        {statusLabel(movement.status)}
                      </s-badge>
                    </td>
                    <td
                      style={{
                        ...cellStyle,
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                        fontSize: "12px",
                      }}
                    >
                      {movement.id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading="Regla de auditoría">
        <s-paragraph>
          No existe una acción de eliminar movimientos. Una corrección genera un
          nuevo asiento inverso enlazado al original. Además, los webhooks
          conservan evidencia local de cambios de nivel y eliminaciones de
          productos o artículos de inventario en Shopify.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

const cellStyle = {
  padding: "12px 8px",
  borderBottom: "1px solid #ebebeb",
  verticalAlign: "top" as const,
};

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #d5d7da",
        borderRadius: "12px",
        padding: "16px",
        background: "#fff",
      }}
    >
      <div style={{ color: "#616161", fontSize: "13px" }}>{label}</div>
      <div
        style={{
          fontSize: "28px",
          fontWeight: 650,
          lineHeight: 1.2,
          marginTop: "4px",
        }}
      >
        {value}
      </div>
      <div style={{ color: "#616161", marginTop: "4px" }}>{detail}</div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
