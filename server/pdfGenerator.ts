/**
 * pdfGenerator.ts
 * Helper centralizado para generación de PDFs desde HTML.
 *
 * Usa puppeteer-core con el Chromium del sistema operativo, lo que funciona
 * tanto en desarrollo local como en producción desplegada (sin dependencia de
 * herramientas CLI del sandbox como manus-md-to-pdf).
 *
 * Uso:
 *   import { htmlToPdf } from "../pdfGenerator";
 *   const pdfBuffer = await htmlToPdf(htmlString);
 */

import type { Browser } from "puppeteer-core";

// ─── Configuración de Chromium ────────────────────────────────────────────────

/**
 * Rutas candidatas al ejecutable de Chromium/Chrome, en orden de preferencia.
 * Se prueba la primera que exista en el sistema.
 */
const CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",       // Ubuntu (sandbox + producción)
  "/usr/bin/chromium",               // Debian/Alpine
  "/usr/bin/google-chrome",          // Chrome en Linux
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // macOS
];

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--no-first-run",
  "--mute-audio",
];

// ─── Singleton de browser con reutilización ───────────────────────────────────

let _browser: Browser | null = null;
let _browserPromise: Promise<Browser> | null = null;

async function getChromiumPath(): Promise<string> {
  const { existsSync } = await import("fs");
  for (const p of CHROMIUM_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `No se encontró ningún ejecutable de Chromium. Rutas probadas: ${CHROMIUM_PATHS.join(", ")}`
  );
}

async function getBrowser(): Promise<Browser> {
  // Si ya hay un browser vivo, reutilizarlo
  if (_browser) {
    try {
      // Verificar que sigue vivo
      await _browser.version();
      return _browser;
    } catch {
      _browser = null;
      _browserPromise = null;
    }
  }

  // Si hay una promesa de lanzamiento en curso, esperarla
  if (_browserPromise) return _browserPromise;

  _browserPromise = (async () => {
    const puppeteer = await import("puppeteer-core");
    const executablePath = await getChromiumPath();
    const browser = await puppeteer.default.launch({
      executablePath,
      args: LAUNCH_ARGS,
      headless: true,
    });
    _browser = browser;
    // Limpiar referencia si el proceso del browser muere inesperadamente
    browser.on("disconnected", () => {
      _browser = null;
      _browserPromise = null;
    });
    return browser;
  })();

  try {
    const browser = await _browserPromise;
    _browserPromise = null;
    return browser;
  } catch (err) {
    _browserPromise = null;
    throw err;
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

export interface PdfOptions {
  /** Formato de página. Por defecto 'A4'. */
  format?: "A4" | "A3" | "Letter" | "Legal";
  /** Imprimir fondos de color (CSS background-color, background-image). Por defecto true. */
  printBackground?: boolean;
  /** Márgenes de página en mm. Por defecto 10mm en todos los lados. */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
}

/**
 * Convierte un string HTML completo en un Buffer PDF.
 *
 * @param html   HTML completo (con <!DOCTYPE html> y <style>)
 * @param opts   Opciones de página (formato, márgenes, fondos)
 * @returns      Buffer con el contenido del PDF
 *
 * @throws Error si Chromium no está disponible o la generación falla
 */
export async function htmlToPdf(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  const {
    format = "A4",
    printBackground = true,
    margin = { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
  } = opts;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfUint8 = await page.pdf({
      format,
      printBackground,
      margin,
    });
    return Buffer.from(pdfUint8);
  } finally {
    await page.close();
  }
}

/**
 * Cierra el browser singleton. Útil en tests o en shutdown del servidor.
 */
export async function closePdfBrowser(): Promise<void> {
  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
    _browser = null;
    _browserPromise = null;
  }
}
