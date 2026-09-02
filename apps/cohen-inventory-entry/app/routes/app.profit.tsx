import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const PERIODS = new Set(["today", "7d", "30d", "all"]);
const PRODUCT_SORT_FIELDS = new Set([
  "product",
  "sku",
  "units",
  "sales",
  "cost",
  "profit",
  "margin",
]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);

function mexicoDayStart(daysAgo = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const start = new Date(
    `${value.year}-${value.month}-${value.day}T00:00:00-06:00`,
  );
  start.setUTCDate(start.getUTCDate() - daysAgo);
  return start;
}

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseMexicoDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-06:00`,
  );
  if (Number.isNaN(date.getTime()) || dateKey(date) !== value) return null;
  return date;
}

function profitHref({
  baseUrl = "/app/profit",
  period,
  dateFrom,
  dateTo,
  sort,
  direction,
}: {
  baseUrl?: string;
  period: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  sort: string;
  direction: string;
}) {
  const params = new URLSearchParams();
  if (dateFrom || dateTo) {
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
  } else {
    params.set("period", period);
  }
  params.set("sort", sort);
  params.set("dir", direction);
  return `${baseUrl}?${params.toString()}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // La tienda autenticada es la única fuente válida para este tablero. Así una
  // instalación abierta desde cafetería nunca puede consultar resultados de
  // retail (ni viceversa), aunque ambas compartan backend y base de datos.
  const sourceShop = session.shop.trim().toLowerCase();
  const configuredSourceShop = process.env.COHENS_SOURCE_SHOP
    ?.trim()
    .toLowerCase();
  const cafeShop = process.env.CAFE_SHOP_DOMAIN?.trim().toLowerCase();
  const retailShop = process.env.RETAIL_SHOP_DOMAIN?.trim().toLowerCase();
  const sourceShopName =
    sourceShop === cafeShop
      ? "Cohen's Cafe"
      : sourceShop === retailShop
        ? "Tienda"
        : sourceShop === configuredSourceShop
          ? process.env.COHENS_SOURCE_SHOP_NAME?.trim() || sourceShop
          : sourceShop;
  const url = new URL(request.url);
  const requestedPeriod = url.searchParams.get("period") ?? "30d";
  const quickPeriod = PERIODS.has(requestedPeriod) ? requestedPeriod : "30d";
  const requestedProductSort = url.searchParams.get("sort") ?? "profit";
  const productSort = PRODUCT_SORT_FIELDS.has(requestedProductSort)
    ? requestedProductSort
    : "profit";
  const requestedDirection = url.searchParams.get("dir") ?? "desc";
  const productDirection = SORT_DIRECTIONS.has(requestedDirection)
    ? requestedDirection
    : "desc";
  let dateFrom = url.searchParams.get("from");
  let dateTo = url.searchParams.get("to");
  let fromDate = parseMexicoDate(dateFrom);
  let toDate = parseMexicoDate(dateTo, true);

  dateFrom = fromDate ? dateFrom : null;
  dateTo = toDate ? dateTo : null;
  if (fromDate && toDate && fromDate > toDate) {
    [fromDate, toDate] = [
      parseMexicoDate(dateTo),
      parseMexicoDate(dateFrom, true),
    ];
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  const hasCustomDates = Boolean(fromDate || toDate);
  const period = hasCustomDates ? "custom" : quickPeriod;
  const since =
    quickPeriod === "today"
      ? mexicoDayStart(0)
      : quickPeriod === "7d"
        ? mexicoDayStart(6)
        : quickPeriod === "30d"
          ? mexicoDayStart(29)
          : null;
  const createdAt = hasCustomDates
    ? {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      }
    : since
      ? { gte: since }
      : null;

  const where = {
    sourceShop,
    includedInProfit: true,
    ...(createdAt ? { createdAt } : {}),
  };

  const [orders, latestSync, excludedOrders] = await Promise.all([
    db.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { lineItems: true, refunds: true },
    }),
    db.salesSyncRun.findFirst({
      where: { sourceShop },
      orderBy: { startedAt: "desc" },
    }),
    db.salesOrder.count({
      where: {
        sourceShop,
        includedInProfit: false,
        ...(createdAt ? { createdAt } : {}),
      },
    }),
  ]);

  const totals = {
    orders: orders.length,
    units: 0,
    originalSalesCents: 0,
    discountsCents: 0,
    refundedPaymentsCents: 0,
    refundedProductCents: 0,
    netSalesCents: 0,
    calculableCostCents: 0,
    calculableProfitCents: 0,
    coveredNetSalesCents: 0,
    missingCostSalesCents: 0,
    missingCostLines: 0,
  };
  const products = new Map<
    string,
    {
      key: string;
      productTitle: string;
      variantTitle: string | null;
      sku: string | null;
      units: number;
      netSalesCents: number;
      costCents: number;
      profitCents: number;
      coveredSalesCents: number;
      missingCostSalesCents: number;
    }
  >();
  const daily = new Map<
    string,
    { date: string; netSalesCents: number; profitCents: number }
  >();
  const missingCosts = new Map<
    string,
    {
      key: string;
      productTitle: string;
      variantTitle: string | null;
      sku: string | null;
      units: number;
      netSalesCents: number;
    }
  >();

  for (const order of orders) {
    totals.units += order.netItemQuantity;
    totals.originalSalesCents += order.originalSalesCents;
    totals.discountsCents += order.discountCents;
    totals.refundedPaymentsCents += order.refundedPaymentCents;
    totals.refundedProductCents += order.refundedProductCents;
    totals.netSalesCents += order.netSalesCents;
    totals.calculableCostCents += order.calculableCostCents;
    totals.calculableProfitCents += order.calculableProfitCents;
    totals.coveredNetSalesCents += order.coveredNetSalesCents;
    totals.missingCostSalesCents += order.missingCostSalesCents;

    const day = dateKey(order.createdAt);
    const dailyValue = daily.get(day) ?? {
      date: day,
      netSalesCents: 0,
      profitCents: 0,
    };
    dailyValue.netSalesCents += order.netSalesCents;
    dailyValue.profitCents += order.calculableProfitCents;
    daily.set(day, dailyValue);

    for (const line of order.lineItems) {
      const productKey =
        line.shopifyVariantId ??
        `${line.productTitle}|${line.variantTitle ?? ""}|${line.sku ?? ""}`;
      const product = products.get(productKey) ?? {
        key: productKey,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        sku: line.sku,
        units: 0,
        netSalesCents: 0,
        costCents: 0,
        profitCents: 0,
        coveredSalesCents: 0,
        missingCostSalesCents: 0,
      };
      product.units += line.netQuantity;
      product.netSalesCents += line.netSalesCents;
      product.costCents += line.calculatedCostCents ?? 0;
      product.profitCents += line.calculatedProfitCents ?? 0;
      if (line.currentUnitCostCents == null && line.netSalesCents !== 0) {
        totals.missingCostLines += 1;
        product.missingCostSalesCents += line.netSalesCents;
        const missing = missingCosts.get(productKey) ?? {
          key: productKey,
          productTitle: line.productTitle,
          variantTitle: line.variantTitle,
          sku: line.sku,
          units: 0,
          netSalesCents: 0,
        };
        missing.units += line.netQuantity;
        missing.netSalesCents += line.netSalesCents;
        missingCosts.set(productKey, missing);
      } else {
        product.coveredSalesCents += line.netSalesCents;
      }
      products.set(productKey, product);
    }
  }

  const coverageBasisPoints =
    totals.netSalesCents === 0
      ? 0
      : Math.round(
          (totals.coveredNetSalesCents / totals.netSalesCents) * 10_000,
        );
  const marginBasisPoints =
    totals.coveredNetSalesCents === 0
      ? 0
      : Math.round(
          (totals.calculableProfitCents / totals.coveredNetSalesCents) *
            10_000,
        );

  const allProducts = [...products.values()].map((product) => ({
    ...product,
    marginBasisPoints:
      product.coveredSalesCents === 0
        ? null
        : Math.round(
            (product.profitCents / product.coveredSalesCents) * 10_000,
          ),
  }));
  const sortedProducts = allProducts.slice();
  const collator = new Intl.Collator("es-MX", {
    sensitivity: "base",
    numeric: true,
  });
  sortedProducts.sort((left, right) => {
    const leftHasIncompleteCost = left.missingCostSalesCents !== 0;
    const rightHasIncompleteCost = right.missingCostSalesCents !== 0;
    if (leftHasIncompleteCost !== rightHasIncompleteCost) {
      return leftHasIncompleteCost ? 1 : -1;
    }

    let comparison = 0;
    if (productSort === "product") {
      comparison = collator.compare(
        `${left.productTitle} ${left.variantTitle ?? ""}`,
        `${right.productTitle} ${right.variantTitle ?? ""}`,
      );
    } else if (productSort === "sku") {
      comparison = collator.compare(left.sku ?? "", right.sku ?? "");
    } else if (productSort === "units") {
      comparison = left.units - right.units;
    } else if (productSort === "sales") {
      comparison = left.netSalesCents - right.netSalesCents;
    } else if (productSort === "cost") {
      comparison = left.costCents - right.costCents;
    } else if (productSort === "margin") {
      comparison =
        (left.marginBasisPoints ?? Number.NEGATIVE_INFINITY) -
        (right.marginBasisPoints ?? Number.NEGATIVE_INFINITY);
    } else {
      comparison = left.profitCents - right.profitCents;
    }

    if (comparison === 0) {
      comparison = collator.compare(left.productTitle, right.productTitle);
    }
    return productDirection === "asc" ? comparison : -comparison;
  });

  return {
    sourceShop,
    sourceShopName,
    // Mantener filtros y navegación dentro de la instalación actual evita
    // saltar a una URL de administrador configurada para otra tienda.
    analyticsActionUrl: "/app/profit",
    period,
    dateFrom,
    dateTo,
    productSort,
    productDirection,
    totalProducts: allProducts.length,
    excludedOrders,
    totals: { ...totals, coverageBasisPoints, marginBasisPoints },
    latestSync: latestSync
      ? {
          id: latestSync.id,
          status: latestSync.status,
          startedAt: latestSync.startedAt.toISOString(),
          completedAt: latestSync.completedAt?.toISOString() ?? null,
          costCapturedAt: latestSync.costCapturedAt.toISOString(),
          ordersImported: latestSync.ordersImported,
          lineItemsSeen: latestSync.lineItemsSeen,
          refundsSeen: latestSync.refundsSeen,
          oldestOrderAt: latestSync.oldestOrderAt?.toISOString() ?? null,
          newestOrderAt: latestSync.newestOrderAt?.toISOString() ?? null,
          errorMessage: latestSync.errorMessage,
        }
      : null,
    products: sortedProducts,
    daily: [...daily.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    missingCosts: [...missingCosts.values()]
      .sort((a, b) => b.netSalesCents - a.netSalesCents)
      .slice(0, 25),
    recentOrders: orders.slice(0, 20).map((order) => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt.toISOString(),
      financialStatus: order.financialStatus,
      sourceName: order.sourceName,
      netItemQuantity: order.netItemQuantity,
      netSalesCents: order.netSalesCents,
      refundedPaymentCents: order.refundedPaymentCents,
      calculableCostCents: order.calculableCostCents,
      calculableProfitCents: order.calculableProfitCents,
      profitComplete: order.profitComplete,
    })),
  };
};

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function percent(basisPoints: number) {
  return `${new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(basisPoints / 100)}%`;
}

function syncStatus(status: string) {
  if (status === "COMPLETED") return "Completa";
  if (status === "PARTIAL_HISTORY") return "Historial parcial";
  if (status === "FAILED") return "Falló";
  return "En proceso";
}

function syncTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "FAILED") return "critical" as const;
  return "warning" as const;
}

const cellStyle = {
  padding: "11px 8px",
  borderBottom: "1px solid #ebebeb",
  verticalAlign: "top" as const,
  whiteSpace: "nowrap" as const,
};

export default function ProfitAnalytics() {
  const data = useLoaderData<typeof loader>();
  const maxDailySales = Math.max(
    1,
    ...data.daily.map((item) => item.netSalesCents),
  );

  return (
    <s-page heading="Cohens Operations · Analíticos de utilidad">
      <s-section heading="Definición del indicador">
        <s-stack direction="block" gap="base">
          <s-banner tone="info" heading="Utilidad bruta estimada con costo actual">
            Venta neta de cada partida, después de descuentos y reembolsos,
            menos cantidad neta por el valor actual de “Costo por artículo”.
            Renta, nómina, comisiones, mermas y otros gastos todavía no están
            incluidos; por eso este indicador no es utilidad neta.
          </s-banner>
          <s-banner tone="success" heading="Los reembolsos se descuentan una sola vez">
            Shopify entrega la venta de cada partida excluyendo las unidades
            reembolsadas o retiradas. La app también revierte el costo de esas
            unidades; el monto financiero se muestra como control, pero no se
            vuelve a restar de la venta neta.
          </s-banner>
          <s-paragraph>
            Fuente de ventas: <strong>{data.sourceShopName}</strong> (
            {data.sourceShop}). Los pedidos de prueba, cancelados y con pago
            pendiente se excluyen del resultado.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Periodo">
        <div style={{ display: "grid", gap: "14px" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[
              ["today", "Hoy"],
              ["7d", "7 días"],
              ["30d", "30 días"],
              ["all", "Todo"],
            ].map(([value, label]) => (
              <a
                key={value}
                href={profitHref({
                  baseUrl: data.analyticsActionUrl,
                  period: value,
                  sort: data.productSort,
                  direction: data.productDirection,
                })}
                target={
                  data.analyticsActionUrl.startsWith(
                    "https://admin.shopify.com/",
                  )
                    ? "_top"
                    : undefined
                }
                style={{
                  padding: "8px 13px",
                  borderRadius: "999px",
                  textDecoration: "none",
                  border: "1px solid #c9cccf",
                  color: data.period === value ? "#fff" : "#202223",
                  background: data.period === value ? "#1f5132" : "#fff",
                  fontWeight: 600,
                }}
              >
                {label}
              </a>
            ))}
          </div>
          <form
            method="get"
            target={data.analyticsActionUrl.startsWith("https://admin.shopify.com/")
              ? "_top"
              : undefined}
            action={data.analyticsActionUrl}
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "end",
              flexWrap: "wrap",
            }}
          >
            <input type="hidden" name="sort" value={data.productSort} />
            <input
              type="hidden"
              name="dir"
              value={data.productDirection}
            />
            <DateField label="Desde" name="from" value={data.dateFrom ?? ""} />
            <DateField label="Hasta" name="to" value={data.dateTo ?? ""} />
            <button
              type="submit"
              style={{
                minHeight: "38px",
                padding: "8px 14px",
                border: "1px solid #1f5132",
                borderRadius: "8px",
                background: "#1f5132",
                color: "#fff",
                fontWeight: 650,
                cursor: "pointer",
              }}
            >
              Aplicar fechas
            </button>
            {data.dateFrom || data.dateTo ? (
              <a
                href={profitHref({
                  baseUrl: data.analyticsActionUrl,
                  period: "30d",
                  sort: data.productSort,
                  direction: data.productDirection,
                })}
                target={
                  data.analyticsActionUrl.startsWith(
                    "https://admin.shopify.com/",
                  )
                    ? "_top"
                    : undefined
                }
                style={{
                  minHeight: "38px",
                  padding: "8px 5px",
                  boxSizing: "border-box",
                  color: "#1f5132",
                  fontWeight: 600,
                }}
              >
                Limpiar
              </a>
            ) : null}
          </form>
          {data.period === "custom" ? (
            <div style={{ color: "#616161", fontSize: "13px" }}>
              Rango personalizado: {data.dateFrom ?? "inicio"} –{" "}
              {data.dateTo ?? "hoy"}
            </div>
          ) : null}
        </div>
      </s-section>

      {!data.latestSync ? (
        <s-section heading="Sincronización de ventas">
          <s-banner tone="warning" heading="La estructura está lista para importar">
            Falta autorizar el acceso de solo lectura a pedidos, productos e
            inventario de la tienda productiva. Después de autorizarlo, el
            primer proceso traerá el historial disponible y sus reembolsos.
          </s-banner>
        </s-section>
      ) : (
        <s-section heading="Sincronización de ventas">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-badge tone={syncTone(data.latestSync.status)}>
                {syncStatus(data.latestSync.status)}
              </s-badge>
              <s-badge tone="info">
                {data.latestSync.ordersImported} pedidos
              </s-badge>
              <s-badge tone="info">
                {data.latestSync.lineItemsSeen} partidas
              </s-badge>
              <s-badge tone="info">
                {data.latestSync.refundsSeen} reembolsos
              </s-badge>
            </s-stack>
            <s-paragraph>
              Costo capturado:{" "}
              {new Date(data.latestSync.costCapturedAt).toLocaleString(
                "es-MX",
                { timeZone: "America/Mexico_City" },
              )}
              .
            </s-paragraph>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Resultado">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: "12px",
          }}
        >
          <Metric
            label="Venta neta"
            value={money(data.totals.netSalesCents)}
            detail={`${data.totals.orders} pedidos · ${data.totals.units} unidades`}
          />
          <Metric
            label="Costo calculable"
            value={money(data.totals.calculableCostCents)}
            detail="Cantidad neta × costo actual"
          />
          <Metric
            label="Utilidad bruta calculable"
            value={money(data.totals.calculableProfitCents)}
            detail={`Margen ${percent(data.totals.marginBasisPoints)}`}
            accent
          />
          <Metric
            label="Cobertura de costo"
            value={percent(data.totals.coverageBasisPoints)}
            detail={`${money(data.totals.missingCostSalesCents)} sin costo`}
            warning={data.totals.missingCostLines > 0}
          />
          <Metric
            label="Descuentos"
            value={money(data.totals.discountsCents)}
            detail="Aplicados antes y después de cambios"
          />
          <Metric
            label="Artículos reembolsados"
            value={money(data.totals.refundedProductCents)}
            detail={`${money(data.totals.refundedPaymentsCents)} devuelto en transacciones exitosas`}
          />
        </div>
        {data.excludedOrders > 0 ? (
          <div style={{ marginTop: "12px" }}>
            <s-banner tone="auto" heading="Pedidos fuera del cálculo">
              {data.excludedOrders} pedidos del periodo son pruebas,
              cancelaciones o pagos aún no realizados.
            </s-banner>
          </div>
        ) : null}
      </s-section>

      <s-section heading="Venta neta por día">
        {data.daily.length === 0 ? (
          <s-paragraph>La gráfica aparecerá después de la importación.</s-paragraph>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "end",
              gap: "6px",
              minHeight: "190px",
              overflowX: "auto",
              padding: "12px 4px 4px",
            }}
          >
            {data.daily.map((day) => (
              <div
                key={day.date}
                title={`${day.date}: ${money(day.netSalesCents)}`}
                style={{
                  minWidth: "24px",
                  flex: "1 0 24px",
                  maxWidth: "52px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    height: `${Math.max(
                      3,
                      Math.round((day.netSalesCents / maxDailySales) * 145),
                    )}px`,
                    borderRadius: "6px 6px 2px 2px",
                    background: "#1f5132",
                  }}
                />
                <div
                  style={{
                    fontSize: "10px",
                    color: "#616161",
                    marginTop: "5px",
                  }}
                >
                  {day.date.slice(5)}
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading="Base de productos y utilidad">
        <s-paragraph>
          Mostrando {data.products.length} de {data.totalProducts} productos del
          periodo seleccionado. Los productos sin costo completo permanecen al
          final porque su utilidad todavía es desconocida.
        </s-paragraph>
        {data.products.length === 0 ? (
          <s-paragraph>
            No hay productos que coincidan con la búsqueda.
          </s-paragraph>
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
                    ["product", "Producto"],
                    ["sku", "SKU"],
                    ["units", "Unidades netas"],
                    ["sales", "Venta neta"],
                    ["cost", "Costo actual"],
                    ["profit", "Utilidad"],
                    ["margin", "Margen"],
                  ].map(([field, heading]) => (
                    <th
                      key={field}
                      style={{ ...cellStyle, textAlign: "left" }}
                    >
                      <SortHeader
                        label={heading}
                        field={field}
                        baseUrl={data.analyticsActionUrl}
                        period={data.period}
                        dateFrom={data.dateFrom}
                        dateTo={data.dateTo}
                        activeField={data.productSort}
                        activeDirection={data.productDirection}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => {
                  return (
                    <tr key={product.key}>
                      <td style={cellStyle}>
                        <strong>{product.productTitle}</strong>
                        {product.variantTitle &&
                        product.variantTitle !== "Default Title" ? (
                          <div>{product.variantTitle}</div>
                        ) : null}
                      </td>
                      <td style={cellStyle}>{product.sku ?? "—"}</td>
                      <td style={cellStyle}>{product.units}</td>
                      <td style={cellStyle}>{money(product.netSalesCents)}</td>
                      <td style={cellStyle}>{money(product.costCents)}</td>
                      <td style={cellStyle}>{money(product.profitCents)}</td>
                      <td style={cellStyle}>
                        {product.marginBasisPoints == null
                          ? "Sin costo"
                          : percent(product.marginBasisPoints)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {data.missingCosts.length > 0 ? (
        <s-section heading="Productos que requieren costo">
          <s-banner tone="warning" heading="No se usa costo cero por defecto">
            Estas partidas quedan fuera de la utilidad calculable hasta capturar
            “Costo por artículo”. La venta sí se conserva y aparece como
            cobertura pendiente.
          </s-banner>
          <div style={{ overflowX: "auto", marginTop: "12px" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr>
                  <th style={{ ...cellStyle, textAlign: "left" }}>Producto</th>
                  <th style={{ ...cellStyle, textAlign: "left" }}>SKU</th>
                  <th style={{ ...cellStyle, textAlign: "left" }}>Unidades</th>
                  <th style={{ ...cellStyle, textAlign: "left" }}>
                    Venta sin costo
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.missingCosts.map((product) => (
                  <tr key={product.key}>
                    <td style={cellStyle}>
                      <strong>{product.productTitle}</strong>
                      {product.variantTitle &&
                      product.variantTitle !== "Default Title" ? (
                        <div>{product.variantTitle}</div>
                      ) : null}
                    </td>
                    <td style={cellStyle}>{product.sku ?? "—"}</td>
                    <td style={cellStyle}>{product.units}</td>
                    <td style={cellStyle}>{money(product.netSalesCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-section>
      ) : null}

      <s-section heading="Pedidos recientes">
        {data.recentOrders.length === 0 ? (
          <s-paragraph>No hay pedidos sincronizados en este periodo.</s-paragraph>
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
                    "Pedido",
                    "Fecha",
                    "Canal",
                    "Estado",
                    "Venta neta",
                    "Reembolso",
                    "Costo",
                    "Utilidad",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{ ...cellStyle, textAlign: "left" }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td style={cellStyle}>
                      <strong>{order.name}</strong>
                      {!order.profitComplete ? (
                        <div style={{ color: "#8a6116" }}>Costo incompleto</div>
                      ) : null}
                    </td>
                    <td style={cellStyle}>
                      {new Date(order.createdAt).toLocaleString("es-MX", {
                        timeZone: "America/Mexico_City",
                      })}
                    </td>
                    <td style={cellStyle}>{order.sourceName ?? "—"}</td>
                    <td style={cellStyle}>
                      {order.financialStatus ?? "—"}
                    </td>
                    <td style={cellStyle}>{money(order.netSalesCents)}</td>
                    <td style={cellStyle}>
                      {money(order.refundedPaymentCents)}
                    </td>
                    <td style={cellStyle}>
                      {money(order.calculableCostCents)}
                    </td>
                    <td style={cellStyle}>
                      {money(order.calculableProfitCents)}
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

function DateField({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label
      style={{
        display: "grid",
        gap: "5px",
        color: "#414141",
        fontSize: "13px",
        fontWeight: 600,
      }}
    >
      {label}
      <input
        type="date"
        name={name}
        defaultValue={value}
        style={{
          minHeight: "38px",
          padding: "7px 10px",
          border: "1px solid #8c9196",
          borderRadius: "8px",
          background: "#fff",
          color: "#202223",
          font: "inherit",
        }}
      />
    </label>
  );
}

function SortHeader({
  label,
  field,
  baseUrl,
  period,
  dateFrom,
  dateTo,
  activeField,
  activeDirection,
}: {
  label: string;
  field: string;
  baseUrl: string;
  period: string;
  dateFrom: string | null;
  dateTo: string | null;
  activeField: string;
  activeDirection: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
      <span>{label}</span>
      {(["asc", "desc"] as const).map((direction) => {
        const active =
          activeField === field && activeDirection === direction;
        const ascending = direction === "asc";
        return (
          <a
            key={direction}
            href={profitHref({
              baseUrl,
              period,
              dateFrom,
              dateTo,
              sort: field,
              direction,
            })}
            target={
              baseUrl.startsWith("https://admin.shopify.com/")
                ? "_top"
                : undefined
            }
            aria-label={`Ordenar ${label} ${
              ascending ? "de menor a mayor" : "de mayor a menor"
            }`}
            aria-current={active ? "page" : undefined}
            title={
              ascending
                ? "Menor a mayor / A–Z"
                : "Mayor a menor / Z–A"
            }
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: "21px",
              height: "21px",
              borderRadius: "5px",
              textDecoration: "none",
              color: active ? "#fff" : "#6d7175",
              background: active ? "#1f5132" : "transparent",
              fontSize: "14px",
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            {ascending ? "↑" : "↓"}
          </a>
        );
      })}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
  accent = false,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${
          warning ? "#d6a419" : accent ? "#70a37f" : "#d5d7da"
        }`,
        borderRadius: "12px",
        padding: "16px",
        background: accent ? "#f2f8f4" : warning ? "#fff8db" : "#fff",
      }}
    >
      <div style={{ color: "#616161", fontSize: "13px" }}>{label}</div>
      <div
        style={{
          fontSize: "26px",
          fontWeight: 650,
          lineHeight: 1.2,
          marginTop: "4px",
          color: accent ? "#1f5132" : "#202223",
        }}
      >
        {value}
      </div>
      <div style={{ color: "#616161", marginTop: "5px" }}>{detail}</div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
