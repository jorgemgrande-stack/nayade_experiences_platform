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
const single = { mode: "single", licensing: "legacy", plan: null, state: "none", trial: null, capabilities: [], visible: [], readOnly: [], limits: [], upgradeUrl: null };

async function mockTrpc(page: Page, overview: unknown) {
  const data: Record<string, unknown> = {
    "auth.me": { id: 1, openId: "o", name: "Ana Pérez", email: "ana@empresa.example", role: "admin" },
    "subscription.overview": overview,
    "config.getPublicSettings": { brand_name: "Taller Ejemplo" },
    "config.listFeatureFlags": [],
    "modules.active": { modules: [], navigation: [] },
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
  };
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname.replace(/^.*\/api\/trpc\//, "")).split(",");
    const body = names.map((n) => ({ result: { data: { json: n in data ? data[n] : null } } }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test.describe("Panel Essential (empresa nueva con licencias)", () => {
  test("menú por tareas, sin módulos no contratados, e inicio con primeros pasos", async ({ page }) => {
    await mockTrpc(page, licensed(Date.now() + 10 * DAY));
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    await expect(nav.getByText("Clientes y ventas")).toBeVisible();
    for (const g of ["Catálogo y comercio", "Web", "Facturación", "Organización", "Suscripción"]) await expect(nav.getByText(g, { exact: true })).toBeVisible();
    for (const hidden of ["Lego Packs", "Gestoría e Impuestos", "Personal", "Hotel", "Contabilidad"]) await expect(nav.getByText(hidden, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Prueba: 10 días/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Primeros pasos" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Accesos rápidos" }).getByRole("link", { name: "Nuevo cliente" })).toBeVisible();
    await expect(page.getByText("No tienes nada pendiente.")).toBeVisible();
    await page.screenshot({ path: "test-results/panel-essential-inicio-escritorio.png", fullPage: true });
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
    await mockTrpc(page, single);
    await page.goto("/admin/crm/clientes");
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    for (const label of ["Dashboard", "CMS", "Productos", "CRM", "Contabilidad", "Gestoría e Impuestos", "Marketing", "Usuarios", "Configuración"]) {
      await expect(nav.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(nav.getByText("Clientes y ventas")).toHaveCount(0);
  });
});
