/**
 * Genera CATALOGO_COMERCIAL_MAESTRO_BIG_ELEPHANT.md a partir de una sola fuente: la semilla del catálogo
 * (precios, unidades, estados, cupos), las especificaciones comerciales y la política de planes.
 *
 * Uso: npx tsx scripts/catalog/export-commercial-master.ts <ruta-de-salida.md>
 * Solo escribe el fichero indicado; no toca bases de datos ni servicios.
 */
import { writeFileSync } from "node:fs";
import { CATALOG_VERSION, PRODUCTS, type SeedProduct } from "../../server/catalog/elephantSourceV1";
import { COMMERCIAL_STATUS_LABEL } from "../../server/web/schemas";
import { PRODUCT_SPECS, PROPOSED_IMPLEMENTATION_SERVICES, type ProductSpec } from "../../server/catalog/commercial/specs";
import { PROPOSED_POLICY } from "../../server/catalog/commercial/policy";
import { validateSpecs } from "../../server/catalog/commercial/validateSpecs";

const out = process.argv[2];
if (!out) throw new Error("Indica la ruta de salida");
const issues = validateSpecs(PRODUCTS, PRODUCT_SPECS, PROPOSED_POLICY);
if (issues.length) throw new Error(`El catálogo comercial tiene incidencias:\n${issues.join("\n")}`);

const SPEC = new Map(PRODUCT_SPECS.map((s) => [s.key, s]));
const BY = new Map(PRODUCTS.map((p) => [p.key, p]));
/** Importe con separador de miles español también en cifras de cuatro dígitos (1.899 €). */
const euros = (c: number) => `${(c / 100).toFixed(c % 100 ? 2 : 0).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;
const nameOf = (k: string) => BY.get(k)?.draft.name ?? k;
const list = (xs: string[]) => (xs.length ? xs.join("; ") : "—");
const CAT_LABEL: Record<ProductSpec["category"], string> = {
  plan: "Plan de plataforma",
  sector_module: "Solución sectorial (módulo)",
  sector_bundle: "Solución sectorial (paquete)",
  extension: "Extensión",
  extension_bundle: "Paquete de extensiones",
  extra: "Extensión (extra)",
  capacity: "Capacidad adicional",
  service: "Servicio complementario",
};
const LEVEL = { 1: "1 · Activable por el equipo (código en el Core)", 2: "2 · Implantación con portado o adaptación", 3: "3 · Desarrollo nuevo" } as const;
const GRADE = { in_use: "En uso", partial: "Parcial", prototype: "Prototipo o diseño", none: "Sin desarrollo" } as const;
const CTA = { demo: "Solicitar demostración", contact: "Hablar con ventas", waitlist: "Avísame" } as const;

function price(p: SeedProduct): string {
  const m = p.prices.find((x) => x.kind === "monthly");
  const y = p.prices.find((x) => x.kind === "yearly");
  if (!m && !y) return "Según extensión y proveedor";
  const from = p.key === "enterprise" ? "desde " : "";
  return [m && `${from}${euros(m.amountCents)}/mes`, y && `${from}${euros(y.amountCents)}/año`].filter(Boolean).join(" · ");
}
function unit(p: SeedProduct): string {
  return p.draft.catalog.chargeUnit ?? (p.draft.catalog.scope === "site" ? "por sede" : p.family === "addon" ? "por unidad" : "por empresa");
}
function plansOf(p: SeedProduct): string {
  if (p.family === "core_plan") return "—";
  if (p.draft.catalog.addonFor?.plans.length) return p.draft.catalog.addonFor.plans.map(nameOf).join(", ");
  return p.draft.compatibleWith.length ? p.draft.compatibleWith.map(nameOf).join(", ") : "Essential, Business y Enterprise";
}
function inclusionText(key: string): string {
  const incs = PROPOSED_POLICY.inclusions.filter((i) => i.key === key || BY.get(i.key)?.draft.catalog.bundleOf.includes(key));
  if (!incs.length) return "Adicional en todos los planes";
  return incs.map((i) => `${nameOf(i.plan)}: ${i.mode === "full" ? "incluida" : `incluida en parte (tope: ${i.cap?.status === "approved" ? "aprobado" : "regla propuesta"})`}${i.key !== key ? ` (en ${nameOf(i.key)})` : ""} [${i.status === "approved" ? "decisión aprobada" : "regla propuesta"}]`).join("; ");
}
function capacity(p: SeedProduct, s: ProductSpec): string {
  const q = p.draft.catalog.quotas.map((x) => `${x.metric}: ${x.included === null ? "por contrato" : x.included}`);
  return list([...q, ...s.capacityRules]);
}
function conditions(p: SeedProduct): string {
  const c: string[] = [];
  if (p.family !== "core_plan") c.push("Requiere un plan");
  if (p.draft.catalog.bundleOf.length) c.push(`Sustituye a sus componentes: ${p.draft.catalog.bundleOf.map(nameOf).join(", ")}`);
  if (p.draft.dependencies.length) c.push(`Requiere ${p.draft.dependencies.map(nameOf).join(", ")}`);
  if (p.draft.requirements.length) c.push(...p.draft.requirements);
  if (p.draft.thirdPartyCosts) c.push(p.draft.thirdPartyCosts);
  c.push(p.family === "core_plan" ? "Mensual o anual" : "Mensual (sin tarifa anual)");
  return list(c);
}
function activation(p: SeedProduct, s: ProductSpec): string {
  const st = p.draft.catalog.commercialStatus;
  if (st === "available") return "Activación automática al contratar";
  return `Implantación acompañada, nivel ${LEVEL[s.implementation.level]}. Activación por el equipo, componente a componente`;
}

function block(p: SeedProduct): string {
  const s = SPEC.get(p.key)!;
  const rows: Array<[string, string]> = [
    ["1. Identificador interno", `\`${p.key}\``],
    ["2. Nombre comercial", p.draft.name],
    ["3. Categoría", `${CAT_LABEL[s.category]} (familia \`${p.family}\`${p.draft.catalog.group ? `, grupo \`${p.draft.catalog.group}\`` : ""})`],
    ["4. Descripción corta", p.draft.tagline || "—"],
    ["5. Descripción completa", s.longDescription],
    ["6. Problema que resuelve", s.problem],
    ["7. Perfil de cliente", p.draft.presentation.forWho ?? s.forWho],
    ["8. Funcionalidades incluidas", list(s.includes)],
    ["9. Funcionalidades excluidas", list(s.excludes)],
    ["10. Dependencias", p.draft.dependencies.length ? p.draft.dependencies.map(nameOf).join(", ") : "Ninguna declarada"],
    ["11. Extensiones compatibles", s.compatibleExtensions.length ? s.compatibleExtensions.map(nameOf).join(", ") : "—"],
    ["12. Planes compatibles", plansOf(p)],
    ["13. Precio actual (catálogo)", price(p)],
    ["14. Unidad de facturación", unit(p)],
    ["15. Periodicidad", p.prices.some((x) => x.kind === "yearly") ? "Mensual o anual" : "Mensual"],
    ["16. Reglas de capacidad", capacity(p, s)],
    ["17. Condiciones de contratación", conditions(p)],
    ["18. Modalidad de activación", activation(p, s)],
    ["19. Requisitos de implantación", list(s.implementation.requirements)],
    ["20. Integraciones necesarias", list(s.integrations)],
    ["21. Estado funcional verificado", `${GRADE[s.verified.grade]} (técnico en catálogo: \`${p.draft.technicalStatus}\`). ${s.verified.evidence}. Origen: ${list(s.implementation.sources)}`],
    ["22. Disponibilidad comercial", `${COMMERCIAL_STATUS_LABEL[p.draft.catalog.commercialStatus]} (\`${p.draft.catalog.commercialStatus}\`)`],
    ["23. Contenido público", `«${s.publicContent.headline}» · ${list(s.publicContent.benefits)} · Llamada a la acción: ${CTA[s.publicContent.cta]}`],
    ["24. Información administrativa", list([`Inclusión en planes: ${p.family === "core_plan" ? "—" : inclusionText(p.key)}`, ...(s.admin.notes ? [s.admin.notes] : []), ...s.admin.pendingDecisions.map((d) => `Pendiente: ${d}`)])],
    ["25. Metadatos SEO", `slug \`${s.seo.slug}\` · título «${s.seo.title}» · descripción «${s.seo.description}»`],
  ];
  return [`### ${p.draft.name} — \`${p.key}\``, "", "| Campo | Valor |", "|---|---|", ...rows.map(([a, b]) => `| ${a} | ${b.replace(/\|/g, "\\|")} |`), ""].join("\n");
}

const SECTIONS: Array<[string, (p: SeedProduct) => boolean]> = [
  ["2. Planes de plataforma", (p) => p.family === "core_plan"],
  ["3. Soluciones sectoriales", (p) => p.family === "net_module" || p.family === "net_bundle"],
  ["4. Extensiones", (p) => p.family === "connect" || p.family === "extra"],
  ["5. Paquetes de extensiones", (p) => p.family === "connect_bundle"],
  ["6. Capacidades adicionales", (p) => p.family === "addon"],
  ["7. Servicios complementarios", (p) => p.family === "service"],
];

const index = PRODUCTS.map((p) => `| \`${p.key}\` | ${p.draft.name} | ${CAT_LABEL[SPEC.get(p.key)!.category]} | ${price(p)} | ${unit(p)} | ${COMMERCIAL_STATUS_LABEL[p.draft.catalog.commercialStatus]} | ${SPEC.get(p.key)!.implementation.level} |`);
const doc = [
  "# Catálogo comercial maestro — Big Elephant",
  "",
  `**Generado** desde la semilla del catálogo (\`${CATALOG_VERSION}\`), las especificaciones comerciales (\`server/catalog/commercial/specs.ts\`) y la política de planes propuesta (\`${PROPOSED_POLICY.id}\`), en la rama local \`feat/catalogo-comercial-unificado\`. No edites este fichero a mano: se regenera con \`npx tsx scripts/catalog/export-commercial-master.ts <salida>\`.`,
  "",
  "**Reglas de lectura.**",
  "- Precios sin IVA (21 % aparte), tomados del catálogo; nunca se escriben en las especificaciones.",
  "- «Decisión aprobada» = decidido por el propietario; «regla propuesta» = pendiente de aprobación. Ninguna está activa en el cotizador publicado.",
  "- Nivel de implantación: 1 activable por el equipo · 2 con portado o adaptación desde otro repositorio · 3 desarrollo nuevo.",
  "- Ningún producto está en «Disponible» (autoservicio): todo se contrata con implantación acompañada o queda en «Avísame».",
  "",
  "## 1. Índice",
  "",
  `${PRODUCTS.length} productos: ${SECTIONS.map(([t, f]) => `${PRODUCTS.filter(f).length} en «${t.replace(/^\d+\. /, "")}»`).join(", ")}.`,
  "",
  "| Clave | Nombre | Categoría | Precio | Unidad | Disponibilidad | Nivel |",
  "|---|---|---|---|---|---|---|",
  ...index,
  "",
  "### 1.1 Inclusiones por plan (política propuesta)",
  "",
  "| Plan | Producto | Modo | Estado | Lo que no cubre |",
  "|---|---|---|---|---|",
  ...PROPOSED_POLICY.inclusions.map((i) => `| ${nameOf(i.plan)} | ${nameOf(i.key)} | ${i.mode === "full" ? "Completa" : `Parcial: ${i.cap?.base} empleados${i.cap?.plusExtraOf ? " + usuarios adicionales" : ""} (tope: ${i.cap?.status === "approved" ? "aprobado" : "regla propuesta"})`} | ${i.status === "approved" ? "Decisión aprobada" : "Regla propuesta"} | ${i.excludes ?? "—"} |`),
  "",
  `Cupos base de Enterprise (regla propuesta, pendiente de ratificación): ${PROPOSED_POLICY.quotaOverrides.map((q) => `${q.metric} ${q.included.toLocaleString("es-ES")}`).join(", ")}. Por encima de la base: por presupuesto (no hay tarifa de ampliación aprobada para Enterprise).`,
  "",
  `Regla de paquetes con componentes incluidos (regla propuesta): ${PROPOSED_POLICY.bundleRule.kind === "min2" ? "el paquete conserva su descuento, proporcional, solo si quedan al menos dos componentes facturables; con uno, tarifa individual" : "la del catálogo"}.`,
  "",
  ...SECTIONS.flatMap(([title, f]) => [`## ${title}`, "", ...PRODUCTS.filter(f).map(block)]),
  "## 8. Implantaciones (propuesta: no existen en el catálogo)",
  "",
  "No se crean como productos hasta aprobar su tarifa. Mientras tanto, toda implantación se presupuesta.",
  "",
  "| Clave propuesta | Nombre | Unidad | Precio |",
  "|---|---|---|---|",
  ...PROPOSED_IMPLEMENTATION_SERVICES.map((x) => `| \`${x.key}\` | ${x.name} | ${x.unit} | Pendiente |`),
  "",
].join("\n");
writeFileSync(out, doc, "utf8");
console.log(`Catálogo maestro escrito en ${out} (${PRODUCTS.length} productos)`);
