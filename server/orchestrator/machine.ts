/** Transiciones permitidas del pedido comercial (ver ./types.ts). Nada fuera de esta tabla. */
import type { OrderState } from "./types";

export type OrderAction =
  | "quote"
  | "sign"
  | "confirm"
  | "subscribe"
  | "license"
  | "activate"
  | "payment_failed"
  | "payment_recovered"
  | "suspend"
  | "cancel"
  | "cancelled"
  | "supersede"
  | "reject";

const LIVE: OrderState[] = ["active", "past_due", "suspended"];

export const ORDER_TRANSITIONS: Record<OrderAction, { from: readonly OrderState[]; to: OrderState }> = {
  quote: { from: ["requested"], to: "quoted" },
  sign: { from: ["quoted"], to: "contracted" },
  confirm: { from: ["contracted"], to: "confirmed" },
  subscribe: { from: ["confirmed"], to: "subscribed" },
  license: { from: ["subscribed"], to: "licensed" },
  activate: { from: ["licensed"], to: "active" },
  payment_failed: { from: ["active"], to: "past_due" },
  payment_recovered: { from: ["past_due", "suspended"], to: "active" },
  suspend: { from: ["past_due"], to: "suspended" },
  cancel: { from: LIVE, to: "cancel_scheduled" },
  cancelled: { from: ["cancel_scheduled"], to: "cancelled" },
  supersede: { from: [...LIVE, "cancel_scheduled"], to: "superseded" },
  reject: { from: ["requested", "quoted", "contracted"], to: "rejected" },
};

/** Estado de destino, o null si la acción no se permite desde `from`. */
export function nextOrderState(from: OrderState, action: OrderAction): OrderState | null {
  const t = ORDER_TRANSITIONS[action];
  return t.from.includes(from) ? t.to : null;
}
