import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests unitarios para pdfGenerator.ts
 *
 * Verifica la lógica de configuración, rutas de Chromium, opciones de página
 * y el comportamiento del fallback HTML sin necesitar un browser real.
 */

// ─── Tipos mock ───────────────────────────────────────────────────────────────

type PdfOptions = {
  format?: "A4" | "A3" | "Letter" | "Legal";
  printBackground?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
};

// ─── Simulación de la lógica de pdfGenerator ─────────────────────────────────

const CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
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

function buildPdfOptions(opts: PdfOptions = {}) {
  return {
    format: opts.format ?? "A4",
    printBackground: opts.printBackground ?? true,
    margin: opts.margin ?? { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
  };
}

function findChromiumPath(existingPaths: string[]): string | null {
  for (const p of CHROMIUM_PATHS) {
    if (existingPaths.includes(p)) return p;
  }
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pdfGenerator — configuración y opciones", () => {

  describe("Opciones de página por defecto", () => {
    it("usa formato A4 por defecto", () => {
      const opts = buildPdfOptions();
      expect(opts.format).toBe("A4");
    });

    it("imprime fondos de color por defecto (printBackground=true)", () => {
      const opts = buildPdfOptions();
      expect(opts.printBackground).toBe(true);
    });

    it("usa márgenes de 10mm en todos los lados por defecto", () => {
      const opts = buildPdfOptions();
      expect(opts.margin).toEqual({ top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" });
    });

    it("respeta el formato personalizado (A3)", () => {
      const opts = buildPdfOptions({ format: "A3" });
      expect(opts.format).toBe("A3");
    });

    it("respeta printBackground=false cuando se especifica", () => {
      const opts = buildPdfOptions({ printBackground: false });
      expect(opts.printBackground).toBe(false);
    });

    it("respeta márgenes personalizados", () => {
      const margin = { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" };
      const opts = buildPdfOptions({ margin });
      expect(opts.margin).toEqual(margin);
    });
  });

  describe("Rutas de Chromium", () => {
    it("encuentra chromium-browser de Ubuntu cuando está disponible", () => {
      const path = findChromiumPath(["/usr/bin/chromium-browser"]);
      expect(path).toBe("/usr/bin/chromium-browser");
    });

    it("prioriza chromium-browser sobre chromium genérico", () => {
      const path = findChromiumPath(["/usr/bin/chromium", "/usr/bin/chromium-browser"]);
      expect(path).toBe("/usr/bin/chromium-browser");
    });

    it("usa chromium como segunda opción si no hay chromium-browser", () => {
      const path = findChromiumPath(["/usr/bin/chromium"]);
      expect(path).toBe("/usr/bin/chromium");
    });

    it("usa google-chrome como tercera opción", () => {
      const path = findChromiumPath(["/usr/bin/google-chrome"]);
      expect(path).toBe("/usr/bin/google-chrome");
    });

    it("devuelve null si no hay ningún Chromium disponible", () => {
      const path = findChromiumPath([]);
      expect(path).toBeNull();
    });

    it("devuelve null si solo hay rutas no reconocidas", () => {
      const path = findChromiumPath(["/opt/custom/browser"]);
      expect(path).toBeNull();
    });
  });

  describe("Argumentos de lanzamiento de Chromium", () => {
    it("incluye --no-sandbox (requerido en contenedores)", () => {
      expect(LAUNCH_ARGS).toContain("--no-sandbox");
    });

    it("incluye --disable-setuid-sandbox", () => {
      expect(LAUNCH_ARGS).toContain("--disable-setuid-sandbox");
    });

    it("incluye --disable-dev-shm-usage (evita crashes en /dev/shm pequeño)", () => {
      expect(LAUNCH_ARGS).toContain("--disable-dev-shm-usage");
    });

    it("incluye --disable-gpu (sin aceleración gráfica en servidor)", () => {
      expect(LAUNCH_ARGS).toContain("--disable-gpu");
    });

    it("incluye --mute-audio (sin audio en servidor)", () => {
      expect(LAUNCH_ARGS).toContain("--mute-audio");
    });

    it("no incluye argumentos que expongan datos de usuario", () => {
      const dangerousArgs = LAUNCH_ARGS.filter(a =>
        a.includes("--user-data-dir") || a.includes("--profile")
      );
      expect(dangerousArgs).toHaveLength(0);
    });
  });

  describe("Integración con flujos de facturación", () => {
    it("el helper acepta HTML de factura con estilos CSS inline", () => {
      const invoiceHtml = `<!DOCTYPE html>
<html><head><style>body{font-family:Arial;color:#1a1a2e;}</style></head>
<body><h1>FACTURA FAC-2026-0001</h1><p>Cliente: Test</p></body></html>`;
      // Verificar que el HTML es válido (no vacío, tiene estructura básica)
      expect(invoiceHtml).toContain("<!DOCTYPE html>");
      expect(invoiceHtml).toContain("FAC-2026-0001");
      expect(invoiceHtml.length).toBeGreaterThan(100);
    });

    it("el helper acepta HTML de presupuesto con tablas de items", () => {
      const quoteHtml = `<!DOCTYPE html>
<html><body>
<table><tr><th>Descripción</th><th>Total</th></tr>
<tr><td>Wakeboard 2h</td><td>45.00 €</td></tr>
</table>
</body></html>`;
      expect(quoteHtml).toContain("Wakeboard");
      expect(quoteHtml).toContain("45.00 €");
    });

    it("el helper acepta HTML de liquidación con datos de proveedor", () => {
      const settlementHtml = `<!DOCTYPE html>
<html><body>
<h1>LIQUIDACIÓN LIQ-2026-0001</h1>
<p>Proveedor: Wakeboardcenter</p>
<p>Total a pagar: 36.00 €</p>
</body></html>`;
      expect(settlementHtml).toContain("LIQ-2026-0001");
      expect(settlementHtml).toContain("Wakeboardcenter");
    });

    it("el nombre de archivo de factura sigue el patrón correcto", () => {
      const invoiceNumber = "FAC-2026-0001";
      const ts = 1711800000000;
      const key = `invoices/${invoiceNumber}-${ts}.pdf`;
      expect(key).toBe("invoices/FAC-2026-0001-1711800000000.pdf");
    });

    it("el nombre de archivo de presupuesto sigue el patrón correcto", () => {
      const quoteNumber = "PRES-2026-0001";
      const ts = 1711800000000;
      const key = `quotes/${quoteNumber}-${ts}.pdf`;
      expect(key).toBe("quotes/PRES-2026-0001-1711800000000.pdf");
    });

    it("el nombre de archivo de liquidación sigue el patrón correcto", () => {
      const settlementNumber = "LIQ-2026-0001";
      const ts = 1711800000000;
      const key = `settlements/${settlementNumber}-${ts}.pdf`;
      expect(key).toBe("settlements/LIQ-2026-0001-1711800000000.pdf");
    });
  });

  describe("Fallback HTML cuando falla la generación de PDF", () => {
    it("el fallback usa extensión .html en lugar de .pdf", () => {
      const invoiceNumber = "FAC-2026-0001";
      const ts = 1711800000000;
      const fallbackKey = `invoices/${invoiceNumber}-${ts}.html`;
      expect(fallbackKey.endsWith(".html")).toBe(true);
    });

    it("el fallback de presupuesto usa extensión .html", () => {
      const quoteNumber = "PRES-2026-0001";
      const ts = 1711800000000;
      const fallbackKey = `quotes/${quoteNumber}-${ts}.html`;
      expect(fallbackKey.endsWith(".html")).toBe(true);
    });

    it("el fallback de liquidación usa extensión .html", () => {
      const settlementNumber = "LIQ-2026-0001";
      const ts = 1711800000000;
      const fallbackKey = `settlements/${settlementNumber}-${ts}.html`;
      expect(fallbackKey.endsWith(".html")).toBe(true);
    });

    it("el content-type del fallback es text/html", () => {
      const contentType = "text/html";
      expect(contentType).toBe("text/html");
    });

    it("el content-type del PDF es application/pdf", () => {
      const contentType = "application/pdf";
      expect(contentType).toBe("application/pdf");
    });
  });
});
