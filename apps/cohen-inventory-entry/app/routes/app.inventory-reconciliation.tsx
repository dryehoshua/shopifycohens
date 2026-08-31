import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { runInventoryReconciliation } from "../inventory-reconciliation.server";
import { authenticate } from "../shopify.server";

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "OPEN";
  const kind = url.searchParams.get("kind") || "ALL";
  const locationId = url.searchParams.get("locationId") || "ALL";
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const age = Math.max(0, Math.min(Number(url.searchParams.get("age") || "0") || 0, 3650));
  const occurredAfter = age ? new Date(Date.now() - age * 86_400_000) : undefined;

  const where = {
    shop: session.shop,
    ...(status === "ALL" ? {} : { status }),
    ...(kind === "ALL" ? {} : { kind }),
    ...(locationId === "ALL" ? {} : { locationId }),
    ...(occurredAfter ? { occurredAt: { gte: occurredAfter } } : {}),
    ...(query
      ? {
          OR: [
            { productTitle: { contains: query } },
            { sku: { contains: query } },
            { barcode: { contains: query } },
            { summary: { contains: query } },
          ],
        }
      : {}),
  };

  const [issues, runs, issueKinds, issueLocations, counts] = await Promise.all([
    db.inventoryReconciliationIssue.findMany({
      where,
      orderBy: [{ severity: "asc" }, { occurredAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
    }),
    db.inventoryReconciliationRun.findMany({
      where: { shop: session.shop },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
    db.inventoryReconciliationIssue.findMany({
      where: { shop: session.shop },
      distinct: ["kind"],
      select: { kind: true },
      orderBy: { kind: "asc" },
    }),
    db.inventoryReconciliationIssue.findMany({
      where: { shop: session.shop, locationId: { not: null } },
      distinct: ["locationId"],
      select: { locationId: true, locationName: true },
      orderBy: { locationName: "asc" },
    }),
    Promise.all([
      db.inventoryReconciliationIssue.count({ where: { shop: session.shop, status: "OPEN" } }),
      db.inventoryReconciliationIssue.count({ where: { shop: session.shop, status: "OPEN", severity: "CRITICAL" } }),
      db.inventoryMovement.count({ where: { shop: session.shop, reconciliationStatus: "MATCHED" } }),
      db.inventoryMovement.count({ where: { shop: session.shop, status: "RECONCILING" } }),
    ]),
  ]);

  return {
    filters: { status, kind, locationId, query, age },
    issues: issues.map((issue) => ({
      ...issue,
      occurredAt: issue.occurredAt?.toISOString() ?? null,
      reviewedAt: issue.reviewedAt?.toISOString() ?? null,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
    })),
    runs: runs.map((run) => ({
      ...run,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    })),
    issueKinds: issueKinds.map((value) => value.kind),
    issueLocations,
    summary: {
      open: counts[0],
      critical: counts[1],
      matched: counts[2],
      reconciling: counts[3],
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Método no permitido." }, { status: 405 });
  }
  const formData = await request.formData();
  const intent = text(formData, "intent");

  if (intent === "reconcile") {
    const run = await runInventoryReconciliation(admin, session.shop, { source: "MANUAL" });
    return Response.json({ ok: true, intent, runId: run.id, status: run.status });
  }
  if (intent === "review") {
    const issueId = text(formData, "issueId");
    const reviewNote = text(formData, "reviewNote");
    if (!reviewNote) {
      return Response.json(
        { ok: false, error: "Escribe el resultado de la revisión." },
        { status: 400 },
      );
    }
    const issue = await db.inventoryReconciliationIssue.findFirst({
      where: { id: issueId, shop: session.shop },
    });
    if (!issue) {
      return Response.json({ ok: false, error: "La incidencia no existe." }, { status: 404 });
    }
    await db.inventoryReconciliationIssue.update({
      where: { id: issue.id },
      data: {
        status: "REVIEWED",
        reviewedAt: new Date(),
        reviewedBy: session.id,
        reviewNote: reviewNote.slice(0, 1000),
      },
    });
    return Response.json({ ok: true, intent, issueId });
  }
  return Response.json({ ok: false, error: "Acción no reconocida." }, { status: 400 });
};

function kindLabel(kind: string) {
  const labels: Record<string, string> = {
    EXTERNAL_CHANGE: "Cambio externo",
    MOVEMENT_UNCERTAIN: "Movimiento incierto",
    MISSING_SHOPIFY: "Sin evidencia Shopify",
    EVIDENCE_MISMATCH: "Evidencia distinta",
    SALE_PENDING_SYNC: "Venta pendiente",
  };
  return labels[kind] ?? kind;
}

function issueTone(severity: string) {
  if (severity === "CRITICAL") return "critical" as const;
  if (severity === "INFO") return "info" as const;
  return "warning" as const;
}

export default function InventoryReconciliationPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData() as
    | { ok: true; intent: string; runId?: string; issueId?: string; status?: string }
    | { ok: false; error: string }
    | undefined;
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";

  return (
    <s-page heading="Conciliación de inventario">
      <s-section heading="Estado">
        <s-stack direction="block" gap="base">
          <s-banner tone={data.summary.critical ? "critical" : "success"} heading={data.summary.critical ? "Hay incidencias críticas" : "Sin incidencias críticas abiertas"}>
            Shopify conserva la existencia oficial. Esta pantalla verifica evidencia y muestra cambios externos; nunca modifica unidades automáticamente.
          </s-banner>
          <div style={metricGrid}>
            <Metric label="Abiertas" value={data.summary.open} />
            <Metric label="Críticas" value={data.summary.critical} />
            <Metric label="Movimientos conciliados" value={data.summary.matched} />
            <Metric label="Conciliando" value={data.summary.reconciling} />
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="reconcile" />
            <s-button type="submit" variant="primary" disabled={pending}>
              {pending ? "Conciliando…" : "Ejecutar conciliación ahora"}
            </s-button>
          </Form>
          {actionData ? (
            <s-banner tone={actionData.ok ? "success" : "critical"}>
              {actionData.ok ? "Operación completada." : actionData.error}
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Filtros">
        <Form method="get">
          <div style={filterGrid}>
            <label>Estado<select name="status" defaultValue={data.filters.status}><option value="OPEN">Abiertas</option><option value="REVIEWED">Revisadas</option><option value="RESOLVED">Resueltas automáticamente</option><option value="ALL">Todas</option></select></label>
            <label>Tipo<select name="kind" defaultValue={data.filters.kind}><option value="ALL">Todos</option>{data.issueKinds.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select></label>
            <label>Ubicación<select name="locationId" defaultValue={data.filters.locationId}><option value="ALL">Todas</option>{data.issueLocations.map((location) => <option key={location.locationId} value={location.locationId ?? ""}>{location.locationName || location.locationId}</option>)}</select></label>
            <label>Antigüedad<select name="age" defaultValue={String(data.filters.age)}><option value="0">Todo el historial</option><option value="1">Último día</option><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select></label>
            <label style={{ gridColumn: "span 2" }}>Producto, SKU o código<input name="q" defaultValue={data.filters.query} /></label>
            <s-button type="submit">Aplicar filtros</s-button>
          </div>
        </Form>
      </s-section>

      <s-section heading={`Incidencias (${data.issues.length})`}>
        {!data.issues.length ? (
          <s-banner tone="success">No hay incidencias para estos filtros.</s-banner>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {data.issues.map((issue) => (
              <article key={issue.id} style={issueCard}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <s-badge tone={issueTone(issue.severity)}>{kindLabel(issue.kind)}</s-badge>
                    <h3 style={{ margin: "8px 0 4px" }}>{issue.productTitle || issue.summary}</h3>
                    {issue.productTitle ? <strong>{issue.summary}</strong> : null}
                  </div>
                  <small>{new Date(issue.occurredAt || issue.updatedAt).toLocaleString("es-MX")}</small>
                </div>
                <p>{issue.detail}</p>
                <div style={{ color: "#616161", fontSize: 13 }}>
                  {issue.locationName || issue.locationId || "Sin ubicación"}
                  {issue.barcode ? ` · Código ${issue.barcode}` : ""}
                  {issue.sku ? ` · SKU ${issue.sku}` : ""}
                  {issue.actualAvailable !== null ? ` · Disponible actual ${issue.actualAvailable}` : ""}
                </div>
                {issue.status === "OPEN" ? (
                  <Form method="post" style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "end", flexWrap: "wrap" }}>
                    <input type="hidden" name="intent" value="review" />
                    <input type="hidden" name="issueId" value={issue.id} />
                    <label style={{ flex: "1 1 320px" }}>Resultado de la revisión<input name="reviewNote" required maxLength={1000} placeholder="Conteo físico verificado, venta identificada, ajuste autorizado…" /></label>
                    <s-button type="submit" disabled={pending}>Marcar revisada</s-button>
                  </Form>
                ) : issue.reviewNote ? <p><strong>Revisión:</strong> {issue.reviewNote}</p> : null}
              </article>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading="Últimas ejecuciones">
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={cell}>Inicio</th><th style={cell}>Origen</th><th style={cell}>Estado</th><th style={cell}>Examinados</th><th style={cell}>Coincidentes</th><th style={cell}>Externos</th><th style={cell}>Abiertas</th></tr></thead><tbody>{data.runs.map((run) => <tr key={run.id}><td style={cell}>{new Date(run.startedAt).toLocaleString("es-MX")}</td><td style={cell}>{run.source}</td><td style={cell}>{run.status}</td><td style={cell}>{run.movementsExamined}</td><td style={cell}>{run.movementsMatched}</td><td style={cell}>{run.externalChanges}</td><td style={cell}>{run.openIssues}</td></tr>)}</tbody></table></div>
      </s-section>
    </s-page>
  );
}

const metricGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 };
const filterGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" };
const issueCard = { border: "1px solid #d5d7da", borderRadius: 12, padding: 16, background: "#fff" };
const cell = { textAlign: "left" as const, padding: "10px 8px", borderBottom: "1px solid #ebebeb" };

function Metric({ label, value }: { label: string; value: number }) {
  return <div style={{ border: "1px solid #d5d7da", borderRadius: 10, padding: 12 }}><small>{label}</small><div style={{ fontSize: 26, fontWeight: 650 }}>{value}</div></div>;
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
