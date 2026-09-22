export function exactCafeContactMatch(member: { email: string | null; phone: string | null }, customer: { email: string | null; phone: string | null }) {
  const email = (value: string | null) => (value || "").trim().toLowerCase();
  const phone = (value: string | null) => (value || "").replace(/\D/g, "");
  return Boolean((email(member.email) && email(member.email) === email(customer.email))
    || (phone(member.phone) && phone(member.phone) === phone(customer.phone)));
}

export function cafeWalletChoice(value: unknown): "nekudot" | "voucher" {
  if (value == null || value === "" || value === "nekudot") return "nekudot";
  if (value === "voucher") return "voucher";
  throw new Error("Selecciona Nekudot o vales comunitarios.");
}
