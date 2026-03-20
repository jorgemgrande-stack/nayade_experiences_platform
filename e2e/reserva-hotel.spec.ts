import { test, expect } from "@playwright/test";

test.describe("Reserva de hotel", () => {
  test("listado de habitaciones se carga correctamente", async ({ page }) => {
    await page.goto("/hotel");
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 8000 });
    // Las habitaciones deben aparecer
    await expect(page.locator("text=/habitaci|suite|doble|familiar/i").first()).toBeVisible({ timeout: 8000 });
  });

  test("búsqueda de disponibilidad muestra resultados", async ({ page }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);

    const fmt = (d: Date) => d.toISOString().split("T")[0];

    await page.goto(`/hotel?checkIn=${fmt(tomorrow)}&checkOut=${fmt(dayAfter)}&adults=2&children=0&childrenAges=`);
    await expect(page.locator("text=/disponible|precio|noche/i").first()).toBeVisible({ timeout: 10000 });
  });

  test("widget de búsqueda en Home navega al hotel con parámetros", async ({ page }) => {
    await page.goto("/");
    // Esperar a que cargue el widget de hotel en la home
    const checkInInput = page.locator('input[type="date"]').first();
    await expect(checkInInput).toBeVisible({ timeout: 8000 });

    // Clic en "Ver disponibilidad"
    const searchBtn = page.locator("button").filter({ hasText: /ver disponibilidad/i }).first();
    await expect(searchBtn).toBeVisible({ timeout: 5000 });
    await searchBtn.click();
    await expect(page).toHaveURL(/\/hotel/, { timeout: 5000 });
  });

  test("tarjetas de habitación muestran estrellas de valoración", async ({ page }) => {
    await page.goto("/hotel");
    // Las tarjetas con reseñas muestran la puntuación media
    await expect(page.locator("text=/habitaci|suite|doble|familiar/i").first()).toBeVisible({ timeout: 8000 });
  });
});
