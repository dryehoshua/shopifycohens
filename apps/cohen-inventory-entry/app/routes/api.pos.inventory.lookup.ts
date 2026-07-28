import type { LoaderFunctionArgs } from "react-router";
import {
  domainErrorResponse,
  lookupVariantByBarcode,
  shopDomainFromDestination,
} from "../inventory.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { listSuppliers } from "../supplier.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.pos(request);

  try {
    const url = new URL(request.url);
    const barcode = url.searchParams.get("barcode");
    const locationId = url.searchParams.get("locationId");
    const shop = shopDomainFromDestination(sessionToken.dest);
    const { admin } = await unauthenticated.admin(shop);
    const [variant, suppliers] = await Promise.all([
      lookupVariantByBarcode(admin, barcode, locationId),
      listSuppliers(admin, shop),
    ]);

    return cors(
      Response.json({
        ok: true,
        variant,
        suppliers,
      }),
    );
  } catch (error) {
    return cors(domainErrorResponse(error));
  }
};
