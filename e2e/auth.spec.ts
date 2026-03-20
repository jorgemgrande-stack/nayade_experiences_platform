import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@nayadeexperiences.es";
const ADMIN_PASSWORD = "Nayade26*";

test.describe("Autenticación", () => {
  test("login con credenciales correctas redirige al admin", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/admin/, { timeout: 10000 });
  });

  test("login con credenciales incorrectas muestra error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', "contraseña-incorrecta");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Credenciales incorrectas")).toBeVisible({ timeout: 5000 });
  });

  test("página recuperar contraseña carga y acepta email", async ({ page }) => {
    await page.goto("/login");
    await page.click("text=¿Olvidaste tu contraseña?");
    await expect(page).toHaveURL(/recuperar|forgot/, { timeout: 5000 });
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    await emailInput.fill(ADMIN_EMAIL);
    // El botón de envío existe y está habilitado
    const submitBtn = page.locator('button[type="submit"]').first();
    await expect(submitBtn).toBeEnabled({ timeout: 3000 });
  });
});
