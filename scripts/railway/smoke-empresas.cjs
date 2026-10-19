// Comprobación de humo tras dar de alta una empresa: con NAVEGADOR REAL (Chromium), sin sesión y sin consumir
// invitaciones. «/» debe llevar al inicio de sesión (nunca a un 404), /login debe mostrar el formulario, y una ruta
// inexistente debe dar 404. Uso: node scripts/railway/smoke-empresas.cjs [empresa ...]  (por defecto, las de production)
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("@playwright/test")); }
const TENANTS = process.argv.slice(2).length ? process.argv.slice(2) : ["skibox", "t1-empresa-demo-elephant-a", "t2-empresa-demo-elephant-b", "t3-empresa-demo-elephant-01", "t4-empresa-demo-elephant-02", "prueba-e2e-stripe-sandbox-20261018"];

(async () => {
  const browser = await chromium.launch();
  let bad = 0;
  for (const t of TENANTS) {
    const base = `https://${t}.app.bigelephant.es`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const check = async (path, expect) => {
      await page.goto(base + path, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(800);
      const url = new URL(page.url()).pathname;
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const is404 = /404|Page Not Found|no existe/i.test(text) && !/contraseña/i.test(text);
      const hasPassword = (await page.locator('input[type="password"]').count()) > 0;
      const ok = expect(url, is404, hasPassword, text);
      if (!ok) bad++;
      console.log(`${ok ? "OK  " : "FALLO"} ${(t + path).padEnd(52)} → ${url.padEnd(24)} ${is404 ? "404 " : ""}${hasPassword ? "[campo contraseña]" : ""}`);
    };
    await check("/", (url, is404, pw) => url === "/login" && !is404 && pw);
    await check("/login", (url, is404, pw) => !is404 && pw);
    await check("/establecer-contrasena", (url, is404) => !is404);
    await check("/admin", (url, is404) => !is404);
    await check("/ruta-que-no-existe", (url, is404) => is404);
    await ctx.close();
  }
  await browser.close();
  console.log(bad ? `\n${bad} comprobaciones fallidas` : "\nTodo correcto");
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error("error:", e.message);
  process.exit(2);
});
