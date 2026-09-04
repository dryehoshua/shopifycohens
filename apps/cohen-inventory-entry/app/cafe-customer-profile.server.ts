import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { randomUUID } from "node:crypto";
import db from "./db.server";
import { unauthenticated } from "./shopify.server";
import {
  assertCafePosEnabled,
  CafePosError,
  currentCafeSession,
  requireCafeManager,
} from "./cafe-pos.server";
import {
  assertRetailPosEnabled,
  currentRetailSession,
  requireRetailManager,
  RetailPosError,
} from "./retail-pos.server";
import {
  normalizeCafeCustomerProfile,
  type CafeCustomerProfileInput,
} from "./cafe-customer-profile-domain";
import { cashbackBasisPointsForTier, NEKUDOT_PROGRAM_KEY, normalizeBrokerCode } from "./nekudot-domain";
import { memberCardData } from "./nekudot-registration.server";
import { resolvePosMembershipAssignment } from "./pos-membership-profile.server";

type PosSurface = "CAFE" | "RETAIL";

function posError(surface: PosSurface, message: string, status = 400, code = "CUSTOMER_PROFILE_ERROR") {
  return surface === "CAFE"
    ? new CafePosError(message, status, code)
    : new RetailPosError(message, status, code);
}

async function posContext(surface: PosSurface, request: Request) {
  if (surface === "CAFE") {
    const session = await currentCafeSession(request);
    const shop = assertCafePosEnabled();
    return { session: session!, shop, admin: (await unauthenticated.admin(shop)).admin };
  }
  const session = await currentRetailSession(request);
  const shop = assertRetailPosEnabled();
  return { session: session!, shop, admin: (await unauthenticated.admin(shop)).admin };
}

function requirePosManager(surface: PosSurface, request: Request, pin: unknown) {
  return surface === "CAFE"
    ? requireCafeManager(request, pin)
    : requireRetailManager(request, pin);
}

type ShopifyAddress = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  zip: string | null;
  countryCodeV2: string | null;
  phone: string | null;
} | null;

type ShopifyCustomer = {
  id: string;
  legacyResourceId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  defaultEmailAddress: { emailAddress: string } | null;
  defaultPhoneNumber: { phoneNumber: string } | null;
  numberOfOrders: string;
  amountSpent: { amount: string; currencyCode: string };
  defaultAddress: ShopifyAddress;
  posProfile: { value: string } | null;
};

type ShopifyCustomerConnection = {
  nodes: ShopifyCustomer[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

type StoredCafeProfile = {
  community: string | null;
  cardTier: string | null;
  blueAffiliationCode: string | null;
  deliveryInstructions: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

const CUSTOMER_FIELDS = `
  id legacyResourceId firstName lastName displayName
  defaultEmailAddress { emailAddress }
  defaultPhoneNumber { phoneNumber }
  numberOfOrders
  amountSpent { amount currencyCode }
  defaultAddress {
    id firstName lastName address1 address2 city province provinceCode zip countryCodeV2 phone
  }
  posProfile: metafield(namespace: "cohens", key: "pos_profile") { value }
`;

async function graphql<T>(surface: PosSurface, admin: AdminApiContext, query: string, variables: Record<string, unknown> = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json() as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw posError(
      surface,
      payload.errors.map((error) => error.message || "Error GraphQL").join("; "),
      502,
      "SHOPIFY_GRAPHQL",
    );
  }
  if (!payload.data) throw posError(surface, "Shopify no devolvió datos.", 502, "SHOPIFY_EMPTY");
  return payload.data;
}

function mutationErrors(surface: PosSurface, errors: Array<{ field?: string[] | null; message: string }>) {
  if (!errors.length) return;
  throw posError(surface, errors.map((error) => error.message).join("; "), 409, "SHOPIFY_CUSTOMER_REJECTED");
}

function storedProfile(value: string | null | undefined): StoredCafeProfile {
  try {
    const parsed = JSON.parse(value || "{}") as Record<string, unknown>;
    const optional = (field: string) => typeof parsed[field] === "string" && parsed[field] ? String(parsed[field]) : null;
    return {
      community: optional("community"),
      cardTier: optional("cardTier"),
      blueAffiliationCode: optional("blueAffiliationCode"),
      deliveryInstructions: optional("deliveryInstructions"),
      updatedAt: optional("updatedAt"),
      updatedBy: optional("updatedBy"),
    };
  } catch {
    return {
      community: null,
      cardTier: null,
      blueAffiliationCode: null,
      deliveryInstructions: null,
      updatedAt: null,
      updatedBy: null,
    };
  }
}

function memberSummary(member: {
  id: string;
  cardTier: string;
  community: string | null;
  balanceCents: number;
  reservedCents: number;
  broker: { displayName: string; code: string } | null;
  credentials: Array<{ lastFour: string }>;
} | undefined) {
  if (!member) return null;
  return {
    id: member.id,
    cardTier: member.cardTier,
    cashbackBasisPoints: cashbackBasisPointsForTier(member.cardTier),
    availableCents: member.balanceCents - member.reservedCents,
    balanceCents: member.balanceCents,
    reservedCents: member.reservedCents,
    credentialCount: member.credentials.length,
    credentialLastFour: member.credentials[0]?.lastFour ?? null,
    broker: member.broker
      ? { displayName: member.broker.displayName, code: member.broker.code }
      : null,
  };
}

function customerResult(
  customer: ShopifyCustomer,
  member?: Parameters<typeof memberSummary>[0],
) {
  const saved = storedProfile(customer.posProfile?.value);
  const membership = memberSummary(member);
  return {
    id: customer.id,
    displayName: customer.displayName || `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Cliente sin nombre",
    firstName: customer.firstName || "",
    lastName: customer.lastName || "",
    email: customer.defaultEmailAddress?.emailAddress?.trim() || null,
    phone: customer.defaultPhoneNumber?.phoneNumber?.trim() || null,
    numberOfOrders: Number(customer.numberOfOrders) || 0,
    amountSpent: customer.amountSpent.amount,
    currencyCode: customer.amountSpent.currencyCode,
    address: customer.defaultAddress
      ? {
          id: customer.defaultAddress.id,
          firstName: customer.defaultAddress.firstName || "",
          lastName: customer.defaultAddress.lastName || "",
          address1: customer.defaultAddress.address1 || "",
          address2: customer.defaultAddress.address2 || "",
          city: customer.defaultAddress.city || "",
          province: customer.defaultAddress.province || "",
          provinceCode: customer.defaultAddress.provinceCode || "",
          zip: customer.defaultAddress.zip || "",
          countryCode: customer.defaultAddress.countryCodeV2 || "MX",
          phone: customer.defaultAddress.phone || null,
        }
      : null,
    profile: {
      community: member?.community ?? saved.community,
      cardTier: membership?.cardTier || saved.cardTier,
      blueAffiliationCode: membership?.broker?.code || saved.blueAffiliationCode,
      deliveryInstructions: saved.deliveryInstructions,
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy,
    },
    member: membership,
  };
}

async function customerById(surface: PosSurface, admin: AdminApiContext, customerId: string) {
  const data = await graphql<{ customer: ShopifyCustomer | null }>(surface, admin, `#graphql
    query CafeCustomerProfile($id: ID!) {
      customer(id: $id) { ${CUSTOMER_FIELDS} }
    }
  `, { id: customerId });
  if (!data.customer) throw posError(surface, "Shopify no encontró al cliente.", 404, "CUSTOMER_NOT_FOUND");
  return data.customer;
}

async function activeBroker(surface: PosSurface, code: string | null) {
  if (!code) return null;
  const brokers = await db.nekudotBroker.findMany({
    where: {
      programKey: NEKUDOT_PROGRAM_KEY,
      active: true,
    },
    select: { id: true, code: true, displayName: true, referralWord: true, active: true },
  });
  const normalized = code.normalize("NFKC").trim().toLocaleLowerCase("es-MX");
  const broker = brokers.find((candidate) => candidate.code.toLocaleLowerCase("es-MX") === normalized
    || candidate.referralWord?.normalize("NFKC").trim().toLocaleLowerCase("es-MX") === normalized
    || (candidate.referralWord ? normalizeBrokerCode(candidate.referralWord) === code : false));
  if (!broker?.active) {
    throw posError(surface, "La clave de afiliación Blue no es válida o ya no está activa.", 409, "BLUE_AFFILIATION_INVALID");
  }
  return broker;
}

async function customerIdentity(shop: string, customerId: string | null) {
  if (!customerId) return null;
  return db.nekudotCustomerIdentity.findUnique({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customerId } },
    include: {
      member: {
        include: {
          broker: true,
          credentials: { where: { active: true }, orderBy: { updatedAt: "desc" } },
        },
      },
    },
  });
}

async function listPosCustomerProfiles(surface: PosSurface, request: Request, search: string) {
  const { session, admin } = await posContext(surface, request);
  const query = search.trim().slice(0, 100) || null;
  const customers: ShopifyCustomer[] = [];
  let after: string | null = null;
  do {
    const data: { customers: ShopifyCustomerConnection } = await graphql(surface, admin, `#graphql
      query CafeCustomerProfiles($after: String, $query: String) {
        customers(first: 250, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
          nodes { ${CUSTOMER_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { after, query });
    customers.push(...data.customers.nodes);
    after = data.customers.pageInfo.hasNextPage ? data.customers.pageInfo.endCursor : null;
  } while (after);

  const identities = customers.length
    ? await db.nekudotCustomerIdentity.findMany({
        where: { shop: session!.shop, shopifyCustomerId: { in: customers.map((customer) => customer.id) } },
        include: {
          member: {
            include: {
              broker: true,
              credentials: { where: { active: true }, orderBy: { updatedAt: "desc" } },
            },
          },
        },
      })
    : [];
  const members = new Map(identities.map((identity) => [identity.shopifyCustomerId, identity.member]));
  return customers.map((customer) => {
    const result = customerResult(customer, members.get(customer.id));
    const member = members.get(customer.id);
    if (member) result.profile.community = member.community;
    return result;
  });
}

export function listCafeCustomerProfiles(request: Request, search: string) {
  return listPosCustomerProfiles("CAFE", request, search);
}

export function listRetailCustomerProfiles(request: Request, search: string) {
  return listPosCustomerProfiles("RETAIL", request, search);
}

function shopifyCustomerInput(profile: CafeCustomerProfileInput, metafieldValue: string) {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName || null,
    email: profile.email,
    phone: profile.phone,
    metafields: [{
      namespace: "cohens",
      key: "pos_profile",
      type: "json",
      value: metafieldValue,
    }],
  };
}

function shopifyAddressInput(profile: CafeCustomerProfileInput) {
  if (!profile.address) return null;
  return {
    firstName: profile.firstName,
    lastName: profile.lastName || null,
    address1: profile.address.address1,
    address2: profile.address.address2,
    city: profile.address.city,
    provinceCode: profile.address.province,
    zip: profile.address.zip,
    countryCode: profile.address.countryCode,
    phone: profile.address.phone,
  };
}

async function savePosCustomerProfile(surface: PosSurface, request: Request, raw: Record<string, unknown>) {
  const { session, shop, admin } = await posContext(surface, request);
  let profile: CafeCustomerProfileInput;
  try {
    profile = normalizeCafeCustomerProfile(raw);
  } catch (error) {
    throw posError(surface, error instanceof Error ? error.message : "Los datos del cliente no son válidos.");
  }
  const previousAddressId = String(raw.addressId ?? "").trim() || null;
  if (previousAddressId && !/^gid:\/\/shopify\/MailingAddress\/\d+/.test(previousAddressId)) {
    throw posError(surface, "La dirección de Shopify no es válida.");
  }

  const identity = await customerIdentity(shop, profile.customerId);
  const broker = await activeBroker(surface, profile.cardTier === "BLUE" ? profile.blueAffiliationCode : null);
  const requestedTier = profile.cardTier || identity?.member.cardTier || null;
  const requestedBrokerId = requestedTier === "BLUE"
    ? broker?.id || (profile.blueAffiliationCode ? null : identity?.member.brokerId) || null
    : null;
  const membershipChanged = Boolean(identity && (
    requestedTier !== identity.member.cardTier
    || requestedBrokerId !== identity.member.brokerId
  ));
  if (membershipChanged) await requirePosManager(surface, request, raw.managerPin);

  const stored = JSON.stringify({
    version: 1,
    community: profile.community,
    cardTier: requestedTier,
    blueAffiliationCode: requestedTier === "BLUE" ? broker?.code || identity?.member.broker?.code || null : null,
    deliveryInstructions: profile.deliveryInstructions,
    updatedAt: new Date().toISOString(),
    updatedBy: session!.staff.name,
  });
  const input = shopifyCustomerInput(profile, stored);
  const addressInput = shopifyAddressInput(profile);
  let customerId = profile.customerId;

  if (customerId) {
    const updated = await graphql<{
      customerUpdate: { customer: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> };
    }>(surface, admin, `#graphql
      mutation CafeCustomerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
    `, { input: { id: customerId, ...input } });
    mutationErrors(surface, updated.customerUpdate.userErrors);
    if (!updated.customerUpdate.customer) throw posError(surface, "Shopify no actualizó al cliente.", 502);

    if (addressInput) {
      if (profile.address?.id) {
        const address = await graphql<{
          customerAddressUpdate: { address: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> };
        }>(surface, admin, `#graphql
          mutation CafeCustomerAddressUpdate($customerId: ID!, $addressId: ID!, $address: MailingAddressInput!) {
            customerAddressUpdate(customerId: $customerId, addressId: $addressId, address: $address, setAsDefault: true) {
              address { id }
              userErrors { field message }
            }
          }
        `, { customerId, addressId: profile.address.id, address: addressInput });
        mutationErrors(surface, address.customerAddressUpdate.userErrors);
      } else {
        const address = await graphql<{
          customerAddressCreate: { address: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> };
        }>(surface, admin, `#graphql
          mutation CafeCustomerAddressCreate($customerId: ID!, $address: MailingAddressInput!) {
            customerAddressCreate(customerId: $customerId, address: $address, setAsDefault: true) {
              address { id }
              userErrors { field message }
            }
          }
        `, { customerId, address: addressInput });
        mutationErrors(surface, address.customerAddressCreate.userErrors);
      }
    } else if (previousAddressId) {
      const address = await graphql<{
        customerAddressDelete: { deletedAddressId: string | null; userErrors: Array<{ field?: string[]; message: string }> };
      }>(surface, admin, `#graphql
        mutation PosCustomerAddressDelete($customerId: ID!, $addressId: ID!) {
          customerAddressDelete(customerId: $customerId, addressId: $addressId) {
            deletedAddressId
            userErrors { field message }
          }
        }
      `, { customerId, addressId: previousAddressId });
      mutationErrors(surface, address.customerAddressDelete.userErrors);
    }
  } else {
    const created = await graphql<{
      customerCreate: { customer: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> };
    }>(surface, admin, `#graphql
      mutation CafeCustomerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
    `, { input: { ...input, ...(addressInput ? { addresses: [addressInput] } : {}) } });
    mutationErrors(surface, created.customerCreate.userErrors);
    customerId = created.customerCreate.customer?.id || null;
    if (!customerId) throw posError(surface, "Shopify no creó al cliente.", 502, "CUSTOMER_CREATE_FAILED");
  }

  const tags = await graphql<{
    tagsAdd: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(surface, admin, `#graphql
    mutation CafeCustomerTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }
  `, { id: customerId, tags: [surface === "CAFE" ? "cohens-cafe" : "cohens-retail"] });
  mutationErrors(surface, tags.tagsAdd.userErrors);

  const savedCustomer = await customerById(surface, admin, customerId);
  if (identity) {
    const updatedMember = await db.nekudotMember.update({
      where: { id: identity.memberId },
      data: {
        displayName: savedCustomer.displayName || `${profile.firstName} ${profile.lastName}`.trim(),
        email: profile.email,
        phone: profile.phone,
        community: profile.community,
        ...(requestedTier ? { cardTier: requestedTier, brokerId: requestedBrokerId } : {}),
      },
      include: {
        broker: true,
        credentials: { where: { active: true }, orderBy: { updatedAt: "desc" } },
      },
    });
    await db.nekudotCustomerIdentity.update({
      where: { id: identity.id },
      data: { displayName: savedCustomer.displayName, email: profile.email },
    });
    const result = customerResult(savedCustomer, updatedMember);
    result.profile.community = updatedMember.community;
    return result;
  }
  return customerResult(savedCustomer);
}

export function saveCafeCustomerProfile(request: Request, raw: Record<string, unknown>) {
  return savePosCustomerProfile("CAFE", request, raw);
}

export function saveRetailCustomerProfile(request: Request, raw: Record<string, unknown>) {
  return savePosCustomerProfile("RETAIL", request, raw);
}

async function membershipPayload(memberId: string) {
  const card = await memberCardData(memberId);
  const credentials = await db.nekudotCredential.findMany({
    where: { memberId },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      kind: true,
      label: true,
      lastFour: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      revokedAt: true,
      revokedReason: true,
    },
  });
  return {
    id: card.id,
    displayName: card.displayName,
    cardTier: card.cardTier,
    cashbackBasisPoints: cashbackBasisPointsForTier(card.cardTier),
    availableCents: card.balanceCents - card.reservedCents,
    balanceCents: card.balanceCents,
    reservedCents: card.reservedCents,
    broker: card.broker ? { displayName: card.broker.displayName, code: card.broker.code } : null,
    photoUrl: card.photoFileName ? `/nekudot-photo/${card.id}` : null,
    qrDataUrl: card.qrDataUrl,
    barcodeDataUrl: card.barcodeDataUrl,
    cardNumber: card.cardNumber,
    credentials: credentials.map((credential) => ({
      ...credential,
      createdAt: credential.createdAt.toISOString(),
      updatedAt: credential.updatedAt.toISOString(),
      revokedAt: credential.revokedAt?.toISOString() || null,
      removable: !new Set(["QR", "BARCODE"]).has(credential.kind),
    })),
  };
}

async function membershipDetails(surface: PosSurface, request: Request, rawCustomerId: unknown) {
  const { shop, admin } = await posContext(surface, request);
  const customerId = String(rawCustomerId ?? "").trim();
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)) {
    throw posError(surface, "El cliente de Shopify no es válido.");
  }
  const customer = await customerById(surface, admin, customerId);
  const identity = await customerIdentity(shop, customerId);
  if (!identity) return { customer: customerResult(customer), membership: null };
  return {
    customer: customerResult(customer, identity.member),
    membership: await membershipPayload(identity.memberId),
  };
}

const MEMBERSHIP_TAGS = [
  "NEKUDOT_PLATA",
  "NEKUDOT_BLUE",
  "NEKUDOT_GOLDEN",
  "NEKUDOT_GOLDEN_PENDIENTE",
  "NEKUDOT_GOLDEN_INACTIVA",
  "NEKUDOT_VALES",
];

function membershipTag(cardTier: string) {
  if (cardTier === "BLUE") return "NEKUDOT_BLUE";
  if (cardTier === "GOLDEN") return "NEKUDOT_GOLDEN";
  if (cardTier === "VOUCHER") return "NEKUDOT_VALES";
  return "NEKUDOT_PLATA";
}

async function syncShopifyMembership(
  surface: PosSurface,
  admin: AdminApiContext,
  customer: ShopifyCustomer,
  input: { cardTier: string; community: string | null; broker: { code: string } | null; updatedBy: string },
) {
  const saved = storedProfile(customer.posProfile?.value);
  const profileValue = JSON.stringify({
    version: 1,
    community: input.community ?? saved.community,
    cardTier: input.cardTier,
    blueAffiliationCode: input.cardTier === "BLUE" ? input.broker?.code || null : null,
    deliveryInstructions: saved.deliveryInstructions,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
  });
  const updated = await graphql<{
    customerUpdate: { customer: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> };
  }>(surface, admin, `#graphql
    mutation PosMembershipCustomerUpdate($input: CustomerInput!) {
      customerUpdate(input: $input) { customer { id } userErrors { field message } }
    }
  `, {
    input: {
      id: customer.id,
      metafields: [{ namespace: "cohens", key: "pos_profile", type: "json", value: profileValue }],
    },
  });
  mutationErrors(surface, updated.customerUpdate.userErrors);

  const removed = await graphql<{
    tagsRemove: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(surface, admin, `#graphql
    mutation PosMembershipTagsRemove($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
    }
  `, { id: customer.id, tags: MEMBERSHIP_TAGS });
  mutationErrors(surface, removed.tagsRemove.userErrors);
  const added = await graphql<{
    tagsAdd: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(surface, admin, `#graphql
    mutation PosMembershipTagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }
  `, {
    id: customer.id,
    tags: [membershipTag(input.cardTier), "NEKUDOT_ACTIVO", surface === "CAFE" ? "cohens-cafe" : "cohens-retail"],
  });
  mutationErrors(surface, added.tagsAdd.userErrors);
}

async function activateMembership(surface: PosSurface, request: Request, raw: Record<string, unknown>) {
  const authorization = await requirePosManager(surface, request, raw.managerPin);
  const { shop, admin } = await posContext(surface, request);
  const customerId = String(raw.customerId ?? "").trim();
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)) {
    throw posError(surface, "El cliente de Shopify no es válido.");
  }
  const customer = await customerById(surface, admin, customerId);
  let assignment;
  try {
    assignment = await resolvePosMembershipAssignment(raw);
  } catch (error) {
    throw posError(surface, error instanceof Error ? error.message : "Los datos de la membresía no son válidos.");
  }
  const email = customer.defaultEmailAddress?.emailAddress?.trim().toLowerCase() || null;
  const phone = customer.defaultPhoneNumber?.phoneNumber?.trim() || assignment.phone;
  if (!phone) {
    throw posError(surface, "Agrega el teléfono del cliente antes de activar Nekudot.", 409, "CUSTOMER_PHONE_REQUIRED");
  }

  const member = await db.$transaction(async (transaction) => {
    const existingIdentity = await transaction.nekudotCustomerIdentity.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customerId } },
      include: { member: true },
    });
    let memberId = existingIdentity?.memberId || null;
    if (!memberId && (phone || email)) {
      const contactMatches = [
        ...(phone ? [{ phone }] : []),
        ...(email ? [{ email }] : []),
      ];
      const matches = await transaction.nekudotMember.findMany({
        where: {
          programKey: NEKUDOT_PROGRAM_KEY,
          active: true,
          OR: contactMatches,
        },
        include: { identities: true },
        take: 3,
      });
      if (matches.length > 1) {
        throw posError(surface, "Hay más de una membresía con esos datos. Identifica al cliente con su tarjeta para evitar unir cuentas incorrectas.", 409, "MEMBER_AMBIGUOUS");
      }
      const match = matches[0];
      const conflictingIdentity = match?.identities.find((identity) => identity.shop === shop && identity.shopifyCustomerId !== customerId);
      if (conflictingIdentity) {
        throw posError(surface, "Esa membresía ya está ligada a otro cliente de esta tienda.", 409, "SHOP_IDENTITY_CONFLICT");
      }
      memberId = match?.id || null;
    }
    if (!memberId) {
      memberId = (await transaction.nekudotMember.create({
        data: {
          programKey: NEKUDOT_PROGRAM_KEY,
          displayName: customer.displayName || "Cliente sin nombre",
          email,
          phone,
          community: assignment.community,
          cardTier: assignment.cardTier,
          brokerId: assignment.brokerId,
          enrollmentStatus: "ACTIVE",
          active: true,
        },
      })).id;
    }
    const otherIdentity = await transaction.nekudotCustomerIdentity.findUnique({
      where: { memberId_shop: { memberId, shop } },
    });
    if (otherIdentity && otherIdentity.shopifyCustomerId !== customerId) {
      throw posError(surface, "Esa membresía ya está ligada a otro cliente de esta tienda.", 409, "SHOP_IDENTITY_CONFLICT");
    }
    const updatedMember = await transaction.nekudotMember.update({
      where: { id: memberId },
      data: {
        displayName: customer.displayName || "Cliente sin nombre",
        email,
        phone,
        community: assignment.community,
        cardTier: assignment.cardTier,
        brokerId: assignment.brokerId,
        enrollmentStatus: "ACTIVE",
        active: true,
      },
    });
    await transaction.nekudotCustomerIdentity.upsert({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customerId } },
      create: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId,
        shop,
        shopifyCustomerId: customerId,
        shopifyLegacyCustomerId: String(customer.legacyResourceId),
        displayName: customer.displayName || "Cliente sin nombre",
        email,
      },
      update: {
        memberId,
        shopifyLegacyCustomerId: String(customer.legacyResourceId),
        displayName: customer.displayName || "Cliente sin nombre",
        email,
      },
    });
    return updatedMember;
  });

  await syncShopifyMembership(surface, admin, customer, {
    cardTier: member.cardTier,
    community: member.community,
    broker: assignment.broker,
    updatedBy: authorization.session.staff.name,
  });
  return membershipDetails(surface, request, customerId);
}

async function removeCredential(surface: PosSurface, request: Request, raw: Record<string, unknown>) {
  const authorization = await requirePosManager(surface, request, raw.managerPin);
  const { shop } = await posContext(surface, request);
  const customerId = String(raw.customerId ?? "").trim();
  const credentialId = String(raw.credentialId ?? "").trim();
  const identity = await customerIdentity(shop, customerId);
  if (!identity) throw posError(surface, "Este cliente todavía no tiene Nekudot activo.", 404, "MEMBER_NOT_FOUND");
  const credential = await db.nekudotCredential.findFirst({
    where: { id: credentialId, memberId: identity.memberId },
  });
  if (!credential) throw posError(surface, "La tarjeta no pertenece a este cliente.", 404, "CREDENTIAL_NOT_FOUND");
  if (new Set(["QR", "BARCODE"]).has(credential.kind)) {
    throw posError(surface, "El QR y el código de barras digitales no se eliminan; son identificadores fijos de la membresía.", 409, "DIGITAL_CREDENTIAL_FIXED");
  }
  if (credential.active) {
    const revokedAt = new Date();
    await db.$transaction([
      db.nekudotCredential.update({
        where: { id: credential.id },
        data: { active: false, revokedAt, revokedReason: "REMOVED_IN_POS", revokedByShop: shop },
      }),
      db.nekudotLedgerEntry.create({
        data: {
          programKey: NEKUDOT_PROGRAM_KEY,
          memberId: identity.memberId,
          walletType: "CLIENT",
          type: "CREDENTIAL_REMOVED",
          amountCents: 0,
          balanceAfterCents: identity.member.balanceCents,
          currencyCode: identity.member.currencyCode,
          shop,
          source: "ADMIN",
          sourceId: credential.id,
          idempotencyKey: `credential-removal:${randomUUID()}`,
          description: `Tarjeta terminación ${credential.lastFour} eliminada por ${authorization.session.staff.name}`,
          metadata: { credentialId: credential.id, lastFour: credential.lastFour },
        },
      }),
    ]);
  }
  return membershipDetails(surface, request, customerId);
}

async function syncAssignedMembership(surface: PosSurface, request: Request, rawCustomerId: unknown) {
  const { session, shop, admin } = await posContext(surface, request);
  const customerId = String(rawCustomerId ?? "").trim();
  const customer = await customerById(surface, admin, customerId);
  const identity = await customerIdentity(shop, customerId);
  if (!identity?.member.active) {
    throw posError(surface, "No se pudo confirmar la membresía asignada.", 409, "MEMBER_NOT_FOUND");
  }
  await syncShopifyMembership(surface, admin, customer, {
    cardTier: identity.member.cardTier,
    community: identity.member.community,
    broker: identity.member.broker,
    updatedBy: session.staff.name,
  });
  return membershipDetails(surface, request, customerId);
}

export function getCafeCustomerMembership(request: Request, customerId: unknown) {
  return membershipDetails("CAFE", request, customerId);
}

export function getRetailCustomerMembership(request: Request, customerId: unknown) {
  return membershipDetails("RETAIL", request, customerId);
}

export function activateCafeCustomerMembership(request: Request, raw: Record<string, unknown>) {
  return activateMembership("CAFE", request, raw);
}

export function activateRetailCustomerMembership(request: Request, raw: Record<string, unknown>) {
  return activateMembership("RETAIL", request, raw);
}

export function removeCafeCustomerCredential(request: Request, raw: Record<string, unknown>) {
  return removeCredential("CAFE", request, raw);
}

export function removeRetailCustomerCredential(request: Request, raw: Record<string, unknown>) {
  return removeCredential("RETAIL", request, raw);
}

export function syncCafeAssignedMembership(request: Request, customerId: unknown) {
  return syncAssignedMembership("CAFE", request, customerId);
}

export function syncRetailAssignedMembership(request: Request, customerId: unknown) {
  return syncAssignedMembership("RETAIL", request, customerId);
}
