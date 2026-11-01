/**
 * Canal comercial SIMULADO para las pruebas del marketplace (solo pruebas: nada de esto es contenido real). Productos
 * con la forma exacta del canal de la Ventana 2 (`card: PanelCard | null`, PR #567): ficha completa, parcial (textos y
 * listas vacíos), sin ficha (null) y con campos raros; en los cuatro estados y para Connect y Net.
 */
import type { ChannelCatalogItem } from "./connectMarketplace";

const eur = (n: number) => ({ amountCents: Math.round(n * 100), currency: "EUR", taxIncluded: false, unit: null });
const prices = (monthly: number, yearly?: number) => [
  { kind: "monthly", amountCents: Math.round(monthly * 100), currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false },
  ...(yearly ? [{ kind: "yearly", amountCents: Math.round(yearly * 100), currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false }] : []),
];

/** Ficha vacía tal como la manda el canal cuando un producto no tiene contenido comercial propio. */
export const emptyCard = () => ({
  tagline: "",
  description: "",
  includes: [] as string[],
  requirements: [] as string[],
  dependencies: [] as string[],
  compatibleWith: [] as string[],
  thirdPartyCosts: null,
  group: null,
  presentation: { icon: null, color: null, highlight: false, forWho: null },
  commercial: null as unknown,
  offer: null as unknown,
  prices: [] as unknown[],
});

const commercial = (o: { headline: string; value: string; benefits: string[]; related?: string[]; faq?: Array<{ q: string; a: string }> }) => ({
  headline: o.headline,
  valueProposition: o.value,
  longDescription: "Texto largo de prueba del canal simulado.",
  problem: "Problema de prueba que resuelve el producto.",
  forWho: "Empresas de prueba del canal simulado.",
  benefits: o.benefits,
  excludes: ["Exclusión de prueba"],
  integrations: ["Integración de prueba"],
  coreIntegration: ["Usa los clientes de tu Elephant Core (prueba)", "Aparece en tu menú al activarse (prueba)"],
  compatibleExtensions: [] as string[],
  terms: { commitment: "Sin permanencia (prueba)", cancellation: "Baja al final del periodo (prueba)", activation: "En 48 horas (prueba)" },
  faq: o.faq ?? [{ q: "¿Pregunta de prueba?", a: "Respuesta de prueba del canal simulado." }],
  related: o.related ?? [],
  media: { cover: null, screenshots: [] as unknown[] },
  cta: "proposal",
  seo: null,
});

export const SIM_CATALOG: { purchasesEnabled: boolean; items: ChannelCatalogItem[] } = {
  purchasesEnabled: false,
  items: [
    // ── Elephant Connect ──
    {
      key: "connect-campaigns",
      name: "Elephant Campaigns",
      family: "connect",
      kind: "module",
      metric: null,
      step: null,
      commercialStatus: "available",
      capabilities: ["email-campaigns"],
      monthly: eur(19),
      purchasable: false,
      card: {
        ...emptyCard(),
        tagline: "Lema de prueba (ficha completa)",
        includes: ["Incluye A (prueba)", "Incluye B (prueba)"],
        group: "marketing",
        presentation: { icon: "megaphone", color: "var(--ink)", highlight: true, forWho: null },
        commercial: commercial({ headline: "Titular de prueba: ficha completa", value: "Propuesta de valor de prueba.", benefits: ["Beneficio 1 (prueba)", "Beneficio 2 (prueba)", "Beneficio 3 (prueba)", "Beneficio 4 (prueba)"], related: ["connect-people", "hotel-net-pms"] }),
        offer: { modality: "assisted", label: "Implantación asistida", activationNotes: null, cta: "proposal", trial: false, checkout: false, reasons: ["MOTIVO INTERNO QUE NO DEBE VERSE"] },
        prices: prices(19, 190),
      },
    },
    {
      key: "connect-people",
      name: "Elephant People",
      family: "connect",
      kind: "module",
      metric: null,
      step: null,
      commercialStatus: "on_request",
      capabilities: ["people-hr"],
      monthly: eur(19),
      purchasable: false,
      // Ficha parcial: solo titular y beneficios; lo demás vacío → reserva de la semilla o sin sección
      card: { ...emptyCard(), commercial: { ...commercial({ headline: "Titular de prueba: ficha parcial", value: "", benefits: ["Beneficio parcial (prueba)"] }), longDescription: "", problem: "", forWho: null, excludes: [], integrations: [], coreIntegration: [], terms: { commitment: null, cancellation: null, activation: null }, faq: [] } },
    },
    { key: "connect-voice", name: "Elephant Voice", family: "connect", kind: "module", metric: null, step: null, commercialStatus: "coming_soon", capabilities: ["voice-ai"], monthly: eur(39), purchasable: false, card: null },
    {
      key: "connect-deals",
      name: "Elephant Deals",
      family: "connect",
      kind: "module",
      metric: null,
      step: null,
      commercialStatus: "available",
      capabilities: ["deals-coupons"],
      monthly: eur(15),
      purchasable: false,
      card: { ...emptyCard(), presentation: { icon: "tag", color: null, highlight: false, forWho: null }, commercial: commercial({ headline: "Titular de prueba: contratado", value: "Propuesta de prueba.", benefits: ["Beneficio contratado (prueba)"] }), prices: prices(15) },
    },
    // ── Elephant Net ──
    {
      key: "hotel-net-pms",
      name: "Hotel Net · PMS",
      family: "net_module",
      kind: "module",
      metric: null,
      step: null,
      commercialStatus: "on_request",
      capabilities: ["hotel-net"],
      monthly: eur(59),
      purchasable: false,
      card: {
        ...emptyCard(),
        presentation: { icon: "bed", color: null, highlight: true, forWho: "Alojamientos de prueba." },
        commercial: commercial({ headline: "Titular de prueba: Net completo", value: "Propuesta de valor Net de prueba.", benefits: ["Beneficio Net 1 (prueba)", "Beneficio Net 2 (prueba)"], related: ["hotel-net-channel-manager"] }),
        prices: prices(59, 590),
      },
    },
    { key: "restaurant-net-bookings", name: "Restaurant Net · Reservas y mesas", family: "net_module", kind: "module", metric: null, step: null, commercialStatus: "available", capabilities: ["restaurant-net"], monthly: eur(19), purchasable: false, card: { ...emptyCard(), tagline: "Lema Net de prueba (sin bloque comercial)" } },
    { key: "hotel-net-channel-manager", name: "Hotel Net · Channel Manager", family: "net_module", kind: "module", metric: null, step: null, commercialStatus: "coming_soon", capabilities: ["hotel-net-cm"], monthly: eur(39), purchasable: false, card: emptyCard() },
    { key: "care-net-agenda", name: "Care Net · Agenda", family: "net_module", kind: "module", metric: null, step: null, commercialStatus: "on_request", capabilities: ["care-net"], monthly: eur(29), purchasable: false, card: null },
    // Campos raros: tipos cambiados, HTML, direcciones peligrosas, internos y desconocidos
    {
      key: "social-token-net-communities",
      name: "Social Token Net · Comunidades",
      family: "net_module",
      kind: "module",
      metric: null,
      step: null,
      commercialStatus: "coming_soon",
      capabilities: ["social-token-net"],
      monthly: eur(39),
      purchasable: false,
      card: {
        tagline: 42,
        includes: "no es una lista",
        presentation: { icon: ["x"], highlight: "sí" },
        commercial: { headline: { a: 1 }, benefits: [1, null, "  Beneficio raro (prueba)  "], faq: [{ q: "Sin respuesta" }, "texto"], media: { cover: { src: "javascript:alert(1)", alt: "x" }, screenshots: [{ src: "http://inseguro.example/a.png", alt: "a" }, { src: "https://ok.example/b.png" }] }, terms: "nada" },
        prices: [{ kind: "monthly", amountCents: "39", currency: "EUR" }, { kind: "monthly", amountCents: 3900, currency: "eur" }],
        internal: { notes: "INTERNO", costCents: 1 },
        campoDesconocido: { x: 1 },
      },
    },
  ],
};

/** Capacidades activas de la empresa simulada: Elephant Deals (Connect) y Care Net · Agenda (Net) contratados. */
export const SIM_ACTIVE_CAPABILITIES = ["deals-coupons", "care-net"];
