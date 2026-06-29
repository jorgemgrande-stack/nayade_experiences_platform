import { trpc } from "@/lib/trpc";

const CORRECT_PHONE = "+34 639 57 66 27";
// Números antiguos hardcodeados — tratar como vacío para que prevalezca el nuevo
const LEGACY_PHONES = ["+34 930 34 77 91", "+34 911 67 51 89"];

export function usePublicPhone() {
  const { data } = trpc.config.getPublicSettings.useQuery();
  const raw = data?.brand_phone;
  const phone = (raw && !LEGACY_PHONES.includes(raw)) ? raw : CORRECT_PHONE;
  const phoneTel = "tel:" + phone.replace(/[\s\-\(\)]/g, "");
  return { phone, phoneTel };
}
