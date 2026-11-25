/**
 * Etiquetas traducidas y formatos de las pantallas de Gestoría e Impuestos: nombre del modelo, estado de la obligación y su
 * tono, importes y fechas con el formato del idioma de la persona, y el texto «vence en N días». Solo presentación.
 */
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import type { Tone } from "@/lib/panelTones";
import { daysUntil } from "./taxLabels";

/** Estado de una obligación → tono (significado, no color fijo). */
export const STATUS_TONE: Record<string, Tone> = {
  pendiente: "neutral",
  estimado: "info",
  revisado: "brand",
  enviado_gestoria: "warning",
  presentado: "info",
  pagado: "success",
  aplazado: "warning",
  cerrado: "neutral",
};

/** Una obligación sigue abierta mientras no esté pagada ni cerrada. */
export const isOpenStatus = (status: string): boolean => status !== "pagado" && status !== "cerrado";

export function useGestoriaLabels() {
  const { t } = useI18n();
  const f = useFormat();

  const modelName = (model: string): string => {
    switch (model) {
      case "303": return t("gestoria.model.m303");
      case "390": return t("gestoria.model.m390");
      case "111": return t("gestoria.model.m111");
      case "190": return t("gestoria.model.m190");
      case "200": return t("gestoria.model.m200");
      case "202": return t("gestoria.model.m202");
      default: return model;
    }
  };
  /** «Modelo 303» (sin la descripción). */
  const modelShort = (model: string): string => t("gestoria.model.short", { model });

  const statusLabel = (status: string): string => {
    switch (status) {
      case "pendiente": return t("gestoria.status.pendiente");
      case "estimado": return t("gestoria.status.estimado");
      case "revisado": return t("gestoria.status.revisado");
      case "enviado_gestoria": return t("gestoria.status.enviado_gestoria");
      case "presentado": return t("gestoria.status.presentado");
      case "pagado": return t("gestoria.status.pagado");
      case "aplazado": return t("gestoria.status.aplazado");
      case "cerrado": return t("gestoria.status.cerrado");
      default: return status;
    }
  };

  const money = (n: number | string | null | undefined): string => f.currency(Number(n) || 0);
  /** Fecha «AAAA-MM-DD» del servidor con el formato del idioma. */
  const day = (iso: string | null | undefined): string => (iso ? f.date(new Date(iso + "T00:00:00")) : "—");

  /** «vence hoy», «en 5 días», «vencida hace 3 días». */
  const dueText = (days: number): string =>
    days === 0 ? t("gestoria.due.today") : days > 0 ? t("gestoria.due.inDays", { count: days }) : t("gestoria.due.overdueDays", { count: -days });

  /** Tono del plazo: rojo si está vencida o vence en una semana, aviso hasta tres semanas. */
  const dueTone = (days: number): Tone => (days < 0 || days <= 7 ? "danger" : days <= 21 ? "warning" : "neutral");

  return { t, f, modelName, modelShort, statusLabel, money, day, dueText, dueTone, daysUntil };
}
