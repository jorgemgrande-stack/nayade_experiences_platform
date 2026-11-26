import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useSiteLocale } from "@/hooks/useSiteLocale";
import { checkoutConfigFrom, type CheckoutConfig } from "@shared/checkoutExtras";

const KEY = "be_buyer_locale";

/** Páginas sin prefijo de idioma que usa quien compra: el idioma es el de la web en que estaba al añadir al carrito. */
const isBuyerFlowPath = (p: string) => p === "/checkout" || p.startsWith("/reserva/");

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Idioma de quien compra (carrito, pago y retorno del pago). En las páginas de la web es el de la URL y se recuerda;
 * en /checkout y /reserva/* (sin prefijo de idioma) es el recordado, con respaldo al principal de la empresa.
 */
export function useBuyerLocale(): string {
  const [location] = useLocation();
  const site = useSiteLocale();
  const flow = isBuyerFlowPath(location);
  useEffect(() => {
    if (flow || site.isLoading) return;
    try {
      localStorage.setItem(KEY, site.locale);
    } catch {
      /* sin almacenamiento: se usa el idioma de la página */
    }
  }, [flow, site.locale, site.isLoading]);
  if (!flow) return site.locale;
  const remembered = read();
  return remembered && (!site.multilingual || site.locales.includes(remembered)) ? remembered : site.locale;
}

/** Ajustes del pago de la empresa (condiciones y participantes). Sin configurar, nada se exige. */
export function useCheckoutConfig(): CheckoutConfig {
  const q = trpc.config.getPublicSettings.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  return checkoutConfigFrom(q.data ?? {});
}
