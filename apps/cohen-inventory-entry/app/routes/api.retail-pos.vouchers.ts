import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  allocateCommunityVoucher,
  communityVoucherFundSummary,
  loadCommunityVoucherFund,
} from "../community-wallet.server";
import {
  assertRetailSameOrigin,
  currentRetailSession,
  requireRetailManager,
  retailPosJsonError,
} from "../retail-pos.server";

async function dashboard(shop: string) {
  const [fund, wallets] = await Promise.all([
    communityVoucherFundSummary(),
    db.communityVoucherWallet.findMany({
      where: { status: "ACTIVE", member: { identities: { some: { shop } } } },
      include: { member: { include: { identities: { where: { shop }, take: 1 } } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  return {
    fund: {
      balanceCents: fund.balanceCents,
      lifetimeLoadedCents: fund.lifetimeLoadedCents,
      lifetimeGrantedCents: fund.lifetimeGrantedCents,
    },
    recipients: wallets.map((wallet) => ({
      memberId: wallet.memberId,
      displayName: wallet.member.displayName,
      email: wallet.member.email,
      phone: wallet.member.phone,
      balanceCents: wallet.balanceCents,
      availableCents: wallet.balanceCents - wallet.reservedCents,
      customerId: wallet.member.identities[0]?.shopifyCustomerId || null,
    })),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentRetailSession(request);
    return Response.json({ ok: true, ...await dashboard(session!.shop) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertRetailSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const authorization = await requireRetailManager(request, body.managerPin);
    const key = String(body.idempotencyKey || "");
    if (body.intent === "load") {
      await loadCommunityVoucherFund({
        amount: body.amount,
        sourceReference: body.sourceReference,
        actor: authorization.managerName,
        idempotencyKey: key,
      });
    } else if (body.intent === "allocate") {
      const recipient = await db.nekudotCustomerIdentity.findFirst({ where: {
        shop: authorization.session.shop, memberId: String(body.memberId || ""), member: { active: true },
      } });
      if (!recipient) return Response.json({ ok: false, error: "Selecciona un cliente activo de esta tienda." }, { status: 404 });
      await allocateCommunityVoucher({
        memberId: String(body.memberId || ""),
        amount: body.amount,
        actor: authorization.managerName,
        idempotencyKey: key,
      });
    } else {
      return Response.json({ ok: false, error: "Acción no válida." }, { status: 405 });
    }
    return Response.json({ ok: true, ...await dashboard(authorization.session.shop) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
