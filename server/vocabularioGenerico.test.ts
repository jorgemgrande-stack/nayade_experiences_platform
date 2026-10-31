/**
 * Vocabulario genérico del panel (Elephant Core v2): una pyme con licencias por capacidad no ve términos
 * de Náyade (leads, reservas, experiencias, actividades, REAV, Lego packs, Redsys…) salvo que tenga el
 * módulo correspondiente; la instalación propia de Náyade conserva sus textos de siempre.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVocabulary, visibleCrmTabs, type Vocabulary } from "../shared/vocabulary";
import { validateContact, validateOrder, validateQuote, hasErrors } from "../shared/crmForms";
import { vocabularyFromOverview } from "./panelVocabulary";

const NAYADE_TERMS = /\b(lead|leads|reserva|reservas|experiencia|experiencias|actividad|actividades|REAV|lego|redsys|hotel|spa|pack|pipeline|bonos?)\b/i;

/** Todos los textos de un vocabulario (incluidas las concordancias y los tipos de producto). */
function texts(v: Vocabulary): string[] {
  const out: string[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out.push(`${k}=${val}`);
    else if (typeof val === "function") out.push(`${k}=${(val as (a: string, b: string) => string)("M", "F")}`);
    else if (Array.isArray(val)) for (const o of val) out.push(`${k}=${o.label}`);
  }
  return out;
}

const TABS = ["leads", "quotes", "reservations", "invoices", "anulaciones", "pagos_pendientes", "bonos"] as const;
const essential = new Set(["crm-contacts", "crm-leads", "crm-quotes", "shop-orders", "shop-catalog", "bill-invoices", "bill-payments"]);
const canEssential = (id: string) => essential.has(id);

describe("diccionario de textos por modo", () => {
  it("instalación propia (Náyade): los textos de siempre", () => {
    const v = buildVocabulary({ licensed: false });
    expect(v.leads).toBe("Leads");
    expect(v.orders).toBe("Reservas");
    expect(v.newOrder).toBe("Nueva Reserva");
    expect(v.productRequired).toBe("Experiencia o pack *");
    expect(v.serviceDate).toBe("Fecha de la actividad");
    expect(v.serviceDateShort).toBe("F. Actividad");
    expect(v.interests).toBe("Actividades de interés");
    expect(v.pendingPayments).toBe("Pagos Pendientes");
    expect(v.coupons).toBe("Bonos");
    expect(v.crmTitle).toBe("CRM Comercial");
    expect(v.crmSubtitle).toBe("Pipeline completo Lead → Presupuesto → Reserva → Factura");
    expect(v.upcomingOrders).toBe("Reservas mañana");
    expect(v.leadsUnattended).toBe("Leads sin atender");
    expect(v.agree("creado", "creada")).toBe("creada");
    expect(v.showReav).toBe(true);
    expect(v.showCoupons).toBe(true);
    expect(v.productTypes.map((o) => o.label)).toEqual(["Actividad / Experiencia", "Alojamiento", "Restauración", "Transporte", "Pack combinado"]);
  });

  it("pyme: términos genéricos", () => {
    const v = buildVocabulary({ licensed: true, can: canEssential });
    expect(v.leads).toBe("Oportunidades");
    expect(v.quotes).toBe("Presupuestos");
    expect(v.orders).toBe("Pedidos");
    expect(v.invoices).toBe("Facturas");
    expect(v.cancellations).toBe("Anulaciones y abonos");
    expect(v.pendingPayments).toBe("Cobros pendientes");
    expect(v.newOrder).toBe("Nuevo pedido");
    expect(v.productRequired).toBe("Producto o servicio *");
    expect(v.serviceDate).toBe("Fecha de servicio");
    expect(v.agree("creado", "creada")).toBe("creado");
    expect(v.agreeLead("creado", "creada")).toBe("creada");
    expect(v.leadsUnattended).toBe("Oportunidades sin atender");
    expect(v.upcomingOrders).toBe("Pedidos para mañana");
  });

  it("pyme sin módulos sectoriales: ningún texto de Náyade", () => {
    const offending = texts(buildVocabulary({ licensed: true, can: canEssential })).filter((t) => NAYADE_TERMS.test(t.split("=")[1]));
    expect(offending).toEqual([]);
  });

  it("instalación propia: el vocabulario sí usa sus términos (control del detector)", () => {
    expect(texts(buildVocabulary({ licensed: false })).some((t) => NAYADE_TERMS.test(t))).toBe(true);
  });

  it("REAV y cupones solo con su módulo contratado", () => {
    expect(buildVocabulary({ licensed: true, can: canEssential }).showReav).toBe(false);
    expect(buildVocabulary({ licensed: true, can: canEssential }).showCoupons).toBe(false);
    expect(buildVocabulary({ licensed: true, can: (id) => id === "travel-net" }).showReav).toBe(true);
    expect(buildVocabulary({ licensed: true, can: (id) => id === "deals-coupons" }).showCoupons).toBe(true);
  });

  it("tipos de producto de una pyme: Producto y Servicio; los sectoriales solo con módulo", () => {
    const base = buildVocabulary({ licensed: true, can: canEssential }).productTypes;
    expect(base.map((o) => o.label)).toEqual(["Servicio", "Producto", "Paquete de varios productos"]);
    // Los valores son los que ya acepta la base de datos (sin migraciones)
    const allowed = ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"];
    expect(base.every((o) => allowed.includes(o.value))).toBe(true);
    const hotel = buildVocabulary({ licensed: true, can: (id) => id === "hotel-net" }).productTypes.map((o) => o.label);
    expect(hotel).toContain("Alojamiento");
    expect(hotel).not.toContain("Restauración");
    const rest = buildVocabulary({ licensed: true, can: (id) => id === "restaurant-net" }).productTypes.map((o) => o.label);
    expect(rest).toContain("Restauración");
  });
});

describe("pestañas del CRM según licencias (igual que el menú)", () => {
  it("instalación propia: todas", () => {
    expect(visibleCrmTabs(TABS, { licensed: false })).toEqual([...TABS]);
  });
  it("pyme Essential: sin Bonos (cuponeras)", () => {
    expect(visibleCrmTabs(TABS, { licensed: true, can: canEssential })).toEqual(["leads", "quotes", "reservations", "invoices", "anulaciones", "pagos_pendientes"]);
  });
  it("pyme con cuponeras: con Bonos", () => {
    expect(visibleCrmTabs(TABS, { licensed: true, can: (id) => id === "deals-coupons" || canEssential(id) })).toContain("bonos");
  });
  it("pyme sin facturación: sin facturas, anulaciones ni cobros", () => {
    const v = visibleCrmTabs(TABS, { licensed: true, can: (id) => ["crm-leads", "crm-quotes", "shop-orders"].includes(id) });
    expect(v).toEqual(["leads", "quotes", "reservations"]);
  });
});

describe("vocabulario del servidor (avisos de la campana)", () => {
  it("sin licencias por capacidad: el de siempre", () => {
    expect(vocabularyFromOverview(null).leadsUnattended).toBe("Leads sin atender");
    expect(vocabularyFromOverview({ licensing: "legacy", visible: [] }).upcomingOrders).toBe("Reservas mañana");
  });
  it("con licencias por capacidad: genérico y con sus módulos", () => {
    const v = vocabularyFromOverview({ licensing: "capabilities", visible: ["crm-leads", "travel-net"] });
    expect(v.leadsUnattended).toBe("Oportunidades sin atender");
    expect(v.upcomingOrders).toBe("Pedidos para mañana");
    expect(v.showReav).toBe(true);
    expect(v.showCoupons).toBe(false);
  });
});

describe("validación por campo de los formularios del CRM", () => {
  it("contacto: nombre y correo obligatorios; teléfono válido si se indica", () => {
    const e = validateContact({ name: " ", email: "", phone: "12" });
    expect(e.name).toBeTruthy();
    expect(e.email).toBeTruthy();
    expect(e.phone).toBeTruthy();
    expect(hasErrors(validateContact({ name: "Ana", email: "ana@empresa.com", phone: "+34 600 000 000" }))).toBe(false);
    expect(validateContact({ name: "Ana", email: "no-es-correo" }).email).toMatch(/no es válido/);
  });
  it("pedido: producto del catálogo, fecha e importe", () => {
    const e = validateOrder({ name: "Ana", email: "ana@empresa.com", productId: null, bookingDate: "", amount: Number.NaN }, { date: "Fecha de servicio" });
    expect(e.product).toBeTruthy();
    expect(e.date).toBe("Indica la fecha de servicio.");
    expect(e.amount).toBeTruthy();
    expect(hasErrors(validateOrder({ name: "Ana", email: "ana@empresa.com", productId: 3, bookingDate: "2026-11-02", amount: 0 }, { date: "Fecha de servicio" }))).toBe(false);
  });
  it("presupuesto: al menos una línea completa", () => {
    expect(validateQuote({ name: "Ana", email: "ana@empresa.com", hasLines: false }).lines).toBeTruthy();
    expect(hasErrors(validateQuote({ name: "Ana", email: "ana@empresa.com", hasLines: true }))).toBe(false);
  });
});

// ── Cableado: los textos de Náyade del CRM y del catálogo salen del diccionario, no fijos ─────────────
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("cableado de las pantallas (texto de Náyade no fijo en modo pyme)", () => {
  const crm = read("client/src/pages/admin/crm/CRMDashboard.tsx");

  it("CRM: pestañas, título y botones salen del vocabulario", () => {
    for (const fixed of [
      `label: "Leads"`, `label: "Reservas"`, `label: "Bonos"`, `label: "Pagos Pendientes"`,
      `title="CRM Comercial"`, `>CRM Comercial<`, `Pipeline completo Lead`,
      `/> Nueva Reserva`, `/> Nuevo Lead`, `>Experiencia o pack *<`, `>F. Actividad<`, `>Actividades de interés<`,
      `>Fecha de la actividad<`, '"Reserva ${data.merchantOrder} creada',
    ]) {
      expect(crm, fixed).not.toContain(fixed);
    }
    expect(crm).toContain("visibleCrmTabs(");
    expect(crm).toContain(".filter(({ key }) => visibleTabs.includes(key))");
  });

  it("CRM: el pago con Redsys «legacy» no se ofrece a una pyme", () => {
    expect(crm).toMatch(/\{!voc\.licensed && <SelectItem value="redsys"/);
  });

  it("CRM: sin confirm() del navegador ni mensajes técnicos del servidor en avisos", () => {
    expect(crm).not.toMatch(/(?<![\w`])confirm\((?!\))/);
    expect(crm).not.toMatch(/toast\.error\(e(rr)?\.message\)/);
    expect(crm).toContain("<ConfirmDialog");
    expect(crm).toContain(`from "@/lib/errorMessage"`);
  });

  it("CRM: el alta de pedido busca productos en el servidor según lo escrito", () => {
    expect(crm).not.toContain(`crm.products.search.useQuery({ q: "", limit: 100 })`);
    expect(crm).toContain("q: productQuery || undefined");
  });

  it("CRM: formularios de alta con etiquetas asociadas y errores por campo", () => {
    for (const id of ["new-lead-name", "new-lead-email", "new-order-email", "new-order-product", "new-order-date", "new-quote-name", "new-quote-email", "new-client-name", "new-client-email"]) {
      expect(crm, id).toContain(`htmlFor="${id}"`);
      expect(crm, id).toContain(`id="${id}"`);
    }
    expect(crm).toContain("aria-describedby");
  });

  it("catálogo, portada y contabilidad: términos sectoriales según el modo", () => {
    const exp = read("client/src/pages/admin/products/ExperiencesManager.tsx");
    expect(exp).not.toContain(`toast.success("Experiencia desactivada")`);
    expect(exp).not.toContain(`> Clonar experiencia`);
    expect(exp).toContain("voc.productTypes");
    const slides = read("client/src/pages/admin/cms/SlideshowManager.tsx");
    expect(slides).not.toMatch(/Slideshow"|Nuevo Slide|Crear slide/);
    expect(read("client/src/pages/admin/accounting/AccountingReports.tsx")).toContain("voc.showReav &&");
    expect(read("client/src/pages/admin/accounting/TransactionsList.tsx")).toContain(`{voc.showReav && <SelectItem value="reav">`);
    expect(read("client/src/pages/admin/cms/PagesManager.tsx")).not.toContain("En Desarrollo");
    expect(read("server/routers/notifications.ts")).toContain("voc.leadsUnattended");
  });
});
