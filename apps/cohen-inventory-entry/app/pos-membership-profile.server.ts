import db from "./db.server";
import { normalizeCafeCustomerPhone } from "./cafe-customer-profile-domain";
import {
  NEKUDOT_COMMUNITIES,
  NEKUDOT_PROGRAM_KEY,
  normalizeBrokerCode,
  normalizeNekudotCardTier,
} from "./nekudot-domain";

export async function resolvePosMembershipAssignment(input: {
  cardTier?: unknown;
  blueAffiliationCode?: unknown;
  community?: unknown;
  phone?: unknown;
}) {
  const cardTier = normalizeNekudotCardTier(input.cardTier);
  const community = String(input.community ?? "").normalize("NFKC").trim() || null;
  if (community && !NEKUDOT_COMMUNITIES.includes(community as (typeof NEKUDOT_COMMUNITIES)[number])) {
    throw new Error("Selecciona una comunidad válida.");
  }
  const phone = normalizeCafeCustomerPhone(input.phone);
  let broker: { id: string; code: string; displayName: string } | null = null;
  if (cardTier === "BLUE") {
    const rawCode = String(input.blueAffiliationCode ?? "").trim();
    if (!rawCode) throw new Error("Escribe la clave de afiliación para la tarjeta Blue.");
    const code = normalizeBrokerCode(rawCode);
    const match = await db.nekudotBroker.findUnique({
      where: { programKey_code: { programKey: NEKUDOT_PROGRAM_KEY, code } },
      select: { id: true, code: true, displayName: true, active: true },
    });
    if (!match?.active) throw new Error("La clave de afiliación Blue no es válida o ya no está activa.");
    broker = match;
  }
  return { cardTier, broker, brokerId: broker?.id || null, community, phone };
}

export function updateAssignedMemberProfile(memberId: string, input: {
  cardTier: string;
  brokerId: string | null;
  community: string | null;
  phone: string | null;
}) {
  return db.nekudotMember.update({
    where: { id: memberId },
    data: {
      cardTier: input.cardTier,
      brokerId: input.brokerId,
      community: input.community,
      phone: input.phone,
    },
    include: {
      broker: true,
      credentials: true,
      identities: true,
    },
  });
}
