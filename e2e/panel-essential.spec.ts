/**
 * E2E ligera del panel (Fase P0) sin backend: se simulan las respuestas tRPC en el navegador.
 * Comprueba el menú por licencias (empresa Essential en prueba), el inicio, la página
 * «Suscripción», el menú de siempre en modo single (Náyade) y el comportamiento en móvil.
 *
 *   pnpm exec playwright test e2e/panel-essential.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const DAY = 86_400_000;
const ESSENTIAL = [
  "crm-contacts", "crm-accounts", "crm-activity", "crm-tags", "crm-leads", "crm-quotes", "crm-tasks",
  "shop-catalog", "shop-variants", "shop-store", "shop-checkout", "shop-orders", "shop-coupons",
  "cms-editor", "cms-domain", "cms-pages-forms", "cms-blog", "cms-seo",
  "bill-invoices", "bill-series", "bill-taxes", "bill-payments", "bill-cash", "bill-reports",
  "admin-panel", "admin-users", "comms-email", "comms-whatsapp-links", "auto-basic",
];

const licensed = (endsAt: number) => ({
  mode: "multi",
  licensing: "capabilities",
  plan: { key: "essential", name: "Essential" },
  state: "trial",
  trial: { endsAt, daysLeft: 10 },
  capabilities: ESSENTIAL.map((id) => ({ id, name: id, tier: "essential", group: id.split("-")[0] === "shop" ? "ecommerce" : id.split("-")[0] === "bill" ? "billing" : id.split("-")[0], status: "active", validUntil: endsAt })),
  visible: ESSENTIAL,
  readOnly: [],
  limits: [
    { metric: "users", label: "Usuarios", included: 3, used: 1 },
    { metric: "sites", label: "Sedes", included: 1, used: null },
    { metric: "fiscal_entities", label: "Entidades fiscales", included: 1, used: null },
  ],
  upgradeUrl: "https://elephant.example/planes",
});
/** Asistente de una empresa nueva: `explored` = ya pasó la bienvenida («Explorar primero»). */
const wizardStatus = (explored: boolean) => {
  const ids = ["welcome", "company", "fiscal", "brand", "activity", "client", "product", "web", "operation", "comms", "finish"];
  const done = new Set(explored ? ["welcome", "fiscal"] : ["fiscal"]);
  const steps = ids.map((id) => ({ id, status: done.has(id) ? "done" : "pending", recommended: false, byData: id === "fiscal" }));
  const plan = { steps, hidden: ["sector"], nextStep: explored ? "company" : "welcome", percent: explored ? 18 : 9, done: done.size, total: ids.length, completedAt: null };
  const stepMap = Object.fromEntries(ids.map((id) => [id, { status: done.has(id) ? "done" : "pending", at: null }]));
  return {
    progress: { version: 1, steps: stepMap, completedAt: null, updatedAt: explored ? Date.now() : null },
    nextStep: plan.nextStep, percent: plan.percent, plan,
    facts: { identity: false, fiscal: true, brand: false, activity: false, clients: 0, products: 0, quotes: 0, comms: false },
    company: { tradeName: "Taller Ejemplo", legalName: "Taller Ejemplo SL", taxId: "B00000000", address: "", postalCode: "", city: "", province: "", country: "ES", currency: "EUR", timezone: "Europe/Madrid", publicPhone: "", publicEmail: "", publicLocation: "" },
    comms: { fromName: "", replyTo: "", whatsapp: "" },
    activity: null, profile: null, activities: ["comercio", "servicios", "web"], sectorModules: [],
    seats: { used: 1, limit: 3 },
    licence: { plan: "essential", userLimit: 3, endsAt: null, daysLeft: 10, readOnly: false },
    fiscalFromRegistry: true,
  };
};
const single = { mode: "single", licensing: "legacy", plan: null, state: "none", trial: null, capabilities: [], visible: [], readOnly: [], limits: [], upgradeUrl: null };

async function mockTrpc(page: Page, overview: unknown, opts: { install?: "single" | "multi"; failing?: string[]; navigation?: unknown; wizard?: unknown } = {}) {
  const failing = new Set(opts.failing ?? []);
  const data: Record<string, unknown> = {
    "auth.me": { id: 1, openId: "o", name: "Ana Pérez", email: "ana@empresa.example", role: "admin" },
    "subscription.overview": overview,
    "config.getPublicSettings": { brand_name: "Taller Ejemplo", ...(opts.install ? { panel_install_mode: opts.install } : {}) },
    "config.listFeatureFlags": [],
    "modules.active": { modules: [], navigation: [] },
    "panel.navigation": opts.navigation ?? { entries: [], routes: [{ path: "/admin/personal", capabilities: ["people-hr"] }] },
    "notifications.feed": { totalAlerts: 0, sections: [] },
    "crm.leads.counters": { total: 0, nueva: 0, enviada: 0, ganada: 0, perdida: 0, hoy: 0, semana: 0, sinLeer: 0 },
    "crm.quotes.counters": { borrador: 0, enviado: 0, pagoFallido: 0, pendientePago: 0, ganado: 0, perdido: 0 },
    "crm.reservations.counters": { confirmadas: 0, pendientePago: 0, facturas: 0 },
    "crm.clients.list": { items: [], total: 0 },
    "products.getAll": [],
    "products.getCategories": [],
    "products.getLocations": [],
    "admin.getUsers": [{ id: 1, name: "Ana Pérez", email: "ana@empresa.example", role: "admin", isActive: true }],
    "cms.getSiteSettings": {},
    "setupWizard.status": opts.wizard ?? null,
  };
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname.replace(/^.*\/api\/trpc\//, "")).split(",");
    const body = names.map((n) =>
      failing.has(n)
        ? { error: { json: { message: "Error interno. Inténtalo más tarde.", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: n } } } }
        : { result: { data: { json: n in data ? data[n] : null } } },
    );
    await route.fulfill({ status: names.some((n) => failing.has(n)) ? 207 : 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test.describe("Panel Essential (empresa nueva con licencias)", () => {
  test("menú por tareas, sin módulos no contratados, e inicio con el estado de la configuración", async ({ page }) => {
    await mockTrpc(page, licensed(Date.now() + 10 * DAY), { wizard: wizardStatus(true) });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    await expect(nav.getByText("Clientes y ventas")).toBeVisible();
    for (const g of ["Catálogo y comercio", "Web", "Facturación", "Organización", "Suscripción"]) await expect(nav.getByText(g, { exact: true })).toBeVisible();
    for (const hidden of ["Lego Packs", "Gestoría e Impuestos", "Personal", "Hotel", "Contabilidad"]) await expect(nav.getByText(hidden, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Prueba: 10 días/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
    // Desde el onboarding nuevo, el Inicio muestra el estado del asistente (ya no un bloque «Primeros pasos»)
    await expect(page.getByRole("heading", { name: "Estado de la configuración" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Continuar: Identidad de empresa/ })).toHaveAttribute("href", "/admin/primeros-pasos");
    await expect(page.getByRole("navigation", { name: "Accesos rápidos" }).getByRole("link", { name: "Nuevo cliente" })).toBeVisible();
    await expect(page.getByText("No tienes nada pendiente.")).toBeVisible();
    await page.screenshot({ path: "test-results/panel-essential-inicio-escritorio.png", fullPage: true });
  });

  test("primera entrada del administrador: bienvenida a pantalla completa con «Configurar mi empresa» y «Explorar primero»", async ({ page }) => {
    await mockTrpc(page, licensed(Date.now() + 10 * DAY), { wizard: wizardStatus(false) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: /Configurar mi empresa/ }).or(page.getByRole("link", { name: /Configurar mi empresa/ }))).toBeVisible();
    await expect(page.getByRole("button", { name: "Explorar primero" })).toBeVisible();
    await expect(page.getByText(/Taller Ejemplo/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("página Suscripción: plan, prueba, límites y ampliar", async ({ page }) => {
    await mockTrpc(page, licensed(Date.now() + 10 * DAY));
    await page.goto("/admin/suscripcion");
    await expect(page.getByRole("heading", { name: "Essential" })).toBeVisible();
    await expect(page.getByText(/Te quedan/)).toContainText("10 días");
    const limits = page.getByRole("table");
    await expect(limits.getByRole("rowheader", { name: "Usuarios" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Ver planes y módulos/ }).first()).toHaveAttribute("href", "https://elephant.example/planes");
    await page.screenshot({ path: "test-results/panel-essential-suscripcion.png", fullPage: true });
  });

  test("móvil: el menú se abre, muestra textos y se cierra con Escape", async ({ page }) => {
    await mockTrpc(page, licensed(Date.now() + 10 * DAY));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    await expect(nav.getByRole("link", { name: "Clientes", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/panel-essential-movil-menu.png" });
    await page.keyboard.press("Escape");
    await expect(nav.getByRole("link", { name: "Clientes", exact: true })).not.toBeInViewport();
  });

  test("URL de algo no contratado: «No incluido en tu plan» con enlace para ampliar", async ({ page }) => {
    await mockTrpc(page, licensed(Date.now() + 10 * DAY), { install: "multi" });
    await page.goto("/admin/personal/empleados");
    await expect(page.getByText("No incluido en tu plan").first()).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Amplía tu empresa" })).toHaveAttribute("href", "/admin/ampliar");
  });

  test("extra contratado: su entrada sale del manifiesto (panel.navigation) en «Módulos contratados»", async ({ page }) => {
    const overview = { ...licensed(Date.now() + 10 * DAY), visible: [...ESSENTIAL, "people-hr"] };
    const leaf = (id: string, label: string, href: string) => ({ key: `x-people-${id}`, label, href, capabilities: ["people-hr"], roles: ["admin"] });
    const navigation = {
      entries: [{ kind: "item", moduleId: "people", sectionId: "contratados", order: 5, item: { ...leaf("personal", "Personal", "/admin/personal"), icon: "briefcase", children: [leaf("resumen", "Resumen", "/admin/personal"), leaf("nominas", "Nóminas", "/admin/personal/nominas")] } }],
      routes: [{ path: "/admin/personal", capabilities: ["people-hr"] }],
    };
    await mockTrpc(page, overview, { install: "multi", navigation });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    await expect(nav.getByText("Módulos contratados", { exact: true })).toBeVisible();
    await expect(nav.getByText("Personal", { exact: true })).toBeVisible();
  });

  test("fallo al consultar la suscripción: error con Reintentar, nunca el menú ni el logo de Náyade", async ({ page }) => {
    await mockTrpc(page, null, { install: "multi", failing: ["subscription.overview"] });
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: "Reintentar" }).first()).toBeVisible({ timeout: 15_000 });
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    for (const label of ["Dashboard", "Productos", "Lego Packs", "Gestoría e Impuestos"]) await expect(nav.getByText(label, { exact: true })).toHaveCount(0);
    await expect(page.locator("img[src*='nayade']")).toHaveCount(0);
  });

  test("el menú plegado se conserva al cambiar de pantalla", async ({ page }) => {
    await mockTrpc(page, licensed(Date.now() + 10 * DAY), { install: "multi" });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/admin");
    await page.getByRole("button", { name: "Plegar menú lateral" }).click();
    await page.getByRole("navigation", { name: "Menú del panel" }).getByRole("link", { name: "Clientes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Desplegar menú lateral" })).toBeVisible();
  });

  test("lista de clientes vacía con acción real que abre el alta, y validación en español", async ({ page }) => {
    await mockTrpc(page, licensed(Date.now() + 10 * DAY));
    await page.goto("/admin/crm/clientes");
    await expect(page.getByText("Todavía no tienes clientes")).toBeVisible();
    await page.getByRole("button", { name: "Crear el primer cliente" }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Email", exact: true }).fill("no-es-un-correo");
    // Enviar con Enter (el banner de cookies cubre el pie del diálogo en esta prueba)
    await page.getByRole("dialog").getByRole("textbox", { name: "Email", exact: true }).press("Enter");
    await expect(page.getByText("Indica el nombre del cliente.")).toBeVisible();
    await expect(page.getByText(/El correo electrónico no es válido/)).toBeVisible();
    // Lo escrito se conserva
    await expect(page.getByRole("dialog").getByRole("textbox", { name: "Email", exact: true })).toHaveValue("no-es-un-correo");
  });
});

test.describe("Náyade (modo single)", () => {
  test("conserva el menú de siempre", async ({ page }) => {
    await mockTrpc(page, single, { install: "single" });
    await page.goto("/admin/crm/clientes");
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    for (const label of ["Dashboard", "CMS", "Productos", "CRM", "Contabilidad", "Gestoría e Impuestos", "Marketing", "Usuarios", "Configuración"]) {
      await expect(nav.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(nav.getByText("Clientes y ventas")).toHaveCount(0);
  });

  test("si la suscripción falla, sigue con el menú de siempre (no hay estado de error)", async ({ page }) => {
    await mockTrpc(page, null, { install: "single", failing: ["subscription.overview"] });
    await page.goto("/admin/crm/clientes");
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    await expect(nav.getByText("CRM", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("No se ha podido cargar tu panel")).toHaveCount(0);
  });
});
