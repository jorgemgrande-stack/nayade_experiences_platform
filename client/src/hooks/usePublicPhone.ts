import { trpc } from "@/lib/trpc";

const CORRECT_PHONE = "+34 911 67 51 89";
const LEGACY_PHONE  = "+34 930 34 77 91"; // número antiguo hardcodeado — tratar como vacío

export function usePublicPhone() {
  const { data } = trpc.config.getPublicSettings.useQuery();
  const raw = data?.brand_phone;
  const phone = (raw && raw !== LEGACY_PHONE) ? raw : CORRECT_PHONE;
  const phoneTel = "tel:" + phone.replace(/[\s\-\(\)]/g, "");
  return { phone, phoneTel };
}
