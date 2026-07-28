import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "./db.server";
import {
  InventoryDomainError,
  normalizeOptionalText,
} from "./inventory.server";

type ProductVendorsResponse = {
  data?: {
    productVendors?: {
      nodes?: string[];
    };
  };
  errors?: Array<{ message?: string }>;
};

export type SupplierOption = {
  id: string;
  name: string;
  source: string;
};

const DEMO_SUPPLIER_NAMES = [
  "Cohens Dev Store",
  "Hydrogen Vendor",
  "Multi-managed Vendor",
  "Snowboard Vendor",
];

export function normalizeSupplierName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-MX");
}

async function shopifyProductVendors(admin: AdminApiContext) {
  const response = await admin.graphql(
    `#graphql
      query CohenInventoryProductVendors {
        productVendors(first: 1000) {
          nodes
        }
      }
    `,
  );
  const payload = (await response.json()) as ProductVendorsResponse;
  const apiErrors =
    payload.errors?.map((error) => error.message).filter(Boolean) ?? [];
  if (apiErrors.length) {
    throw new InventoryDomainError(
      "Shopify no pudo consultar el catálogo de proveedores.",
      {
        status: 502,
        code: "SHOPIFY_SUPPLIERS_FAILED",
        details: apiErrors,
      },
    );
  }

  return Array.from(
    new Set(
      (payload.data?.productVendors?.nodes ?? [])
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );
}

export async function listSuppliers(
  admin: AdminApiContext,
  shop: string,
): Promise<SupplierOption[]> {
  const demoNames = DEMO_SUPPLIER_NAMES.map(normalizeSupplierName);
  const vendors = (await shopifyProductVendors(admin)).filter(
    (name) => !demoNames.includes(normalizeSupplierName(name)),
  );

  await db.supplier.updateMany({
    where: {
      shop,
      normalizedName: { in: demoNames },
    },
    data: { active: false },
  });

  if (vendors.length) {
    await db.$transaction(
      vendors.map((name) =>
        db.supplier.upsert({
          where: {
            shop_normalizedName: {
              shop,
              normalizedName: normalizeSupplierName(name),
            },
          },
          create: {
            shop,
            name,
            normalizedName: normalizeSupplierName(name),
            source: "SHOPIFY_VENDOR",
          },
          update: {
            active: true,
          },
        }),
      ),
    );
  }

  return db.supplier.findMany({
    where: { shop, active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      source: true,
    },
  });
}

export async function resolveSupplier(
  shop: string,
  input: {
    supplierId?: unknown;
    newSupplier?: unknown;
    supplier?: unknown;
  },
) {
  const supplierId = normalizeOptionalText(input.supplierId, 128);
  const newSupplier = normalizeOptionalText(input.newSupplier, 160);
  const legacySupplier = normalizeOptionalText(input.supplier, 160);

  if (supplierId) {
    const supplier = await db.supplier.findFirst({
      where: { id: supplierId, shop, active: true },
    });
    if (!supplier) {
      throw new InventoryDomainError(
        "El proveedor seleccionado ya no está disponible.",
        {
          status: 409,
          code: "SUPPLIER_NOT_FOUND",
        },
      );
    }
    return supplier;
  }

  const name = newSupplier ?? legacySupplier;
  if (!name) {
    throw new InventoryDomainError("Selecciona o registra un proveedor.", {
      code: "SUPPLIER_REQUIRED",
    });
  }

  const normalizedName = normalizeSupplierName(name);
  return db.supplier.upsert({
    where: {
      shop_normalizedName: {
        shop,
        normalizedName,
      },
    },
    create: {
      shop,
      name,
      normalizedName,
      source: newSupplier ? "MANUAL" : "LEGACY",
    },
    update: {
      active: true,
    },
  });
}
