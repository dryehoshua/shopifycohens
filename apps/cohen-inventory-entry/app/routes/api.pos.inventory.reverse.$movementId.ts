import type { ActionFunctionArgs } from "react-router";
import {
  identityValue,
  reverseInventory,
  type ReverseInventoryInput,
} from "../inventory-operations.server";
import {
  domainErrorResponse,
  InventoryDomainError,
  shopDomainFromDestination,
} from "../inventory.server";
import { authenticate, unauthenticated } from "../shopify.server";

type ReverseBody = ReverseInventoryInput & {
  staffMemberId?: unknown;
  deviceId?: unknown;
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.pos(request);

  try {
    if (request.method !== "POST") {
      throw new InventoryDomainError("Método no permitido.", {
        status: 405,
        code: "METHOD_NOT_ALLOWED",
      });
    }

    const body = (await request.json()) as ReverseBody;
    const shop = shopDomainFromDestination(sessionToken.dest);
    const { admin } = await unauthenticated.admin(shop);
    const result = await reverseInventory(
      admin,
      shop,
      params.movementId ?? "",
      body,
      {
        userId: identityValue(sessionToken.sub),
        staffMemberId: body.staffMemberId,
        deviceId: body.deviceId,
      },
    );

    return cors(
      Response.json(
        { ok: true, movement: result.movement },
        { status: result.created ? 201 : 200 },
      ),
    );
  } catch (error) {
    return cors(domainErrorResponse(error));
  }
};
