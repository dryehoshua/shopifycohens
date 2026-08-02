import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

type VariantDefinition = {
  name: string;
  sku: string;
  price: string;
  cost?: string;
};

type MenuDefinition = {
  handle: string;
  title: string;
  descriptionHtml: string;
  status: "ACTIVE" | "DRAFT";
  optionName: string;
  tags: string[];
  variants: VariantDefinition[];
};

const MENU: MenuDefinition[] = [
  { handle: "cafe-turco", title: "Café turco", descriptionHtml: "<p>Café turco preparado al momento en Cohen's Cafe.</p>", status: "ACTIVE", optionName: "Temperatura", tags: ["cohens-cafe", "cafeteria", "pos-menu", "bebidas-calientes"], variants: [{ name: "Caliente", sku: "CAF-001-CAL", price: "60.00", cost: "0.85" }, { name: "Frío", sku: "CAF-001-FRI", price: "60.00", cost: "0.85" }] },
  { handle: "cafe-americano", title: "Café americano", descriptionHtml: "<p>Precio y costo pendientes de confirmación.</p>", status: "DRAFT", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "pendiente-precio"], variants: [{ name: "Default Title", sku: "CAF-002", price: "0.00" }] },
  { handle: "capuchino", title: "Capuchino", descriptionHtml: "<p>Precio y costo pendientes de confirmación.</p>", status: "DRAFT", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "pendiente-precio"], variants: [{ name: "Default Title", sku: "CAF-003", price: "0.00" }] },
  { handle: "frappe", title: "Frappé", descriptionHtml: "<p>Bebida fría tipo frappé preparada al momento.</p>", status: "ACTIVE", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "bebidas-frias"], variants: [{ name: "Default Title", sku: "CAF-004", price: "120.00", cost: "41.05" }] },
  { handle: "molletes", title: "Molletes", descriptionHtml: "<p>Molletes preparados al momento con aproximadamente 40 g de queso.</p>", status: "ACTIVE", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "alimentos-preparados"], variants: [{ name: "Default Title", sku: "CAF-005", price: "150.00", cost: "34.95" }] },
  { handle: "tamales-oaxaquenos", title: "Tamales oaxaqueños", descriptionHtml: "<p>Tamal oaxaqueño preparado para servicio en Cohen's Cafe.</p>", status: "ACTIVE", optionName: "Sabor", tags: ["cohens-cafe", "cafeteria", "pos-menu", "alimentos-preparados"], variants: [{ name: "Mole", sku: "CAF-006-MOL", price: "60.00", cost: "26.00" }, { name: "Verde", sku: "CAF-006-VER", price: "60.00", cost: "26.00" }] },
  { handle: "tamal-hoja-maiz", title: "Tamal de hoja de maíz", descriptionHtml: "<p>Precio y costo pendientes de confirmación.</p>", status: "DRAFT", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "pendiente-precio"], variants: [{ name: "Default Title", sku: "CAF-007", price: "0.00" }] },
  { handle: "jocoque-aceituna-roscas", title: "Jocoque con aceituna y roscas", descriptionHtml: "<p>Porción de jocoque con aceituna y roscas.</p>", status: "ACTIVE", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "alimentos-preparados"], variants: [{ name: "Default Title", sku: "CAF-008", price: "100.00", cost: "43.88" }] },
  { handle: "pan-dulce", title: "Pan dulce", descriptionHtml: "<p>Pan dulce para servicio en Cohen's Cafe.</p>", status: "ACTIVE", optionName: "Presentación", tags: ["cohens-cafe", "cafeteria", "pos-menu", "panaderia"], variants: [{ name: "Opción A", sku: "CAF-009-A", price: "50.00", cost: "25.60" }, { name: "Variedad por identificar", sku: "CAF-009-B", price: "55.00", cost: "36.75" }] },
  { handle: "bagel-salmon", title: "Bagel con salmón", descriptionHtml: "<p>Bagel con salmón preparado al momento.</p>", status: "ACTIVE", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "alimentos-preparados"], variants: [{ name: "Default Title", sku: "CAF-010", price: "240.00", cost: "87.85" }] },
  { handle: "rebanada-pastel", title: "Rebanada de pastel Bakery", descriptionHtml: "<p>Rebanada de pastel para servicio en Cohen's Cafe.</p>", status: "ACTIVE", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "reposteria"], variants: [{ name: "Default Title", sku: "CAF-011", price: "120.00", cost: "47.00" }] },
  { handle: "sincronizada", title: "Sincronizada", descriptionHtml: "<p>Sincronizada preparada al momento.</p>", status: "ACTIVE", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "alimentos-preparados"], variants: [{ name: "Default Title", sku: "CAF-012", price: "55.00", cost: "20.85" }] },
  { handle: "quesadilla", title: "Quesadilla", descriptionHtml: "<p>Precio y costo pendientes de confirmación.</p>", status: "DRAFT", optionName: "Title", tags: ["cohens-cafe", "cafeteria", "pos-menu", "pendiente-precio"], variants: [{ name: "Default Title", sku: "CAF-013", price: "0.00" }] },
];

const CAFE_LOCATION_NAME = "Cohen's Cafe";

type GraphqlAdmin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

async function graphql<T>(admin: GraphqlAdmin, query: string, variables: Record<string, unknown> = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join("; "));
  if (!payload.data) throw new Error("Shopify no devolvió datos.");
  return payload.data;
}

async function existingByHandle(admin: GraphqlAdmin, handle: string) {
  const data = await graphql<{ productByHandle: { id: string; title: string; status: string; media: { nodes: Array<{ id: string }> } } | null }>(admin, `#graphql
    query CafeProduct($handle: String!) { productByHandle(handle: $handle) { id title status media(first: 1) { nodes { id } } } }
  `, { handle });
  return data.productByHandle;
}

async function uploadMenuImages(admin: GraphqlAdmin, appOrigin: string) {
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  for (const item of MENU) {
    const product = await existingByHandle(admin, item.handle);
    if (!product) {
      missing.push(item.title);
      continue;
    }
    if (product.media.nodes.length > 0) {
      skipped.push(item.title);
      continue;
    }
    const originalSource = new URL(`/cafe-images/${item.handle}.png`, appOrigin).toString();
    const result = await graphql<{ productUpdate: { product: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> } }>(admin, `#graphql
      mutation AddCafeProductImage($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
        productUpdate(product: $product, media: $media) {
          product { id }
          userErrors { field message }
        }
      }
    `, {
      product: { id: product.id },
      media: [{ mediaContentType: "IMAGE", originalSource, alt: `${item.title} de Cohen's Cafe` }],
    });
    if (result.productUpdate.userErrors.length || !result.productUpdate.product) {
      throw new Error(result.productUpdate.userErrors.map((error) => error.message).join("; ") || `No se pudo cargar la imagen de ${item.title}.`);
    }
    uploaded.push(item.title);
  }
  return { uploaded, skipped, missing };
}

async function createMenuProduct(admin: GraphqlAdmin, definition: MenuDefinition) {
  const input = {
    title: definition.title,
    handle: definition.handle,
    descriptionHtml: definition.descriptionHtml,
    vendor: "Cohen's Cafe",
    productType: "Cafetería",
    tags: definition.tags,
    status: definition.status,
    productOptions: [{ name: definition.optionName, position: 1, values: definition.variants.map((variant) => ({ name: variant.name })) }],
    variants: definition.variants.map((variant) => ({
      optionValues: [{ optionName: definition.optionName, name: variant.name }],
      sku: variant.sku,
      price: variant.price,
      taxable: true,
      inventoryItem: { tracked: false, ...(variant.cost ? { cost: variant.cost } : {}) },
    })),
  };
  const created = await graphql<{ productSet: { product: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> } }>(admin, `#graphql
    mutation CreateCafeProduct($input: ProductSetInput!) {
      productSet(synchronous: true, input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `, { input });
  if (created.productSet.userErrors.length || !created.productSet.product) {
    throw new Error(created.productSet.userErrors.map((error) => error.message).join("; ") || `No se pudo crear ${definition.title}.`);
  }
  return created.productSet.product.id;
}

async function ensureCollection(admin: GraphqlAdmin) {
  const existing = await graphql<{ collectionByHandle: { id: string } | null }>(admin, `#graphql
    query CafeCollection { collectionByHandle(handle: "cohens-cafe") { id } }
  `);
  if (existing.collectionByHandle) return { id: existing.collectionByHandle.id, created: false };
  const result = await graphql<{ collectionCreate: { collection: { id: string } | null; userErrors: Array<{ message: string }> } }>(admin, `#graphql
    mutation CreateCafeCollection($input: CollectionInput!) {
      collectionCreate(input: $input) { collection { id } userErrors { message } }
    }
  `, { input: { title: "Cohen's Cafe", handle: "cohens-cafe", descriptionHtml: "<p>Menú operativo de Cohen's Cafe para Shopify POS.</p>", ruleSet: { appliedDisjunctively: false, rules: [{ column: "TYPE", relation: "EQUALS", condition: "Cafetería" }] } } });
  if (result.collectionCreate.userErrors.length || !result.collectionCreate.collection) {
    throw new Error(result.collectionCreate.userErrors.map((error) => error.message).join("; ") || "No se pudo crear la colección.");
  }
  return { id: result.collectionCreate.collection.id, created: true };
}

async function pointOfSalePublication(admin: GraphqlAdmin) {
  const data = await graphql<{ publications: { nodes: Array<{ id: string; name: string; catalog: { title: string } | null }> } }>(admin, `#graphql
    query CafePublications {
      publications(first: 50) { nodes { id name catalog { title } } }
    }
  `);
  const publication = data.publications.nodes.find((item) =>
    /point of sale|shopify pos|punto de venta/i.test(`${item.name} ${item.catalog?.title ?? ""}`),
  );
  if (!publication) throw new Error("No se encontró la publicación de Point of Sale.");
  return publication;
}

async function publishToPointOfSale(admin: GraphqlAdmin, id: string, publicationId: string) {
  const result = await graphql<{ publishablePublish: { userErrors: Array<{ message: string }> } }>(admin, `#graphql
    mutation PublishCafeResource($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { message } }
    }
  `, { id, input: [{ publicationId }] });
  if (result.publishablePublish.userErrors.length) {
    throw new Error(result.publishablePublish.userErrors.map((error) => error.message).join("; "));
  }
}

async function cafeLocation(admin: GraphqlAdmin) {
  const data = await graphql<{ locations: { nodes: Array<{ id: string; name: string }> } }>(admin, `#graphql
    query CafeLocations { locations(first: 50) { nodes { id name } } }
  `);
  const location = data.locations.nodes.find((item) => item.name === CAFE_LOCATION_NAME);
  if (!location) throw new Error(`No se encontró la ubicación ${CAFE_LOCATION_NAME}.`);
  return location;
}

async function cafeInventoryItemIds(admin: GraphqlAdmin) {
  const data = await graphql<{ products: { nodes: Array<{ variants: { nodes: Array<{ inventoryItem: { id: string } }> } }> } }>(admin, `#graphql
    query CafeInventoryItems {
      products(first: 100, query: "tag:cohens-cafe") {
        nodes { variants(first: 100) { nodes { inventoryItem { id } } } }
      }
    }
  `);
  return new Set(data.products.nodes.flatMap((product) => product.variants.nodes.map((variant) => variant.inventoryItem.id)));
}

type LocationInventoryLevel = {
  item: { id: string };
  canDeactivate: boolean;
  quantities: Array<{ name: string; quantity: number }>;
};

async function activeInventoryAtLocation(admin: GraphqlAdmin, locationId: string) {
  const levels: LocationInventoryLevel[] = [];
  let cursor: string | null = null;
  do {
    const data: {
      location: {
        inventoryLevels: {
          nodes: LocationInventoryLevel[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    } = await graphql(admin, `#graphql
      query CafeLocationInventory($locationId: ID!, $after: String) {
        location(id: $locationId) {
          inventoryLevels(first: 100, after: $after) {
            nodes {
              item { id }
              canDeactivate
              quantities(names: ["available", "committed", "incoming", "on_hand"]) { name quantity }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `, { locationId, after: cursor });
    if (!data.location) throw new Error(`No se pudo consultar la ubicación ${CAFE_LOCATION_NAME}.`);
    levels.push(...data.location.inventoryLevels.nodes);
    cursor = data.location.inventoryLevels.pageInfo.hasNextPage ? data.location.inventoryLevels.pageInfo.endCursor : null;
  } while (cursor);
  return levels;
}

async function toggleInventoryItems(admin: GraphqlAdmin, itemIds: string[], locationId: string, activate: boolean) {
  const errors: string[] = [];
  for (let offset = 0; offset < itemIds.length; offset += 10) {
    const batch = itemIds.slice(offset, offset + 10);
    const declarations = batch.map((_, index) => `$item${index}: ID!`).join(", ");
    const fields = batch.map((_, index) => `
      item${index}: inventoryBulkToggleActivation(
        inventoryItemId: $item${index}
        inventoryItemUpdates: [{ locationId: $locationId, activate: $activate }]
      ) { userErrors { message } }
    `).join("\n");
    const variables: Record<string, unknown> = { locationId, activate };
    batch.forEach((id, index) => { variables[`item${index}`] = id; });
    const result = await graphql<Record<string, { userErrors: Array<{ message: string }> }>>(admin, `#graphql
      mutation RestrictCafeInventory($locationId: ID!, $activate: Boolean!, ${declarations}) {
        ${fields}
      }
    `, variables);
    Object.values(result).forEach((payload) => payload.userErrors.forEach((error) => errors.push(error.message)));
  }
  if (errors.length) throw new Error(errors.join("; "));
}

async function restrictCafeInventory(admin: GraphqlAdmin) {
  const location = await cafeLocation(admin);
  const cafeItems = await cafeInventoryItemIds(admin);
  const activeLevels = await activeInventoryAtLocation(admin, location.id);
  const activeIds = new Set(activeLevels.map((level) => level.item.id));
  const toActivate = [...cafeItems].filter((id) => !activeIds.has(id));
  const blocked: string[] = [];
  const toDeactivate = activeLevels.filter((level) => {
    if (cafeItems.has(level.item.id)) return false;
    const hasQuantity = level.quantities.some((quantity) => quantity.quantity !== 0);
    if (!level.canDeactivate || hasQuantity) {
      blocked.push(level.item.id);
      return false;
    }
    return true;
  }).map((level) => level.item.id);
  await toggleInventoryItems(admin, toActivate, location.id, true);
  await toggleInventoryItems(admin, toDeactivate, location.id, false);
  return { locationName: location.name, cafeItemCount: cafeItems.size, activatedCount: toActivate.length, deactivatedCount: toDeactivate.length, blockedCount: blocked.length };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const states = await Promise.all(MENU.map(async (item) => ({ ...item, existing: await existingByHandle(admin, item.handle) })));
  return { items: states, activeCount: MENU.filter((item) => item.status === "ACTIVE").length, draftCount: MENU.filter((item) => item.status === "DRAFT").length };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "images") {
    try {
      const appOrigin = process.env.SHOPIFY_APP_URL?.trim() || new URL(request.url).origin;
      return { ok: true as const, kind: "images" as const, ...(await uploadMenuImages(admin, appOrigin)) };
    } catch (error) {
      return { ok: false as const, kind: "images" as const, error: error instanceof Error ? error.message : "Error desconocido." };
    }
  }
  if (intent === "restrict") {
    try {
      return { ok: true as const, kind: "restrict" as const, ...(await restrictCafeInventory(admin)) };
    } catch (error) {
      return { ok: false as const, kind: "restrict" as const, error: error instanceof Error ? error.message : "Error desconocido." };
    }
  }
  if (intent !== "setup") return { ok: false, error: "Acción no válida." };
  const created: string[] = [];
  const skipped: string[] = [];
  try {
    const activeProductIds: string[] = [];
    for (const item of MENU) {
      const existing = await existingByHandle(admin, item.handle);
      if (existing) {
        skipped.push(item.title);
        if (item.status === "ACTIVE") activeProductIds.push(existing.id);
        continue;
      }
      const id = await createMenuProduct(admin, item);
      created.push(item.title);
      if (item.status === "ACTIVE") activeProductIds.push(id);
    }
    const collection = await ensureCollection(admin);
    const publication = await pointOfSalePublication(admin);
    for (const id of [...activeProductIds, collection.id]) {
      await publishToPointOfSale(admin, id, publication.id);
    }
    return { ok: true as const, kind: "setup" as const, created, skipped, collectionCreated: collection.created, publishedCount: activeProductIds.length, publicationName: publication.name };
  } catch (error) {
    return { ok: false as const, kind: "setup" as const, created, skipped, error: error instanceof Error ? error.message : "Error desconocido." };
  }
};

export default function CafeSetup() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  return (
    <s-page heading="Cohen's Cafe">
      <s-section heading="Configuración del menú POS">
        <s-stack direction="block" gap="base">
          <s-banner tone="info" heading="Una unidad de negocio dentro de la tienda principal">
            Los productos usan proveedor Cohen's Cafe, tipo Cafetería, SKUs CAF y una colección automática. Los artículos sin precio confirmado permanecen en borrador.
          </s-banner>
          <s-paragraph>{data.activeCount} productos activos y {data.draftCount} borradores protegidos.</s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="setup" />
            <s-button type="submit" variant="primary" disabled={pending}>{pending ? "Configurando…" : "Crear o completar menú"}</s-button>
          </Form>
          {result?.ok && result.kind === "setup" ? <s-banner tone="success" heading="Menú preparado">Creados: {result.created?.length ?? 0}. Existentes conservados: {result.skipped?.length ?? 0}. Colección: {result.collectionCreated ? "creada" : "ya existía"}. Publicados en {result.publicationName}: {result.publishedCount ?? 0}.</s-banner> : null}
          {result && !result.ok && result.kind === "setup" ? <s-banner tone="critical" heading="La configuración quedó incompleta">{result.error} Creados antes del error: {result.created?.length ?? 0}.</s-banner> : null}
        </s-stack>
      </s-section>
      <s-section heading="Catálogo exclusivo de la tablet">
        <s-stack direction="block" gap="base">
          <s-paragraph>Activa en la ubicación Cohen's Cafe únicamente los artículos enviados para cafetería. Plaza Victoria no se modifica.</s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="restrict" />
            <s-button type="submit" variant="primary" disabled={pending}>{pending ? "Aplicando…" : "Restringir a productos de cafetería"}</s-button>
          </Form>
          {result?.ok && result.kind === "restrict" ? <s-banner tone="success" heading="Catálogo restringido">Ubicación: {result.locationName}. Artículos de cafetería permitidos: {result.cafeItemCount}. Activados: {result.activatedCount}. Productos ajenos retirados: {result.deactivatedCount}. Pendientes por inventario comprometido: {result.blockedCount}.</s-banner> : null}
          {result && !result.ok && result.kind === "restrict" ? <s-banner tone="critical" heading="No se pudo restringir el catálogo">{result.error}</s-banner> : null}
        </s-stack>
      </s-section>
      <s-section heading="Imágenes del menú">
        <s-stack direction="block" gap="base">
          <s-paragraph>Carga las fotografías generadas para los 13 productos. Los productos que ya tengan imagen se conservan sin duplicados.</s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="images" />
            <s-button type="submit" variant="primary" disabled={pending}>{pending ? "Cargando…" : "Cargar imágenes generadas"}</s-button>
          </Form>
          {result?.ok && result.kind === "images" ? <s-banner tone="success" heading="Imágenes procesadas">Cargadas: {result.uploaded.length}. Ya tenían imagen: {result.skipped.length}. Productos aún no creados: {result.missing.length}.</s-banner> : null}
          {result && !result.ok && result.kind === "images" ? <s-banner tone="critical" heading="La carga quedó incompleta">{result.error}</s-banner> : null}
        </s-stack>
      </s-section>
      <s-section heading="Productos">
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={{ textAlign: "left", padding: 8 }}>Producto</th><th style={{ textAlign: "left", padding: 8 }}>Estado</th><th style={{ textAlign: "left", padding: 8 }}>Shopify</th><th style={{ textAlign: "left", padding: 8 }}>Imagen</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.handle}><td style={{ padding: 8, borderTop: "1px solid #ddd" }}>{item.title}</td><td style={{ padding: 8, borderTop: "1px solid #ddd" }}>{item.status === "ACTIVE" ? "Activo" : "Borrador: falta precio"}</td><td style={{ padding: 8, borderTop: "1px solid #ddd" }}>{item.existing ? "Existe" : "Pendiente"}</td><td style={{ padding: 8, borderTop: "1px solid #ddd" }}>{item.existing?.media.nodes.length ? "Cargada" : "Pendiente"}</td></tr>)}</tbody></table></div>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
