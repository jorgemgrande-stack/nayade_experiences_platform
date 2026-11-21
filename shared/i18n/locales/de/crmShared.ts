import type { Mirror } from "../../core";
import type es from "../es/crmShared";

export default {
  cancelar: "Abbrechen",
  cargando: "Wird geladen…",
  reintentar: "Erneut versuchen",
  quitarFiltros: "Filter entfernen",
  ningunResultadoConEstos: "Keine Ergebnisse mit diesen Filtern",
} satisfies Mirror<typeof es>;
