import { trpc } from "@/lib/trpc";

const FALLBACK_PHONE = "+34 911 67 51 89";

export function usePublicPhone() {
  const { data } = trpc.config.getPublicSettings.useQuery();
  const phone = data?.brand_phone || FALLBACK_PHONE;
  const phoneTel = "tel:" + phone.replace(/[\s\-\(\)]/g, "");
  return { phone, phoneTel };
}
