import { trpc } from "@/lib/trpc";

/**
 * Contacto de la web pública: nombre, teléfono, email y dirección de la propia empresa (sus ajustes, vía el tema
 * público), en cualquier modo. Sin un dato configurado, vacío: nunca los de otra empresa ni valores fijos.
 */
export function usePublicContact() {
  const theme = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  const t = theme.data;
  const neutral = t ? t.neutralSite : true;
  const phone = t?.contact.phone ?? "";
  const phoneTel = phone ? "tel:" + phone.replace(/[\s\-\(\)]/g, "") : undefined;
  return {
    neutral,
    brandName: t?.brandName ?? "",
    phone,
    phoneTel,
    email: t?.contact.email ?? "",
    address: t?.contact.address ?? "",
    /** Logo de la empresa en la web neutra (en la instalación de una sola empresa, cada página usa el suyo). */
    logoUrl: neutral ? (t?.logoUrl ?? null) : null,
    /** Imagen principal de la web de la empresa (en la instalación de una sola empresa, cada página usa la suya). */
    heroImage: neutral ? (t?.login.backgroundSource === "web" ? t.login.backgroundUrl : null) : null,
  };
}

export function usePublicPhone() {
  const { phone, phoneTel } = usePublicContact();
  return { phone, phoneTel };
}
