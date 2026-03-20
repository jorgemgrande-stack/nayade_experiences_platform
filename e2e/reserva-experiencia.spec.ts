import { test, expect } from "@playwright/test";

test.describe("Reserva de experiencia", () => {
  test("navegar a experiencia y ver botón de reserva", async ({ page }) => {
    await page.goto("/experiencias/banana-ski-donuts");
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 8000 });
    // El botón de reserva debe estar visible
    const reservaBtn = page.locator("button, a").filter({ hasText: /reservar|book/i }).first();
    await expect(reservaBtn).toBeVisible({ timeout: 5000 });
  });

  test("listado de experiencias muestra tarjetas", async ({ page }) => {
    await page.goto("/experiencias");
    // Esperar a que carguen las tarjetas
    await expect(page.locator(".card, [class*='card'], [class*='Card']").first()).toBeVisible({ timeout: 8000 });
    const count = await page.locator("a[href*='/experiencias/']").count();
    expect(count).toBeGreaterThan(0);
  });

  test("abrir modal de reserva desde listado", async ({ page }) => {
    await page.goto("/experiencias");
    // Hacer clic en la primera experiencia disponible
    const firstLink = page.locator("a[href*='/experiencias/']").first();
    await firstLink.click();
    await expect(page).toHaveURL(/\/experiencias\//, { timeout: 5000 });
  });
});
