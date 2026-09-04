import { createHmac, timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { claimPendingNekudotOrders } from "../nekudot.server";
import { memberCardData } from "../nekudot-registration.server";
import { unauthenticated } from "../shopify.server";

type SessionClaims = {
  aud?: string | string[];
  dest?: string;
  exp?: number;
  nbf?: number;
  sub?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

function decodePart(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Response("Token no válido.", { status: 401, headers: corsHeaders });
  }
}

function verifiedCustomerAccountSession(request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  const apiKey = process.env.SHOPIFY_API_KEY?.trim();
  if (!token || !secret || !apiKey) throw new Response("No autorizado.", { status: 401, headers: corsHeaders });
  const parts = token.split(".");
  if (parts.length !== 3) throw new Response("Token no válido.", { status: 401, headers: corsHeaders });
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodePart(encodedHeader);
  const claims = decodePart(encodedPayload) as SessionClaims;
  if (header.alg !== "HS256") throw new Response("Firma no válida.", { status: 401, headers: corsHeaders });
  const expected = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  const received = Buffer.from(encodedSignature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Response("Firma no válida.", { status: 401, headers: corsHeaders });
  }
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(apiKey) || !claims.exp || claims.exp <= now || (claims.nbf && claims.nbf > now + 5)) {
    throw new Response("La sesión venció.", { status: 401, headers: corsHeaders });
  }
  const shop = String(claims.dest || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Response("Tienda no válida.", { status: 401, headers: corsHeaders });
  }
  const customerId = String(claims.sub || "");
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)) {
    throw new Response("Inicia sesión para ver tus Nekudot.", { status: 401, headers: corsHeaders });
  }
  return { shop, customerId };
}

async function customerContact(shop: string, customerId: string) {
  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(`#graphql
    query NekudotAccountCustomer($id: ID!) {
      customer(id: $id) {
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
      }
    }
  `, { variables: { id: customerId } });
  const payload = await response.json() as { data?: { customer?: { defaultEmailAddress?: { emailAddress?: string }; defaultPhoneNumber?: { phoneNumber?: string } } } };
  return {
    email: payload.data?.customer?.defaultEmailAddress?.emailAddress ?? null,
    phone: payload.data?.customer?.defaultPhoneNumber?.phoneNumber ?? null,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const { shop, customerId } = verifiedCustomerAccountSession(request);
  const identity = await db.nekudotCustomerIdentity.findUnique({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customerId } },
    include: {
      member: {
        include: {
          broker: true,
          ownedBroker: true,
          credentials: { where: { active: true }, orderBy: { createdAt: "asc" } },
          ledger: { where: { walletType: "CLIENT" }, orderBy: { occurredAt: "desc" }, take: 12 },
          accruals: { orderBy: { processedAt: "desc" }, take: 12 },
        },
      },
    },
  });
  const storefrontUrl = (process.env.SHOP_STOREFRONT_URL || "https://cohenskosher.com").replace(/\/$/, "");
  if (!identity?.member.active) {
    return Response.json({
      registered: false,
      registrationUrl: `${storefrontUrl}/apps/nekudot`,
      message: "Activa tu tarjeta Nekudot para recibir cashback en tus compras.",
    }, { headers: corsHeaders });
  }
  const contact = await customerContact(shop, customerId);
  await claimPendingNekudotOrders({ memberId: identity.member.id, ...contact });
  const refreshed = await db.nekudotMember.findUniqueOrThrow({
    where: { id: identity.member.id },
    include: {
      broker: true,
      ownedBroker: true,
      credentials: { where: { active: true }, orderBy: { createdAt: "asc" } },
      ledger: { where: { walletType: "CLIENT" }, orderBy: { occurredAt: "desc" }, take: 12 },
      accruals: { orderBy: { processedAt: "desc" }, take: 12 },
    },
  });
  const digitalCard = await memberCardData(refreshed.id);
  return Response.json({
    registered: true,
    member: {
      id: refreshed.id,
      displayName: refreshed.displayName,
      cardTier: refreshed.cardTier,
      enrollmentStatus: refreshed.enrollmentStatus,
      balanceCents: refreshed.balanceCents,
      reservedCents: refreshed.reservedCents,
      availableCents: refreshed.balanceCents - refreshed.reservedCents,
      lifetimeEarnedCents: refreshed.lifetimeEarnedCents,
      lifetimeRedeemedCents: refreshed.lifetimeRedeemedCents,
      broker: refreshed.broker ? { displayName: refreshed.broker.displayName, code: refreshed.broker.code } : null,
      credentials: refreshed.credentials.map((credential) => ({ kind: credential.kind, label: credential.label, lastFour: credential.lastFour })),
      cardNumber: digitalCard.cardNumber,
      qrDataUrl: digitalCard.qrDataUrl,
      barcodeDataUrl: digitalCard.barcodeDataUrl,
    },
    ibWallet: refreshed.ownedBroker ? {
      availableCents: refreshed.ownedBroker.commissionBalanceCents,
      lifetimeCommissionCents: refreshed.ownedBroker.lifetimeCommissionCents,
      paidOutCents: refreshed.ownedBroker.paidOutCents,
      code: refreshed.ownedBroker.code,
    } : null,
    accruals: refreshed.accruals.map((item) => ({
      orderId: item.shopifyOrderId,
      orderName: item.orderName,
      purchaseCents: item.purchaseCents,
      clientEarnedCents: item.clientEarnedCents,
      brokerEarnedCents: item.brokerEarnedCents,
      processedAt: item.processedAt,
    })),
    ledger: refreshed.ledger.map((item) => ({ id: item.id, type: item.type, amountCents: item.amountCents, description: item.description, occurredAt: item.occurredAt })),
    portalUrl: `${storefrontUrl}/apps/nekudot`,
  }, { headers: corsHeaders });
}
