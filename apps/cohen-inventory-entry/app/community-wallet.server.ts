import { createHash, randomUUID } from "node:crypto";
import bwipjs from "bwip-js";
import QRCode from "qrcode";
import db from "./db.server";
import { NEKUDOT_PROGRAM_KEY } from "./nekudot-domain";
import { NekudotError } from "./nekudot.server";

function parseAmountCents(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new NekudotError("Escribe una cantidad válida.");
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) throw new NekudotError("El importe excede el límite permitido.");
  if (cents < 100) throw new NekudotError("La cantidad mínima es $1.00 MXN.");
  return cents;
}

function safeOperationKey(value: unknown) {
  const key = String(value || "").trim().slice(0, 160);
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(key)) throw new NekudotError("La referencia de la operación no es válida.");
  return key;
}

function voucherCardNumber(walletId: string) {
  const digest = createHash("sha256").update(`cohens-community-voucher:${walletId}`).digest("hex");
  return `VC-${BigInt(`0x${digest.slice(0, 12)}`).toString().slice(0, 12).padStart(12, "0")}`;
}

async function voucherImages(walletId: string) {
  const credential = `COHENS:VALES:${walletId}`;
  const cardNumber = voucherCardNumber(walletId);
  const barcode = await bwipjs.toBuffer({
    bcid: "code128",
    text: credential,
    scale: 3,
    height: 18,
    includetext: false,
    backgroundcolor: "FFFFFF",
    paddingwidth: 14,
    paddingheight: 8,
  });
  return {
    cardNumber,
    qrDataUrl: await QRCode.toDataURL(credential, { width: 360, margin: 2, errorCorrectionLevel: "M" }),
    barcodeDataUrl: `data:image/png;base64,${barcode.toString("base64")}`,
  };
}

export async function communityVoucherForMember(memberId: string) {
  const wallet = await db.communityVoucherWallet.findUnique({
    where: { memberId },
    include: { ledger: { orderBy: { occurredAt: "desc" }, take: 20 } },
  });
  if (!wallet) return null;
  return {
    id: wallet.id,
    status: wallet.status,
    balanceCents: wallet.balanceCents,
    reservedCents: wallet.reservedCents,
    availableCents: wallet.balanceCents - wallet.reservedCents,
    lifetimeGrantedCents: wallet.lifetimeGrantedCents,
    lifetimeRedeemedCents: wallet.lifetimeRedeemedCents,
    activatedAt: wallet.activatedAt,
    ledger: wallet.ledger.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amountCents: entry.amountCents,
      description: entry.description,
      occurredAt: entry.occurredAt,
    })),
    ...await voucherImages(wallet.id),
  };
}

export async function activateCommunityVoucher(memberId: string) {
  const member = await db.nekudotMember.findFirst({ where: { id: memberId, active: true }, select: { id: true } });
  if (!member) throw new NekudotError("Primero activa tu cuenta Cohen's.", 404);
  await db.communityVoucherWallet.upsert({
    where: { memberId },
    create: { programKey: NEKUDOT_PROGRAM_KEY, memberId, status: "ACTIVE" },
    update: { status: "ACTIVE" },
  });
  return communityVoucherForMember(memberId);
}

export async function communityVoucherFundSummary() {
  const fund = await db.communityVoucherFund.upsert({
    where: { programKey: NEKUDOT_PROGRAM_KEY },
    create: { programKey: NEKUDOT_PROGRAM_KEY },
    update: {},
  });
  return fund;
}

export async function loadCommunityVoucherFund(input: {
  amount: unknown;
  sourceReference?: unknown;
  actor: string;
  idempotencyKey: unknown;
}) {
  const amountCents = parseAmountCents(input.amount);
  const key = safeOperationKey(input.idempotencyKey);
  return db.$transaction(async (transaction) => {
    const duplicate = await transaction.communityVoucherFundEntry.findUnique({
      where: { programKey_idempotencyKey: { programKey: NEKUDOT_PROGRAM_KEY, idempotencyKey: key } },
    });
    if (duplicate) {
      if (duplicate.type !== "LOAD" || duplicate.amountCents !== amountCents) throw new NekudotError("Esta referencia ya se usó para otra operación.", 409);
      return transaction.communityVoucherFund.findUniqueOrThrow({ where: { id: duplicate.fundId } });
    }
    const fund = await transaction.communityVoucherFund.upsert({
      where: { programKey: NEKUDOT_PROGRAM_KEY },
      create: { programKey: NEKUDOT_PROGRAM_KEY, balanceCents: amountCents, lifetimeLoadedCents: amountCents },
      update: { balanceCents: { increment: amountCents }, lifetimeLoadedCents: { increment: amountCents } },
    });
    await transaction.communityVoucherFundEntry.create({ data: {
      programKey: NEKUDOT_PROGRAM_KEY,
      fundId: fund.id,
      type: "LOAD",
      amountCents,
      balanceAfterCents: fund.balanceCents,
      source: "RETAIL_POS",
      sourceId: String(input.sourceReference || "").trim().slice(0, 120) || null,
      idempotencyKey: key,
      description: `Recarga de fondo comunitario registrada por ${input.actor}`,
    } });
    return fund;
  });
}

export async function allocateCommunityVoucher(input: {
  memberId: string;
  amount: unknown;
  actor: string;
  idempotencyKey: unknown;
}) {
  const amountCents = parseAmountCents(input.amount);
  const key = safeOperationKey(input.idempotencyKey);
  const wallet = await communityVoucherForMember(input.memberId);
  if (!wallet) throw new NekudotError("No pudimos activar la tarjeta de vales.", 500);
  if (wallet.status !== "ACTIVE") throw new NekudotError("La tarjeta de vales no está activa.", 409);
  await db.$transaction(async (transaction) => {
    const duplicate = await transaction.communityVoucherFundEntry.findUnique({
      where: { programKey_idempotencyKey: { programKey: NEKUDOT_PROGRAM_KEY, idempotencyKey: key } },
    });
    if (duplicate) {
      if (duplicate.type !== "ALLOCATION" || duplicate.amountCents !== -amountCents || duplicate.sourceId !== wallet.id) throw new NekudotError("Esta referencia ya se usó para otra operación.", 409);
      return;
    }
    const fund = await transaction.communityVoucherFund.findUnique({ where: { programKey: NEKUDOT_PROGRAM_KEY } });
    if (!fund || fund.balanceCents < amountCents) throw new NekudotError("La cuenta concentradora no tiene saldo suficiente.", 409);
    const updatedFund = await transaction.communityVoucherFund.update({
      where: { id: fund.id },
      data: { balanceCents: { decrement: amountCents }, lifetimeGrantedCents: { increment: amountCents } },
    });
    const updatedWallet = await transaction.communityVoucherWallet.update({
      where: { memberId: input.memberId },
      data: { balanceCents: { increment: amountCents }, lifetimeGrantedCents: { increment: amountCents }, status: "ACTIVE" },
    });
    await transaction.communityVoucherFundEntry.create({ data: {
      programKey: NEKUDOT_PROGRAM_KEY, fundId: fund.id, type: "ALLOCATION", amountCents: -amountCents,
      balanceAfterCents: updatedFund.balanceCents, source: "RETAIL_POS", sourceId: updatedWallet.id,
      idempotencyKey: key, description: `Saldo asignado por ${input.actor}`,
    } });
    await transaction.communityVoucherLedgerEntry.create({ data: {
      programKey: NEKUDOT_PROGRAM_KEY, walletId: updatedWallet.id, type: "GRANT", amountCents,
      balanceAfterCents: updatedWallet.balanceCents, source: "COMMUNITY_FUND", sourceId: fund.id,
      idempotencyKey: `wallet:${key}`, description: "Asignación de apoyo comunitario",
    } });
  });
  return communityVoucherForMember(input.memberId);
}

export async function reserveCommunityVoucher(input: {
  shop: string;
  memberId: string;
  amount: unknown;
  cartReference: unknown;
  idempotencyKey: unknown;
}) {
  const amountCents = parseAmountCents(input.amount);
  const key = safeOperationKey(input.idempotencyKey);
  const cartReference = String(input.cartReference || "").trim().slice(0, 160) || key;
  return db.$transaction(async (transaction) => {
    const duplicate = await transaction.communityVoucherRedemption.findUnique({
      where: { programKey_idempotencyKey: { programKey: NEKUDOT_PROGRAM_KEY, idempotencyKey: key } },
    });
    if (duplicate) {
      const owner = await transaction.communityVoucherWallet.findUnique({ where: { memberId: input.memberId } });
      if (duplicate.walletId !== owner?.id || duplicate.shop !== input.shop || duplicate.amountCents !== amountCents || duplicate.status !== "RESERVED") throw new NekudotError("Esta referencia de canje ya no es válida para esta compra.", 409);
      return duplicate;
    }
    const wallet = await transaction.communityVoucherWallet.findUnique({ where: { memberId: input.memberId } });
    if (!wallet || wallet.status !== "ACTIVE") throw new NekudotError("La tarjeta de vales no está activa.", 404);
    if (wallet.balanceCents - wallet.reservedCents < amountCents) throw new NekudotError("El saldo de Vales comunitarios no alcanza.", 409);
    const redemption = await transaction.communityVoucherRedemption.create({ data: {
      programKey: NEKUDOT_PROGRAM_KEY, walletId: wallet.id, shop: input.shop, amountCents,
      cartReference, idempotencyKey: key, expiresAt: new Date(Date.now() + 30 * 60_000),
    } });
    await transaction.communityVoucherWallet.update({ where: { id: wallet.id }, data: { reservedCents: { increment: amountCents } } });
    return redemption;
  });
}

export async function cancelCommunityVoucherReservation(shop: string, redemptionId: string) {
  return db.$transaction(async (transaction) => {
    const redemption = await transaction.communityVoucherRedemption.findFirst({ where: { id: redemptionId, shop } });
    if (!redemption || redemption.status !== "RESERVED") return redemption;
    await transaction.communityVoucherWallet.update({ where: { id: redemption.walletId }, data: { reservedCents: { decrement: redemption.amountCents } } });
    return transaction.communityVoucherRedemption.update({ where: { id: redemption.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  });
}

export async function renewCommunityVoucherReservation(shop: string, redemptionId: string) {
  const redemption = await db.communityVoucherRedemption.findFirst({ where: { id: redemptionId, shop } });
  if (!redemption || redemption.status !== "RESERVED") return redemption;
  return db.communityVoucherRedemption.update({
    where: { id: redemption.id },
    data: { expiresAt: new Date(Date.now() + 30 * 60_000) },
  });
}

async function ownedBroker(memberId: string) {
  const member = await db.nekudotMember.findFirst({
    where: { id: memberId, active: true },
    include: { ownedBroker: true },
  });
  if (!member?.ownedBroker?.active) throw new NekudotError("Tu cuenta no tiene un perfil IB activo.", 404);
  return { member, broker: member.ownedBroker };
}

export async function transferIbGoldToNekudot(memberId: string, amountValue: unknown) {
  const amountCents = parseAmountCents(amountValue);
  const { broker } = await ownedBroker(memberId);
  const operationId = randomUUID();
  return db.$transaction(async (transaction) => {
    const current = await transaction.nekudotBroker.findUniqueOrThrow({ where: { id: broker.id } });
    const availableCents = current.commissionBalanceCents - current.reservedWithdrawalCents;
    if (amountCents > availableCents) throw new NekudotError("Tus Nekudot Gold disponibles no alcanzan.", 409);
    const updatedBroker = await transaction.nekudotBroker.update({
      where: { id: broker.id }, data: { commissionBalanceCents: { decrement: amountCents } },
    });
    const updatedMember = await transaction.nekudotMember.update({
      where: { id: memberId },
      data: { balanceCents: { increment: amountCents }, lifetimeEarnedCents: { increment: amountCents } },
    });
    await transaction.nekudotLedgerEntry.createMany({ data: [
      {
        programKey: NEKUDOT_PROGRAM_KEY, brokerId: broker.id, walletType: "BROKER", type: "GOLD_TO_STORE",
        amountCents: -amountCents, balanceAfterCents: updatedBroker.commissionBalanceCents,
        source: "CUSTOMER_ACCOUNT", sourceId: operationId, idempotencyKey: `ib-gold:${operationId}:broker`,
        description: "Nekudot Gold convertidos para comprar en Cohen's",
      },
      {
        programKey: NEKUDOT_PROGRAM_KEY, memberId, walletType: "CLIENT", type: "IB_GOLD_CONVERSION",
        amountCents, balanceAfterCents: updatedMember.balanceCents,
        source: "CUSTOMER_ACCOUNT", sourceId: operationId, idempotencyKey: `ib-gold:${operationId}:member`,
        description: "Nekudot Gold recibidos para comprar en Cohen's",
      },
    ] });
    return {
      amountCents,
      ibGoldAvailableCents: updatedBroker.commissionBalanceCents - updatedBroker.reservedWithdrawalCents,
      nekudotAvailableCents: updatedMember.balanceCents - updatedMember.reservedCents,
    };
  });
}

export async function requestIbGoldWithdrawal(memberId: string, amountValue: unknown) {
  const amountCents = parseAmountCents(amountValue);
  const { broker } = await ownedBroker(memberId);
  return db.$transaction(async (transaction) => {
    const current = await transaction.nekudotBroker.findUniqueOrThrow({ where: { id: broker.id } });
    const availableCents = current.commissionBalanceCents - current.reservedWithdrawalCents;
    if (amountCents > availableCents) throw new NekudotError("Tus Nekudot Gold disponibles no alcanzan.", 409);
    const request = await transaction.nekudotBrokerWithdrawal.create({
      data: { programKey: NEKUDOT_PROGRAM_KEY, brokerId: broker.id, amountCents, status: "REQUESTED" },
    });
    await transaction.nekudotBroker.update({
      where: { id: broker.id }, data: { reservedWithdrawalCents: { increment: amountCents } },
    });
    return request;
  });
}
