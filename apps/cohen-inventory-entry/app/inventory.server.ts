import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export type InventoryLookup = {
  barcode: string;
  sku: string | null;
  productId: string;
  productTitle: string;
  vendor: string | null;
  variantId: string;
  variantTitle: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  price: string;
  cost: string | null;
  currencyCode: string | null;
  inventoryItemId: string;
  tracked: boolean;
  locationId: string;
  available: number;
};

type GraphqlError = {
  message?: string;
};

type ProductVariantsResponse = {
  data?: {
    productVariants?: {
      nodes?: Array<{
        id: string;
        title?: string | null;
        barcode?: string | null;
        sku?: string | null;
        price: string;
        product?: {
          id: string;
          title: string;
          vendor?: string | null;
          featuredMedia?: {
            preview?: {
              image?: {
                url: string;
                altText?: string | null;
              } | null;
            } | null;
          } | null;
        } | null;
        inventoryItem?: {
          id: string;
          tracked: boolean;
          unitCost?: {
            amount: string;
            currencyCode: string;
          } | null;
          inventoryLevel?: {
            quantities?: Array<{
              name: string;
              quantity: number;
            }>;
          } | null;
        } | null;
      }>;
    };
  };
  errors?: GraphqlError[];
};

type InventoryItemResponse = {
  data?: {
    inventoryItem?: {
      inventoryLevel?: {
        quantities?: Array<{
          name: string;
          quantity: number;
        }>;
      } | null;
    } | null;
  };
  errors?: GraphqlError[];
};

type AdjustmentResponse = {
  data?: {
    inventoryAdjustQuantities?: {
      userErrors?: Array<{
        field?: string[] | null;
        message: string;
        code?: string | null;
      }>;
      inventoryAdjustmentGroup?: {
        id?: string | null;
        createdAt: string;
        reason: string;
        referenceDocumentUri?: string | null;
        changes: Array<{
          name: string;
          delta: number;
          quantityAfterChange?: number | null;
          item?: { id: string } | null;
          location?: { id: string } | null;
        }>;
      } | null;
    };
  };
  errors?: GraphqlError[];
};

export type AdjustmentResult = {
  group: NonNullable<
    NonNullable<
      NonNullable<AdjustmentResponse["data"]>["inventoryAdjustQuantities"]
    >["inventoryAdjustmentGroup"]
  >;
  raw: AdjustmentResponse;
};

export class InventoryDomainError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(
    message: string,
    options: { status?: number; code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "InventoryDomainError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "INVENTORY_ERROR";
    this.details = options.details;
  }
}

export function normalizeBarcode(value: unknown) {
  if (typeof value !== "string") {
    throw new InventoryDomainError("El código de barras es obligatorio.", {
      code: "BARCODE_REQUIRED",
    });
  }

  const barcode = value.trim();
  if (!barcode || barcode.length > 128) {
    throw new InventoryDomainError(
      "El código de barras debe contener entre 1 y 128 caracteres.",
      { code: "BARCODE_INVALID" },
    );
  }

  return barcode;
}

export function normalizePositiveInteger(value: unknown, maximum = 100_000) {
  const quantity =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
    throw new InventoryDomainError(
      `La cantidad debe ser un entero entre 1 y ${maximum.toLocaleString("es-MX")}.`,
      { code: "QUANTITY_INVALID" },
    );
  }

  return quantity;
}

export function normalizeIdempotencyKey(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(value)
  ) {
    throw new InventoryDomainError(
      "La operación no tiene una clave de seguridad válida.",
      { code: "IDEMPOTENCY_KEY_INVALID" },
    );
  }

  return value;
}

export function normalizeOptionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new InventoryDomainError("El texto recibido no es válido.", {
      code: "TEXT_INVALID",
    });
  }

  const text = value.trim();
  if (!text) return null;
  if (text.length > maximum) {
    throw new InventoryDomainError(
      `El texto no puede superar ${maximum} caracteres.`,
      { code: "TEXT_TOO_LONG" },
    );
  }
  return text;
}

export function toLocationGid(value: unknown) {
  const raw =
    typeof value === "number" || typeof value === "bigint"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";

  if (/^\d+$/.test(raw)) return `gid://shopify/Location/${raw}`;
  if (/^gid:\/\/shopify\/Location\/\d+$/.test(raw)) return raw;

  throw new InventoryDomainError("La sucursal del POS no es válida.", {
    code: "LOCATION_INVALID",
  });
}

export function shopDomainFromDestination(destination: unknown) {
  if (typeof destination !== "string") {
    throw new InventoryDomainError("No se pudo identificar la tienda.", {
      status: 401,
      code: "SHOP_INVALID",
    });
  }

  try {
    return new URL(destination).hostname;
  } catch {
    throw new InventoryDomainError("No se pudo identificar la tienda.", {
      status: 401,
      code: "SHOP_INVALID",
    });
  }
}

function graphqlErrors(errors: GraphqlError[] | undefined) {
  return errors?.map((error) => error.message).filter(Boolean) ?? [];
}

function availableQuantity(
  quantities: Array<{ name: string; quantity: number }> | undefined,
) {
  return quantities?.find((quantity) => quantity.name === "available")
    ?.quantity;
}

export async function lookupVariantByBarcode(
  admin: AdminApiContext,
  barcodeInput: unknown,
  locationInput: unknown,
): Promise<InventoryLookup> {
  const barcode = normalizeBarcode(barcodeInput);
  const locationId = toLocationGid(locationInput);
  const escapedBarcode = barcode
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');

  const response = await admin.graphql(
    `#graphql
      query CohenInventoryVariantLookup($query: String!, $locationId: ID!) {
        productVariants(first: 5, query: $query) {
          nodes {
            id
            title
            barcode
            sku
            price
            product {
              id
              title
              vendor
              featuredMedia {
                preview {
                  image {
                    url
                    altText
                  }
                }
              }
            }
            inventoryItem {
              id
              tracked
              unitCost {
                amount
                currencyCode
              }
              inventoryLevel(locationId: $locationId) {
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        query: `barcode:"${escapedBarcode}"`,
        locationId,
      },
    },
  );
  const payload = (await response.json()) as ProductVariantsResponse;
  const apiErrors = graphqlErrors(payload.errors);

  if (apiErrors.length) {
    throw new InventoryDomainError("Shopify no pudo consultar el producto.", {
      status: 502,
      code: "SHOPIFY_LOOKUP_FAILED",
      details: apiErrors,
    });
  }

  const exactMatches = (payload.data?.productVariants?.nodes ?? []).filter(
    (variant) => variant.barcode?.trim() === barcode,
  );

  if (exactMatches.length === 0) {
    throw new InventoryDomainError(
      `No existe una variante con el código ${barcode}.`,
      { status: 404, code: "BARCODE_NOT_FOUND" },
    );
  }

  if (exactMatches.length > 1) {
    throw new InventoryDomainError(
      `El código ${barcode} está asignado a más de una variante. Corrígelo antes de recibir mercancía.`,
      { status: 409, code: "DUPLICATE_BARCODE" },
    );
  }

  const variant = exactMatches[0];
  if (!variant.product || !variant.inventoryItem) {
    throw new InventoryDomainError(
      "La variante no tiene un artículo de inventario utilizable.",
      { status: 409, code: "INVENTORY_ITEM_MISSING" },
    );
  }
  if (!variant.inventoryItem.tracked) {
    throw new InventoryDomainError(
      "Shopify no está siguiendo el inventario de esta variante.",
      { status: 409, code: "INVENTORY_NOT_TRACKED" },
    );
  }
  if (!variant.inventoryItem.inventoryLevel) {
    throw new InventoryDomainError(
      "La variante no está disponible en la sucursal activa del POS.",
      { status: 409, code: "INVENTORY_LEVEL_MISSING" },
    );
  }

  const available = availableQuantity(
    variant.inventoryItem.inventoryLevel.quantities,
  );
  if (available === undefined) {
    throw new InventoryDomainError(
      "Shopify no devolvió la existencia disponible.",
      { status: 502, code: "AVAILABLE_QUANTITY_MISSING" },
    );
  }

  return {
    barcode,
    sku: variant.sku?.trim() || null,
    productId: variant.product.id,
    productTitle: variant.product.title,
    vendor: variant.product.vendor?.trim() || null,
    variantId: variant.id,
    variantTitle: variant.title?.trim() || null,
    imageUrl: variant.product.featuredMedia?.preview?.image?.url ?? null,
    imageAlt:
      variant.product.featuredMedia?.preview?.image?.altText?.trim() ||
      variant.product.title,
    price: variant.price,
    cost: variant.inventoryItem.unitCost?.amount ?? null,
    currencyCode: variant.inventoryItem.unitCost?.currencyCode ?? null,
    inventoryItemId: variant.inventoryItem.id,
    tracked: variant.inventoryItem.tracked,
    locationId,
    available,
  };
}

export async function getAvailableQuantity(
  admin: AdminApiContext,
  inventoryItemId: string,
  locationInput: unknown,
) {
  const locationId = toLocationGid(locationInput);
  const response = await admin.graphql(
    `#graphql
      query CohenInventoryAvailableQuantity(
        $inventoryItemId: ID!
        $locationId: ID!
      ) {
        inventoryItem(id: $inventoryItemId) {
          inventoryLevel(locationId: $locationId) {
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }`,
    { variables: { inventoryItemId, locationId } },
  );
  const payload = (await response.json()) as InventoryItemResponse;
  const apiErrors = graphqlErrors(payload.errors);
  if (apiErrors.length) {
    throw new InventoryDomainError(
      "Shopify no pudo consultar la existencia actual.",
      {
        status: 502,
        code: "SHOPIFY_QUANTITY_LOOKUP_FAILED",
        details: apiErrors,
      },
    );
  }

  const available = availableQuantity(
    payload.data?.inventoryItem?.inventoryLevel?.quantities,
  );
  if (available === undefined) {
    throw new InventoryDomainError(
      "El artículo ya no tiene inventario disponible en esta sucursal.",
      { status: 409, code: "INVENTORY_LEVEL_MISSING" },
    );
  }
  return available;
}

export async function adjustAvailableQuantity(
  admin: AdminApiContext,
  input: {
    inventoryItemId: string;
    locationId: string;
    delta: number;
    changeFromQuantity: number;
    reason: "received" | "correction";
    referenceDocumentUri: string;
    idempotencyKey: string;
  },
): Promise<AdjustmentResult> {
  const response = await admin.graphql(
    `#graphql
      mutation CohenInventoryAdjustQuantities(
        $input: InventoryAdjustQuantitiesInput!
        $idempotencyKey: String!
      ) {
        inventoryAdjustQuantities(input: $input)
          @idempotent(key: $idempotencyKey) {
          userErrors {
            field
            message
            code
          }
          inventoryAdjustmentGroup {
            id
            createdAt
            reason
            referenceDocumentUri
            changes {
              name
              delta
              quantityAfterChange
              item { id }
              location { id }
            }
          }
        }
      }`,
    {
      variables: {
        input: {
          reason: input.reason,
          name: "available",
          referenceDocumentUri: input.referenceDocumentUri,
          changes: [
            {
              delta: input.delta,
              inventoryItemId: input.inventoryItemId,
              locationId: input.locationId,
              changeFromQuantity: input.changeFromQuantity,
            },
          ],
        },
        idempotencyKey: input.idempotencyKey,
      },
    },
  );
  const payload = (await response.json()) as AdjustmentResponse;
  const apiErrors = graphqlErrors(payload.errors);
  if (apiErrors.length) {
    throw new InventoryDomainError("Shopify rechazó el ajuste de inventario.", {
      status: 502,
      code: "SHOPIFY_ADJUSTMENT_FAILED",
      details: apiErrors,
    });
  }

  const mutation = payload.data?.inventoryAdjustQuantities;
  const userErrors = mutation?.userErrors ?? [];
  if (userErrors.length) {
    throw new InventoryDomainError(
      userErrors.map((error) => error.message).join(" "),
      {
        status: 409,
        code: "SHOPIFY_ADJUSTMENT_REJECTED",
        details: userErrors,
      },
    );
  }
  if (!mutation?.inventoryAdjustmentGroup) {
    throw new InventoryDomainError(
      "Shopify no devolvió confirmación del ajuste.",
      {
        status: 502,
        code: "SHOPIFY_CONFIRMATION_MISSING",
      },
    );
  }

  return {
    group: mutation.inventoryAdjustmentGroup,
    raw: payload,
  };
}

export function domainErrorResponse(error: unknown) {
  if (error instanceof InventoryDomainError) {
    return Response.json(
      {
        ok: false,
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: error.status },
    );
  }

  console.error("Unexpected inventory error", error);
  return Response.json(
    {
      ok: false,
      error: "Ocurrió un error inesperado al procesar el inventario.",
      code: "UNEXPECTED_ERROR",
    },
    { status: 500 },
  );
}
