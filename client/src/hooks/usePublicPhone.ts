import { trpc } from "@/lib/trpc";

const CORRECT_PHONE = "+34 639 57 66 27";
// Números antiguos hardcodeados — tratar como vacío para que prevalezca el nuevo
const LEGACY_PHONES = ["+34 930 34 77 91", "+34 911 67 51 89"];

// Datos de la instalación original: solo en su propia web, nunca en la web neutra de otra empresa
const SINGLE_CONTACT = {
  brandName: "Náyade Experiences",
  email: "reservas@nayadeexperiences.es",
  address: "Los Ángeles de San Rafael, Segovia",
};

/**
 * Contacto de la web pública. En la web neutra de cada empresa, solo sus propios datos (vacíos si no los ha
 * configurado); mientras no se sabe qué web es, tampoco se muestran los de la instalación original.
 */
export function usePublicContact() {
  const { data } = trpc.config.getPublicSettings.useQuery();
  const theme = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  const t = theme.data;
  const neutral = t ? t.neutralSite : true;
  const raw = data?.brand_phone;
  const phone = neutral ? (t?.contact.phone ?? "") : (raw && !LEGACY_PHONES.includes(raw)) ? raw : CORRECT_PHONE;
  const phoneTel = phone ? "tel:" + phone.replace(/[\s\-\(\)]/g, "") : undefined;
  return {
    neutral,
    brandName: neutral ? (t?.brandName ?? "") : SINGLE_CONTACT.brandName,
    phone,
    phoneTel,
    email: neutral ? (t?.contact.email ?? "") : SINGLE_CONTACT.email,
    address: neutral ? (t?.contact.address ?? "") : SINGLE_CONTACT.address,
    /** Logo de la empresa en la web neutra (en la instalación original, cada página usa el suyo). */
    logoUrl: neutral ? (t?.logoUrl ?? null) : null,
    /** Imagen principal de la web de la empresa (en la instalación original, cada página usa la suya). */
    heroImage: neutral ? (t?.login.backgroundSource === "web" ? t.login.backgroundUrl : null) : null,
  };
}

export function usePublicPhone() {
  const { phone, phoneTel } = usePublicContact();
  return { phone, phoneTel };
}
