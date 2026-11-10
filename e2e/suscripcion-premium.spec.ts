/**
 * «Suscripción» rediseñada (/admin/suscripcion) sin backend: se simulan las respuestas tRPC en el navegador (como
 * panel-essential.spec.ts) y el pago de Stripe se sustituye por una página local. Nunca se cobra nada.
 *
 *  - Casos de negocio: prueba activa y finalizada, suscripción activa, pago pendiente, cambio de Essential a Business,
 *    periodicidad, añadir una ampliación, consultar una bajo solicitud, una ya contratada, solicitud de Enterprise,
 *    abandonar el pago y volver, y pantalla antigua durante un despliegue (condiciones cambiadas).
 *  - Llegada desde el marketplace (?contratar=…&modulos=…#contratar), validación fiscal, doble clic e idempotencia.
 *  - Capturas en escritorio ancho, portátil, tableta y móvil (CAPTURAS=1), sin desplazamiento horizontal.
 *
 *   pnpm exec playwright test e2e/suscripcion-premium.spec.ts
 *   (fixtures: SUSCRIPCION_FIXTURES=<json> con los planes y el catálogo; sin él, uno mínimo)
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const DAY = 86_400_000;
const NOW = Date.now();
const SHOTS = process.env.CAPTURAS === "1";
const SHOT_DIR = process.env.CAPTURAS_DIR ?? "test-results/suscripcion";

type Fixtures = { plans: unknown[]; connectTrial: Record<string, unknown>; connectActive: Record<string, unknown> };
const price = (c: number) => ({ amountCents: c, currency: "EUR", taxIncluded: false });
const plan = (key: string, name: string, m: number, y: number, o: Record<string, unknown> = {}) => ({
  key,
  name,
  commercialStatus: "available",
  inherits: null,
  tagline: null,
  description: null,
  forWho: null,
  highlight: key === "business",
  benefits: [`Ventaja de ${name}`],
  limits: [
    { label: "Usuarios", value: key === "essential" ? "3" : key === "business" ? "15" : "Por contrato", metric: "users" },
    { label: "Sedes", value: key === "essential" ? "1" : key === "business" ? "5" : "Configurable", metric: "sites" },
  ],
  monthly: price(m),
  yearly: price(y),
  assisted: key === "enterprise",
  offerLabel: key === "enterprise" ? "Contratación asistida" : null,
  ...o,
});
const item = (key: string, name: string, state: string, o: Record<string, unknown> = {}) => ({
  key,
  name,
  kind: "module",
  family: "connect",
  commercialStatus: state === "on_request" ? "on_request" : state === "coming_soon" ? "coming_soon" : "available",
  state,
  reasons: [],
  plans: [],
  dependencies: [],
  capabilities: [],
  prices: [{ kind: "monthly", amountCents: 1900, currency: "EUR", taxIncluded: false, unit: null }],
  tagline: null,
  description: null,
  icon: null,
  highlight: false,
  group: null,
  sheet: { media: { card: null, hero: null, icon: null, gallery: [] }, layout: {}, related: [], offer: null, promoLabel: null, valueProposition: null, headline: null },
  activation: null,
  openPath: null,
  checkoutVia: state === "available" ? "conversion" : null,
  conversionPlan: state === "available" ? "essential" : null,
  includedIn: null,
  replaces: [],
  net: null,
  ...o,
});
const minimal: Fixtures = {
  plans: [plan("essential", "Essential", 2900, 27900), plan("business", "Business", 7900, 75900), plan("enterprise", "Enterprise", 19900, 189900, { commercialStatus: "in_preparation" })],
  connectTrial: {
    available: true,
    items: [item("connect-people", "Elephant People", "available"), item("connect-voice", "Elephant Voice", "not_eligible", { plans: ["business"], checkoutVia: "conversion", conversionPlan: "business" }), item("hotel-net-complete", "Hotel Net", "on_request")],
  },
  connectActive: { available: true, items: [] },
};
const FIX: Fixtures = process.env.SUSCRIPCION_FIXTURES && existsSync(process.env.SUSCRIPCION_FIXTURES) ? JSON.parse(readFileSync(process.env.SUSCRIPCION_FIXTURES, "utf8")) : minimal;
const catalogBase = { purchasesEnabled: true, canRetryActivation: true, requestsEnabled: true, interestEnabled: true, brands: { connect: { title: "Elephant Connect", intro: "" }, net: { title: "Elephant Net", intro: "" } }, slides: [], autoplayMs: 7000, upgradeUrl: null, supportEmail: "soporte@empresa.example" };

const CAPS = ["crm-contacts", "shop-catalog", "cms-editor", "bill-invoices", "admin-panel"].map((id) => ({ id, name: id, tier: "essential", group: id.split("-")[0] === "shop" ? "ecommerce" : id.split("-")[0] === "bill" ? "billing" : id.split("-")[0], status: "active", validUntil: NOW + 30 * DAY }));
const overview = (state: string, o: Record<string, unknown> = {}) => ({
  mode: "multi",
  licensing: "capabilities",
  plan: { key: "essential", name: "Essential" },
  state,
  trial: null,
  capabilities: CAPS,
  visible: CAPS.map((c) => c.id),
  readOnly: [],
  limits: [{ metric: "users", label: "Usuarios", included: 3, used: 1 }],
  upgradeUrl: null,
  consultation: { available: true, until: null, endedAt: null },
  ...o,
});
const contract = (state: string, o: Record<string, unknown> = {}) => ({
  company: { name: "Skibox" },
  contract: { orderId: 7, reference: "PED-7", state, plan: "essential", interval: "month", items: [], recurringNetCents: 2900, currency: "EUR", graceEndsAt: state === "past_due" ? NOW + 6 * DAY : null },
  period: { start: NOW - 10 * DAY, end: NOW + 20 * DAY, renewsAt: state === "cancel_scheduled" ? null : NOW + 20 * DAY, cancelAt: state === "cancel_scheduled" ? NOW + 20 * DAY : null, trialEnd: null, status: "active" },
  billing: { provider: "stripe", status: state === "past_due" ? "past_due" : "active", cancelAtPeriodEnd: state === "cancel_scheduled", portal: true },
  invoices: [],
  ...o,
});

type Scenario = { overview: unknown; contract?: unknown; trial?: boolean; planChange?: unknown; portal?: boolean; plan?: "essential" | "business"; ownedInTrial?: string[] };
const SCENARIOS: Record<string, Scenario> = {
  "prueba-activa": { overview: overview("trial", { trial: { endsAt: NOW + 10 * DAY, daysLeft: 10 } }), trial: true },
  "prueba-finalizada": { overview: overview("trial_expired", { trial: { endsAt: NOW - DAY, daysLeft: 0 }, readOnly: CAPS.map((c) => c.id) }), trial: true },
  activa: {
    overview: overview("active"),
    contract: contract("active"),
    portal: true,
    planChange: { enabled: true, available: true, current: { plan: "essential", interval: "month" }, options: [{ plan: "business", interval: "month", direction: "upgrade", recurringCents: 7900, currency: "EUR" }] },
  },
  "pago-pendiente": { overview: overview("active"), contract: contract("past_due"), portal: true },
  "cancelada-con-acceso": { overview: overview("active"), contract: contract("cancel_scheduled"), portal: true },
  finalizada: { overview: overview("read_only", { consultation: { available: true, until: NOW + 12 * DAY, endedAt: null } }) },
  restringida: { overview: overview("suspended") },
};

interface Calls {
  preview: Array<Record<string, unknown>>;
  start: Array<Record<string, unknown>>;
  planRequest: Array<Record<string, unknown>>;
}

async function mock(page: Page, s: Scenario, o: { startError?: { code: string; message: string; times: number }; terms?: string } = {}): Promise<Calls> {
  const calls: Calls = { preview: [], start: [], planRequest: [] };
  let terms = o.terms ?? "2026-11-01";
  let startErrors = o.startError?.times ?? 0;
  const trialCatalog = { ...catalogBase, ...FIX.connectTrial, canPurchase: false, purchaseBlock: "trial", conversion: { enabled: true, plan: "essential" } };
  if (s.ownedInTrial) trialCatalog.items = (trialCatalog.items as Array<Record<string, unknown>>).map((i) => (s.ownedInTrial!.includes(i.key as string) ? { ...i, state: "active", checkoutVia: null } : i));
  const data: Record<string, (input: Record<string, unknown>) => unknown> = {
    "auth.me": () => ({ id: 1, openId: "o", name: "Ana Pérez", email: "ana@skibox.example", role: "admin" }),
    "subscription.overview": () => s.overview,
    "subscription.plan": () => s.contract ?? { company: { name: "Skibox" }, contract: null, period: null, billing: { provider: "none", status: null, cancelAtPeriodEnd: false, portal: false }, invoices: [] },
    "subscription.conversionStatus": () => (s.trial ? { enabled: true, reasons: [] } : null),
    "subscription.planChangeStatus": () => s.planChange ?? null,
    "subscription.catalog": () => ({ plans: FIX.plans, modules: [], totals: {}, usedUsers: 1, canPurchase: !s.trial, purchasesEnabled: true }),
    "subscription.planRequests": () => [],
    "subscription.billingPortalStatus": () => (s.portal ? { enabled: true } : null),
    "subscription.usage": () => null,
    "subscription.cancellationStatus": () => (s.contract ? { enabled: true, state: (s.contract as { contract: { state: string } }).contract.state === "cancel_scheduled" ? "scheduled" : "active", cancelAt: null, periodEnd: NOW + 20 * DAY } : null),
    "subscription.withdrawalStatus": () => null,
    "connect.catalog": () => (s.trial ? trialCatalog : { ...catalogBase, ...FIX.connectActive, canPurchase: true, purchaseBlock: null, conversion: null }),
    "subscription.conversionPreview": (input) => {
      calls.preview.push(input);
      const plans = FIX.plans as Array<{ key: string; name: string; monthly: { amountCents: number }; yearly: { amountCents: number } }>;
      const p = plans.find((x) => x.key === input.plan)!;
      const year = input.interval === "year";
      const lines = [{ key: input.plan, name: `Plan ${p.name}`, quantity: 1, amountCents: year ? p.yearly.amountCents : p.monthly.amountCents, interval: input.interval, status: "available" }];
      for (const k of (input.add as string[] | undefined) ?? []) lines.push({ key: k, name: k, quantity: 1, amountCents: year ? 19000 : 1900, interval: input.interval, status: "available" });
      const total = lines.reduce((a, l) => a + l.amountCents, 0);
      return { plan: input.plan, interval: input.interval, quote: { ok: true, errors: [], currency: "EUR", lines, totals: { monthlyCents: year ? 0 : total, yearlyCents: year ? total : 0 } }, taxNotice: "Entorno de pruebas: importes netos, sin impuestos y sin cobro real.", termsVersion: terms, privacyVersion: "2026-11-10" };
    },
    "subscription.conversionStart": (input) => {
      calls.start.push(input);
      if (startErrors > 0) {
        startErrors--;
        terms = "2026-11-09";
        throw { code: o.startError!.code, message: o.startError!.message };
      }
      return { url: "https://checkout.stripe.com/c/pay/cs_test_simulado", expiresAt: NOW + 3600_000 };
    },
    "subscription.planChangePreview": () => ({ direction: "upgrade", currency: "EUR", amountDueCents: 3333, taxCents: null, recurringCents: 7900, effectiveAt: null }),
    "subscription.planRequest": (input) => {
      calls.planRequest.push(input);
      return { outcome: "created", request: { reference: "OP-99", plan: input.plan, planName: "Enterprise", status: "received", createdAt: NOW, updatedAt: null } };
    },
    "config.getPublicSettings": () => ({ brand_name: "Skibox", panel_install_mode: "multi" }),
    "config.listFeatureFlags": () => [],
    "modules.active": () => ({ modules: [], navigation: [] }),
    "panel.navigation": () => ({ entries: [], routes: [] }),
    "notifications.feed": () => ({ totalAlerts: 0, sections: [] }),
    "setupWizard.status": () => null,
  };
  const CODES: Record<string, number> = { CONFLICT: -32009, BAD_REQUEST: -32600, FORBIDDEN: -32003 };
  const STATUS: Record<string, number> = { CONFLICT: 409, BAD_REQUEST: 400, FORBIDDEN: 403 };
  await page.route("**/api/trpc/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const names = decodeURIComponent(url.pathname.replace(/^.*\/api\/trpc\//, "")).split(",");
    let inputs: Record<string, { json?: Record<string, unknown> }> = {};
    try {
      inputs = req.method() === "POST" ? JSON.parse(req.postData() ?? "{}") : JSON.parse(url.searchParams.get("input") ?? "{}");
    } catch {
      inputs = {};
    }
    const body = names.map((n, i) => {
      try {
        const fn = data[n];
        return { result: { data: { json: fn ? (fn(inputs[i]?.json ?? {}) ?? null) : null } } };
      } catch (e) {
        const err = e as { code: string; message: string };
        return { error: { json: { message: err.message, code: CODES[err.code] ?? -32603, data: { code: err.code, httpStatus: STATUS[err.code] ?? 500, path: n } } } };
      }
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  // Stripe Checkout simulado: nunca se sale a Stripe ni se cobra nada
  await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Pago simulado</title><h1>Pago simulado (sin cobro)</h1>" }));
  return calls;
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function open(page: Page, path = "/admin/suscripcion") {
  await page.goto(path, { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Suscripción", level: 1 })).toBeVisible();
}

test.describe("Suscripción: casos de negocio", () => {
  test.setTimeout(150_000);
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("1. prueba activa: estado, días, sin cobro y «Contratar un plan» lleva a la contratación", async ({ page }) => {
    await mock(page, SCENARIOS["prueba-activa"]);
    await open(page);
    const hero = page.locator("header").filter({ hasText: "Elephant Core" });
    await expect(hero.getByText("Prueba gratuita activa")).toBeVisible();
    await expect(hero.getByText("Te quedan 10 días")).toBeVisible();
    await expect(hero.getByText(/no se te ha cobrado nada/)).toBeVisible();
    await hero.getByRole("button", { name: "Contratar un plan" }).click();
    await expect(page.getByRole("heading", { name: "Contratar tu plan" })).toBeInViewport();
  });

  test("2. prueba finalizada: contratar conservando los datos sin ocultar el solo lectura", async ({ page }) => {
    await mock(page, SCENARIOS["prueba-finalizada"]);
    await open(page);
    const hero = page.locator("header").filter({ hasText: "Elephant Core" });
    await expect(hero.getByText("Prueba finalizada").first()).toBeVisible();
    await expect(hero.getByText(/se conservan tus datos/)).toBeVisible();
    await expect(hero.getByText(/solo lectura|Contrata tu plan/).first()).toBeVisible();
    await expect(hero.getByRole("button", { name: "Contratar un plan" })).toBeVisible();
  });

  test("3. suscripción activa: renovación, importe, cobro al corriente y facturas", async ({ page }) => {
    await mock(page, SCENARIOS.activa);
    await open(page);
    const hero = page.locator("header").filter({ hasText: "Elephant Core" });
    await expect(hero.getByText("Suscripción activa")).toBeVisible();
    await expect(hero.getByText("Próxima renovación")).toBeVisible();
    await expect(hero.getByText("Al corriente")).toBeVisible();
    await expect(hero.getByRole("button", { name: "Facturas y método de pago" })).toBeVisible();
    // Sin prueba no hay formulario de alta
    await expect(page.getByRole("heading", { name: "Contratar tu plan" })).toHaveCount(0);
  });

  test("4. pago pendiente: estado del cobro, plazo y «Actualizar el pago»", async ({ page }) => {
    await mock(page, SCENARIOS["pago-pendiente"]);
    await open(page);
    const hero = page.locator("header").filter({ hasText: "Elephant Core" });
    await expect(hero.getByText("Pago pendiente").first()).toBeVisible();
    await expect(hero.getByText("Regulariza antes del")).toBeVisible();
    await expect(hero.getByRole("button", { name: "Actualizar el pago" })).toBeVisible();
  });

  test("5. cambio de Essential a Business: importe del servidor antes de confirmar", async ({ page }) => {
    await mock(page, SCENARIOS.activa);
    await open(page);
    await page.getByRole("button", { name: "Cambiar a Business" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/A pagar ahora/)).toBeVisible();
    await expect(dialog.getByText("33,33 €")).toBeVisible();
  });

  test("6 y 7. periodicidad y ampliación disponible: el resumen se recalcula en el servidor", async ({ page }) => {
    const calls = await mock(page, SCENARIOS["prueba-activa"]);
    await open(page, "/admin/suscripcion#contratar");
    const form = page.locator("#contratar");
    await expect(form.getByText("Base imponible mensual")).toBeVisible();
    await form.getByText("Anual", { exact: true }).click();
    await expect(form.getByText("Base imponible anual")).toBeVisible();
    expect(calls.preview.at(-1)).toMatchObject({ interval: "year" });
    await form.getByRole("checkbox", { name: /Elephant People|connect-people/ }).check();
    await expect.poll(() => calls.preview.at(-1)?.add).toEqual(["connect-people"]);
    await expect(form.getByText(/Impuestos \(IVA\)/)).toBeVisible();
    await expect(form.getByText(/Importe provisional sin impuestos/)).toBeVisible();
  });

  test("8 y 9. bajo solicitud sin casilla de compra y ya contratada sin volver a contratarla", async ({ page }) => {
    await mock(page, { ...SCENARIOS["prueba-activa"], ownedInTrial: ["connect-tax", "connect-people"] });
    await open(page, "/admin/suscripcion#contratar");
    const form = page.locator("#contratar");
    const onRequest = form.locator("details").filter({ hasText: "Bajo solicitud" });
    await onRequest.locator("summary").click();
    await expect(onRequest.getByRole("checkbox")).toHaveCount(0);
    await expect(onRequest.getByRole("link", { name: /Ver ficha y solicitar/ }).first()).toHaveAttribute("href", /\/admin\/ampliar\//);
    const owned = form.locator("details").filter({ hasText: "Ya activas en tu cuenta" });
    await owned.locator("summary").click();
    await expect(owned.getByText(/Elephant People|connect-people/)).toBeVisible();
    await expect(owned.getByRole("checkbox")).toHaveCount(0);
  });

  test("10. Enterprise: solicitud comercial, sin contratación automática", async ({ page }) => {
    const calls = await mock(page, SCENARIOS["prueba-activa"]);
    await open(page);
    const card = page.locator("li").filter({ has: page.getByRole("heading", { name: "Enterprise", level: 3 }) });
    await expect(card.getByRole("button", { name: /Contratar Enterprise/ })).toHaveCount(0);
    await card.getByRole("button", { name: /Solicitar Enterprise/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Enviar solicitud" }).click();
    await expect(page.getByRole("dialog").getByText(/OP-99/)).toBeVisible();
    expect(calls.planRequest[0]).toMatchObject({ plan: "enterprise", kind: "contract" });
  });

  test("llegada desde el marketplace: plan y ampliación elegidos, el resto lo valida el servidor", async ({ page }) => {
    const calls = await mock(page, SCENARIOS["prueba-activa"]);
    await open(page, "/admin/suscripcion?contratar=business&modulos=connect-voice,no-existe#contratar");
    const form = page.locator("#contratar");
    await expect(form.getByRole("radio", { name: /Business/ })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: /Elephant Voice|connect-voice/ })).toBeChecked();
    await expect(form.getByText(/Algún módulo que elegiste no se puede añadir/)).toBeVisible();
    await expect.poll(() => calls.preview.at(-1)).toMatchObject({ plan: "business", add: ["connect-voice"] });
    // Volver a Essential quita lo que no cabe en ese plan (nunca se envía)
    await form.getByRole("radio", { name: /Essential/ }).check({ force: true });
    await expect.poll(() => calls.preview.at(-1)).toMatchObject({ plan: "essential" });
    expect(calls.preview.at(-1)?.add).toBeUndefined();
  });

  test("validación fiscal, doble clic, 11. abandonar el pago y volver con la misma selección", async ({ page }) => {
    const calls = await mock(page, SCENARIOS["prueba-activa"]);
    await open(page, "/admin/suscripcion#contratar");
    const form = page.locator("#contratar");
    await form.getByRole("checkbox", { name: /Elephant People|connect-people/ }).check();
    await form.getByRole("button", { name: "Continuar con los datos de facturación" }).click();
    await form.getByRole("button", { name: "Revisar y confirmar" }).click();
    await expect(form.getByText("Escribe la razón social o el nombre fiscal (al menos 2 caracteres).")).toBeVisible();
    await expect(form.getByLabel(/Razón social/)).toBeFocused();
    await form.getByLabel(/Razón social/).fill("Skibox SL");
    await form.getByLabel(/NIF/).fill("B12345678");
    await form.getByLabel(/Dirección fiscal/).fill("Calle Mayor 1");
    await form.getByLabel(/Código postal/).fill("28001");
    await form.getByLabel(/Ciudad/).fill("Madrid");
    await form.getByRole("button", { name: "Revisar y confirmar" }).click();
    await expect(form.getByText("Skibox SL · B12345678")).toBeVisible();
    const confirm = form.getByRole("button", { name: /Confirmar y continuar al pago/ });
    await expect(confirm).toBeDisabled();
    await form.getByLabel(/condiciones de contratación/).check();
    await form.getByLabel(/política de privacidad/).check();
    await expect(form.getByText(/versión 2026-11-10/)).toBeVisible();
    await confirm.dblclick();
    await expect(page.getByRole("heading", { name: "Pago simulado (sin cobro)" })).toBeVisible();
    expect(calls.start).toHaveLength(1);
    const first = calls.start[0];
    expect(first).toMatchObject({ plan: "essential", interval: "month", add: ["connect-people"], buyer: { type: "business", legalName: "Skibox SL", country: "ES" }, consents: { terms: true, privacy: true, termsVersion: "2026-11-01", privacyVersion: "2026-11-10" } });
    // Vuelve sin pagar: la selección y los datos siguen, las condiciones se aceptan de nuevo y la clave es la misma
    await open(page);
    await expect(form.getByText("Hemos recuperado la selección que dejaste a medias.")).toBeVisible();
    await expect(form.getByText("Skibox SL · B12345678")).toBeVisible();
    await expect(form.getByLabel(/condiciones de contratación/)).not.toBeChecked();
    await form.getByLabel(/condiciones de contratación/).check();
    await form.getByLabel(/política de privacidad/).check();
    await form.getByRole("button", { name: /Confirmar y continuar al pago/ }).click();
    await expect(page.getByRole("heading", { name: "Pago simulado (sin cobro)" })).toBeVisible();
    expect(calls.start).toHaveLength(2);
    expect(calls.start[1].idempotencyKey).toBe(first.idempotencyKey);
  });

  test("12. pantalla antigua durante un despliegue: condiciones cambiadas se piden y aceptan de nuevo", async ({ page }) => {
    const calls = await mock(page, SCENARIOS["prueba-activa"], { startError: { code: "CONFLICT", message: "Las condiciones han cambiado: revísalas y acéptalas de nuevo", times: 1 } });
    await page.addInitScript(() => {
      // Borrador de una pantalla abierta antes del despliegue (paso de revisión, datos completos)
      if (!sessionStorage.getItem("sx-sembrado")) {
        sessionStorage.setItem("sx-sembrado", "1");
        sessionStorage.setItem(
          "es-suscripcion-alta:u1",
          JSON.stringify({ plan: "essential", interval: "month", add: [], buyer: { legalName: "Skibox SL", taxId: "B12345678", line1: "Calle Mayor 1", postalCode: "28001", city: "Madrid", country: "ES" }, step: 3, key: null, keyFor: null, savedAt: Date.now() }),
        );
      }
    });
    await open(page, "/admin/suscripcion#contratar");
    const form = page.locator("#contratar");
    await form.getByLabel(/condiciones de contratación/).check();
    await form.getByLabel(/política de privacidad/).check();
    await form.getByRole("button", { name: /Confirmar y continuar al pago/ }).click();
    await expect(form.getByRole("alert").filter({ hasText: "Las condiciones han cambiado" })).toBeVisible();
    await expect(form.getByLabel(/condiciones de contratación/)).not.toBeChecked();
    await expect(form.getByText(/versión 2026-11-09/)).toBeVisible();
    await form.getByLabel(/condiciones de contratación/).check();
    await form.getByLabel(/política de privacidad/).check();
    await form.getByRole("button", { name: /Confirmar y continuar al pago/ }).click();
    await expect(page.getByRole("heading", { name: "Pago simulado (sin cobro)" })).toBeVisible();
    expect(calls.start.map((c) => (c.consents as { termsVersion: string }).termsVersion)).toEqual(["2026-11-01", "2026-11-09"]);
  });
});

const VIEWPORTS = [
  { id: "escritorio-ancho", width: 1920, height: 1080 },
  { id: "portatil", width: 1366, height: 768 },
  { id: "tableta", width: 820, height: 1180 },
  { id: "movil", width: 390, height: 844 },
];

test.describe("Suscripción: capturas y responsive", () => {
  test.setTimeout(150_000);
  for (const vp of VIEWPORTS) {
    for (const [id, s] of Object.entries(SCENARIOS)) {
      test(`${id} · ${vp.id}`, async ({ page }) => {
        test.skip(!SHOTS && !(vp.id === "movil" || vp.id === "escritorio-ancho"), "capturas solo con CAPTURAS=1");
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await mock(page, s);
        await open(page);
        await expect(page.getByRole("heading", { name: "Comparativa completa de planes" })).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        if (SHOTS) {
          await page.screenshot({ path: `${SHOT_DIR}/${vp.id}-${id}-cabecera.png` });
          await page.screenshot({ path: `${SHOT_DIR}/${vp.id}-${id}-completa.png`, fullPage: true });
        }
      });
    }
    test(`contratación por pasos · ${vp.id}`, async ({ page }) => {
      test.skip(!SHOTS && vp.id !== "movil", "capturas solo con CAPTURAS=1");
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await mock(page, SCENARIOS["prueba-activa"]);
      await open(page, "/admin/suscripcion?contratar=essential&modulos=connect-people#contratar");
      const form = page.locator("#contratar");
      await expect(form.getByText("Base imponible mensual")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      if (SHOTS) await form.screenshot({ path: `${SHOT_DIR}/${vp.id}-contratacion-1-plan.png` });
      await form.getByRole("button", { name: "Continuar con los datos de facturación" }).click();
      await form.getByRole("button", { name: "Revisar y confirmar" }).click();
      if (SHOTS) await form.screenshot({ path: `${SHOT_DIR}/${vp.id}-contratacion-2-errores.png` });
      await form.getByLabel(/Razón social/).fill("Skibox SL");
      await form.getByLabel(/NIF/).fill("B12345678");
      await form.getByLabel(/Dirección fiscal/).fill("Calle Mayor 1");
      await form.getByLabel(/Código postal/).fill("28001");
      await form.getByLabel(/Ciudad/).fill("Madrid");
      await form.getByRole("button", { name: "Revisar y confirmar" }).click();
      await form.getByLabel(/condiciones de contratación/).check();
      await form.getByLabel(/política de privacidad/).check();
      expect(await noHorizontalScroll(page)).toBe(true);
      if (SHOTS) await form.screenshot({ path: `${SHOT_DIR}/${vp.id}-contratacion-3-confirmacion.png` });
      // Grupos de ampliaciones y comparativa móvil desplegados
      await form.getByRole("button", { name: "Editar plan" }).click();
      for (const g of await form.locator("details").all()) await g.evaluate((d) => ((d as HTMLDetailsElement).open = true));
      if (SHOTS) await form.screenshot({ path: `${SHOT_DIR}/${vp.id}-contratacion-ampliaciones.png` });
    });
  }

  test("modo claro · portátil", async ({ page }) => {
    test.skip(!SHOTS, "capturas solo con CAPTURAS=1");
    await page.addInitScript(() => localStorage.setItem("nayade-admin-theme", "light"));
    await page.setViewportSize({ width: 1366, height: 768 });
    await mock(page, SCENARIOS["prueba-activa"]);
    await open(page);
    await page.screenshot({ path: `${SHOT_DIR}/portatil-claro-prueba-activa-completa.png`, fullPage: true });
  });
});
