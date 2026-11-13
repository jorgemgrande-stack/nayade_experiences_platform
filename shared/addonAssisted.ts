/**
 * Ampliaciones de capacidad del Core con contratación asistida (decisión del 13/11/2026: «todas las ampliaciones del
 * Marketplace se pueden contratar»). Fase 1: «Contratar e iniciar implantación», el mismo circuito que Elephant Net y
 * Connect (solicitud en el CRM → expediente de implantación → condiciones personalizadas con aceptación; sin cobro en el
 * panel). Al aceptar el contrato, las unidades se suman a los límites de la empresa (server/licensing/service.ts).
 *
 * Fase 2 (cuando existan los precios de Stripe): la compra en línea de siempre («Ampliar»). Una ampliación
 * `available` y comprable sigue esa regla, no la asistida (shared/netOffer.ts → offerSaleKind).
 *
 * Mismo formato que shared/connectAssisted.ts. Solo se listan cosas que existen hoy. Lógica pura.
 */
import type { NetArea, NetFeature } from "./netProducts";
import { connectAssistedOf, type ConnectAssistedProduct } from "./connectAssisted";

/** `plans`: los planes a los que amplía (los mismos que el catálogo, `addonFor.plans`); sin ellos, todos. */
export type AddonAssistedProduct = ConnectAssistedProduct & { plans?: readonly string[] };

const A = (label: string): NetFeature => ({ label, status: "available" });
const area = (title: string, ...features: NetFeature[]): NetArea => ({ title, features });

const NOTE = "Se aplica a los límites de tu empresa al aceptar el contrato. Se factura por unidad al mes, IVA aparte.";

const USER = (plan: string): NetArea[] => [area("Usuario adicional", A("Un usuario más con acceso al panel de tu empresa"), A(`Se suma al límite de usuarios de tu plan ${plan}`))];
const STORAGE: NetArea[] = [area("Almacenamiento adicional", A("10 GB más de almacenamiento para archivos, imágenes y documentos"), A("Se suma a la cuota de almacenamiento de tu plan"))];
// Lo que hoy ofrece una sede (server/commerce/panelSites.ts, SitesManager y UserSitesPanel): datos de la sede, equipo
// asignado por sede y cajas por sede
const SITE: NetArea[] = [
  area(
    "Sede adicional",
    A("Una sede más en tu panel, con su nombre, dirección, teléfono y correo"),
    A("Cada persona del equipo trabaja en las sedes que le asignes"),
    A("Cajas y filtros por sede en el panel"),
    A("Se suma al límite de sedes de tu plan Business"),
  ),
];

export const ADDON_ASSISTED: readonly AddonAssistedProduct[] = [
  { key: "addon-user-essential", name: "Usuario adicional Essential", segment: "business", plans: ["essential"], areas: USER("Essential"), note: NOTE },
  { key: "addon-user-business", name: "Usuario adicional Business", segment: "business", plans: ["business"], areas: USER("Business"), note: NOTE },
  { key: "addon-storage-10gb", name: "Almacenamiento adicional 10 GB", segment: "business", areas: STORAGE, note: NOTE },
  { key: "addon-site-business", name: "Sede adicional Business", segment: "business", plans: ["business"], areas: SITE, note: NOTE },
];

const BY_KEY = new Map(ADDON_ASSISTED.map((p) => [p.key, p]));
/** Ampliación de capacidad con contratación asistida; null si no lo es. */
export function addonAssistedOf(key: string): AddonAssistedProduct | null {
  return BY_KEY.get(key) ?? null;
}

/** Registro de contratación asistida fuera de Net: Connect asistido o ampliación de capacidad. null si no está. */
export function assistedRegistryOf(key: string): ConnectAssistedProduct | null {
  return connectAssistedOf(key) ?? addonAssistedOf(key);
}
