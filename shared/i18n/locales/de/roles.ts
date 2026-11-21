import type { Mirror } from "../../core";
import type es from "../es/roles";

export default {
  admin: "Administrator",
  agente: "Vertrieb",
  monitor: "Trainer",
  adminrest: "Restaurantleitung",
  controler: "Controlling",
  readonly: "Nur Lesezugriff",
  user: "Benutzer",
  commercial_agent: "Vertrieb",
  sales_cashier: "Vertrieb + Kasse",
} satisfies Mirror<typeof es>;
