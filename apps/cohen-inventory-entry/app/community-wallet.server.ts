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
  if (cents < 100) throw new NekudotError("La cantidad mínima es $1.00 MXN.");
  return cents;
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
