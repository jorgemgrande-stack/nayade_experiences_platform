/**
 * Ski Net · Alquiler (módulo del SDK). Núcleo mínimo: material por sede con tallas y existencias,
 * disponibilidad por fecha y alquileres (reserva → entrega → devolución, o cancelación).
 *
 * Licencia: capacidad `ski-rental` del catálogo (empresa o sede). Activación: por sede, en la BD de la
 * empresa (`ski_rental_sites`); desactivar no borra nada. Versión 0.x: no es Ski Net completo.
 */
import { defineSdkModule } from "../sdk";

export const SKI_RENTAL_ID = "ski_rental";

export type SkiRentalEvents = {
  "ski_rental.site.activated": { siteId: string };
  "ski_rental.site.deactivated": { siteId: string };
  "ski_rental.rental.created": { rentalId: number; itemId: number; quantity: number; startDate: string; endDate: string };
  "ski_rental.rental.returned": { rentalId: number; itemId: number };
};

export const skiRentalModule = defineSdkModule<SkiRentalEvents>({
  manifest: {
    id: SKI_RENTAL_ID,
    name: "Ski Net · Alquiler",
    version: "0.1.0",
    kind: "sector",
    coreRange: "^1.0.0",
    permissions: [
      { key: "ski_rental.view", description: "Consultar material, disponibilidad y alquileres" },
      { key: "ski_rental.manage", description: "Gestionar material, alquileres y la activación por sede" },
    ],
    description: "Alquiler de material de esquí por sede: tallas, existencias, disponibilidad y devoluciones",
    resources: ["http.request"],
    source: { location: "core" },
  },
  contract: "^1.1.0",
  capability: "ski-rental",
  siteScoped: true,
  events: ["ski_rental.site.activated", "ski_rental.site.deactivated", "ski_rental.rental.created", "ski_rental.rental.returned"],
});
