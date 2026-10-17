/**
 * E2E ligera (sin backend) de Etiquetas y Tareas del CRM: se simulan las respuestas tRPC.
 * Comprueba estados vacíos, la tarea vencida destacada con texto, la validación del formulario en
 * español, el filtro por etiqueta en Clientes y que en móvil no hay desplazamiento horizontal.
 *
 *   pnpm exec playwright test e2e/crm-etiquetas-tareas.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const DAY = 86_400_000;
const CAPS = ["crm-contacts", "crm-accounts", "crm-leads", "crm-quotes", "crm-tags", "crm-tasks", "admin-panel"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function mockTrpc(page: Page, extra: Record<string, unknown> = {}) {
  const endsAt = Date.now() + 10 * DAY;
  const data: Record<string, unknown> = {
    "auth.me": { id: 1, openId: "o", name: "Ana Pérez", email: "ana@empresa.example", role: "agente" },
    "subscription.overview": {
      mode: "multi", licensing: "capabilities", plan: { key: "essential", name: "Essential" }, state: "trial",
      trial: { endsAt, daysLeft: 10 },
      capabilities: CAPS.map((id) => ({ id, name: id, tier: "essential", group: id.split("-")[0], status: "active", validUntil: endsAt })),
      visible: CAPS, readOnly: [], limits: [], upgradeUrl: null,
    },
    "config.getPublicSettings": { brand_name: "Taller Ejemplo" },
    "config.listFeatureFlags": [],
    "modules.active": { modules: [], navigation: [] },
    "notifications.feed": { totalAlerts: 0, sections: [] },
    "crmTags.list": [],
    "crmTags.forEntities": {},
    "crmTasks.list": { rows: [], total: 0 },
    "crmTasks.assignees": [{ id: 1, name: "Ana Pérez" }],
    "crm.clients.list": { items: [], total: 0 },
    ...extra,
  };
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname.replace(/^.*\/api\/trpc\//, "")).split(",");
    const body = names.map((n) => ({ result: { data: { json: n in data ? data[n] : null } } }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test.describe("CRM: etiquetas y tareas", () => {
  test("tareas: estado vacío, alta con validación en español y menú «Clientes y ventas»", async ({ page }) => {
    await mockTrpc(page);
    await page.goto("/admin/crm/tareas");
    await expect(page.getByRole("heading", { name: "Tareas", exact: true })).toBeVisible();
    await expect(page.getByText("No tienes tareas pendientes")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Menú del panel" });
    await expect(nav.getByRole("link", { name: "Tareas", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Etiquetas", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Crear una tarea" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /Título/ }).press("Enter");
    await expect(dialog.getByText("Indica el título de la tarea.")).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: /Título/ })).toHaveAttribute("aria-invalid", "true");
  });

  test("tareas: la vencida se destaca con texto y no hay desplazamiento horizontal en móvil", async ({ page }) => {
    const late = ymd(new Date(Date.now() - 2 * DAY));
    await mockTrpc(page, {
      "crmTasks.list": {
        rows: [
          { id: 1, title: "Llamar a Ana", description: null, dueDate: late, status: "pendiente", priority: "alta", assignedTo: 1, assigneeName: "Ana Pérez", entityType: "client", entityId: 4, entityLabel: "Cliente Ejemplo", completedAt: null, createdAt: new Date().toISOString() },
          { id: 2, title: "Preparar catálogo", description: null, dueDate: null, status: "pendiente", priority: "media", assignedTo: 1, assigneeName: "Ana Pérez", entityType: null, entityId: null, entityLabel: null, completedAt: null, createdAt: new Date().toISOString() },
        ],
        total: 2,
      },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/crm/tareas");
    await expect(page.getByText(/Vencida ·/)).toBeVisible();
    await expect(page.getByText("Sin fecha")).toBeVisible();
    await expect(page.getByRole("link", { name: /Cliente: Cliente Ejemplo/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Marcar como hecha la tarea «Llamar a Ana»" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("etiquetas: estado vacío y filtro por etiqueta en Clientes", async ({ page }) => {
    await mockTrpc(page);
    await page.goto("/admin/crm/etiquetas");
    await expect(page.getByText("Todavía no tienes etiquetas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear la primera etiqueta" })).toBeVisible();

    await mockTrpc(page, { "crmTags.list": [{ id: 3, name: "VIP", color: "azul", usage: 0 }] });
    await page.goto("/admin/crm/clientes?etiqueta=3");
    await expect(page.getByRole("combobox", { name: "Filtrar por etiqueta" })).toHaveValue("3");
    await expect(page.getByText("Ningún cliente tiene la etiqueta «VIP»")).toBeVisible();
    await page.getByRole("button", { name: "Quitar filtro de etiqueta" }).click();
    await expect(page.getByRole("combobox", { name: "Filtrar por etiqueta" })).toHaveValue("");
  });
});
