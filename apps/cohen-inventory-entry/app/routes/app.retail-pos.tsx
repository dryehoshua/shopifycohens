import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  assertRetailAdminShop,
  createRetailStaff,
  listRetailStaff,
  RetailPosError,
  setRetailStaffActive,
} from "../retail-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  assertRetailAdminShop(session.shop);
  return {
    staff: await listRetailStaff(session.shop),
    posUrl: new URL("/retail-pos", process.env.SHOPIFY_APP_URL || request.url).toString(),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    assertRetailAdminShop(session.shop);
    const formData = await request.formData();
    const intent = String(formData.get("intent") ?? "");
    if (intent === "create") {
      const staff = await createRetailStaff(session.shop, String(formData.get("name") ?? ""), String(formData.get("pin") ?? ""));
      return { ok: true as const, message: `PIN actualizado para ${staff.name}.` };
    }
    if (intent === "toggle") {
      await setRetailStaffActive(session.shop, String(formData.get("staffId") ?? ""), formData.get("active") === "true");
      return { ok: true as const, message: "Acceso actualizado." };
    }
    throw new RetailPosError("Acción no válida.");
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Error desconocido." };
  }
}

export default function RetailPosAdmin() {
  const { staff, posUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const pending = useNavigation().state !== "idle";
  return <s-page heading="Cohen's Store · Retail POS">
    <s-section heading="Punto de venta de tienda">
      <s-stack direction="block" gap="base">
        <s-banner tone="info" heading="Basada en Shopify, operada por Cohen's">
          El catálogo, los clientes, el inventario y los pedidos pertenecen a Shopify. Esta caja agrega lectura de códigos, Nekudot, turnos, pagos y tickets con un flujo diseñado para retail.
        </s-banner>
        <a href={posUrl} target="_blank" rel="noreferrer" style={{ display: "block", width: "100%", padding: "18px 24px", borderRadius: 12, background: "#237153", color: "white", fontSize: 18, fontWeight: 800, textAlign: "center", textDecoration: "none" }}>Abrir Retail POS</a>
        <s-paragraph>Dirección para guardar en la computadora de caja: <a href={posUrl} target="_blank" rel="noreferrer">{posUrl}</a></s-paragraph>
        <s-banner tone="warning" heading="Hardware de caja">
          Usa Chrome. Autoriza una vez la impresora USB desde “Impresora”. El lector de códigos puede funcionar como teclado y el lector RFID usa el puente local de Nekudot.
        </s-banner>
      </s-stack>
    </s-section>
    <s-section heading="Crear o restablecer PIN retail">
      <Form method="post"><input type="hidden" name="intent" value="create" /><s-stack direction="block" gap="base">
        <label>Nombre<br /><input name="name" required minLength={2} maxLength={80} autoComplete="off" /></label>
        <label>PIN de 4 a 8 dígitos<br /><input name="pin" required pattern="[0-9]{4,8}" inputMode="numeric" type="password" autoComplete="new-password" /></label>
        <s-button type="submit" variant="primary" disabled={pending}>{pending ? "Guardando…" : "Guardar cajero"}</s-button>
      </s-stack></Form>
      {result?.ok ? <s-banner tone="success">{result.message}</s-banner> : null}
      {result && !result.ok ? <s-banner tone="critical">{result.error}</s-banner> : null}
    </s-section>
    <s-section heading="Personal de tienda"><s-stack direction="block" gap="base">
      {staff.length === 0 ? <s-paragraph>Aún no hay cajeros. El gerente principal se crea automáticamente al ingresar con su PIN maestro.</s-paragraph> : null}
      {staff.map((member) => <div key={member.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}><span>{member.name} · {member.role === "MANAGER" ? "Gerente" : "Cajero"} · {member.active ? "Activo" : "Desactivado"}</span><Form method="post"><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="staffId" value={member.id} /><input type="hidden" name="active" value={member.active ? "false" : "true"} /><s-button type="submit" disabled={pending || member.role === "MANAGER"}>{member.active ? "Desactivar" : "Activar"}</s-button></Form></div>)}
    </s-stack></s-section>
  </s-page>;
}

export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (args) => boundary.headers(args);
