/**
 * Colores por significado del panel. Las pantallas piden un significado (éxito, aviso, error, información, neutro o
 * marca) y no un color: los valores viven en las variables `--success`, `--warning`, `--danger` e `--info` de
 * index.css (uno para el modo claro y otro para el oscuro, con contraste AA comprobado en `shared/panelTheme.ts`) y en
 * el color principal de la empresa (`--primary`). La guarda `server/panelColoresGuard.test.ts` impide volver a
 * escribir tonos fijos (azul, morado, naranja…) en las pantallas migradas.
 */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

/** Etiqueta o insignia: fondo suave, borde y texto. */
export const TONE_BADGE: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/40",
  warning: "bg-warning/10 text-warning border-warning/40",
  danger: "bg-danger/10 text-danger border-danger/40",
  info: "bg-info/10 text-info border-info/40",
  neutral: "bg-muted text-muted-foreground border-border",
  brand: "bg-primary/10 text-primary border-primary/40",
};

/** Texto o icono sobre el fondo de la página o de una tarjeta. */
export const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-muted-foreground",
  brand: "text-primary",
};

/** Aviso o recuadro: fondo muy suave y borde del tono; el texto va en `text-foreground`. */
export const TONE_SURFACE: Record<Tone, string> = {
  success: "border-success/40 bg-success/10",
  warning: "border-warning/50 bg-warning/10",
  danger: "border-danger/40 bg-danger/10",
  info: "border-info/40 bg-info/10",
  neutral: "border-border bg-muted/40",
  brand: "border-primary/40 bg-primary/10",
};
