import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  CafePosError,
  assertDedicatedCafeAdminShop,
  createCafeStaff,
  listCafeStaff,
  setCafeStaffActive,
} from "../cafe-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  assertDedicatedCafeAdminShop(session.shop);
  const staff = await listCafeStaff(session.shop);
  return { staff, posUrl: new URL("/cafe-pos", process.env.SHOPIFY_APP_URL || request.url).toString() };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    assertDedicatedCafeAdminShop(session.shop);
    const formData = await request.formData();
    const intent = String(formData.get("intent") ?? "");
    if (intent === "create") {
      const staff = await createCafeStaff(session.shop, String(formData.get("name") ?? ""), String(formData.get("pin") ?? ""));
      return { ok: true as const, message: `PIN actualizado para ${staff.name}.` };
    }
    if (intent === "toggle") {
      await setCafeStaffActive(session.shop, String(formData.get("staffId") ?? ""), formData.get("active") === "true");
      return { ok: true as const, message: "Acceso actualizado." };
    }
    throw new CafePosError("Acción no válida.");
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Error desconocido." };
  }
}

export default function CafePosAdmin() {
  const { staff, posUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const pending = useNavigation().state !== "idle";
  return (
    <s-page heading="POS web · Cohen's Cafe">
      <s-section heading="Abrir punto de venta">
        <s-stack direction="block" gap="base">
          <s-banner tone="info" heading="Esta pantalla solo configura el acceso">
            Las ventas no se hacen en este panel. Abre la caja con el botón de abajo para seleccionar productos, cobrar y emitir el ticket.
          </s-banner>
          <a
            href={posUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              width: "100%",
              padding: "18px 24px",
              borderRadius: 12,
              background: "#26744c",
              color: "white",
              fontSize: 18,
              fontWeight: 800,
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            Abrir punto de venta
          </a>
          <s-paragraph>
            Funciona en Chrome desde tablet o computadora. La caja permite armar la cuenta, cobrar en efectivo o terminal, registrar la venta en Shopify y mandar el ticket automáticamente a la impresora autorizada.
          </s-paragraph>
          <s-paragraph>
            Dirección directa para guardar en la pantalla principal: <a href={posUrl} target="_blank" rel="noreferrer">{posUrl}</a>
          </s-paragraph>
          <s-banner tone="warning" heading="Primera conexión de la impresora">
            Conecta la POS58D por USB, abre la caja en Chrome y toca “Conectar impresora” una sola vez para autorizarla. Después, cada venta terminada intenta imprimir el ticket automáticamente.
          </s-banner>
        </s-stack>
      </s-section>
      <s-section heading="Crear o restablecer PIN">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <s-stack direction="block" gap="base">
            <label>Nombre<br /><input name="name" required minLength={2} maxLength={80} autoComplete="off" /></label>
            <label>PIN de 4 a 8 dígitos<br /><input name="pin" required pattern="[0-9]{4,8}" inputMode="numeric" type="password" autoComplete="new-password" /></label>
            <s-button type="submit" variant="primary" disabled={pending}>{pending ? "Guardando…" : "Guardar empleado"}</s-button>
          </s-stack>
        </Form>
        {result?.ok ? <s-banner tone="success">{result.message}</s-banner> : null}
        {result && !result.ok ? <s-banner tone="critical">{result.error}</s-banner> : null}
      </s-section>
      <s-section heading="Personal autorizado">
        {staff.length === 0 ? <s-paragraph>Aún no hay empleados. Crea el primero antes de abrir la POS.</s-paragraph> : null}
        <s-stack direction="block" gap="base">
          {staff.map((member) => (
            <div key={member.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
              <span>{member.name} · {member.active ? "Activo" : "Desactivado"}</span>
              <Form method="post">
                <input type="hidden" name="intent" value="toggle" />
                <input type="hidden" name="staffId" value={member.id} />
                <input type="hidden" name="active" value={member.active ? "false" : "true"} />
                <s-button type="submit" disabled={pending}>{member.active ? "Desactivar" : "Activar"}</s-button>
              </Form>
            </div>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (args) => boundary.headers(args);
