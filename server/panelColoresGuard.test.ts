/**
 * Guarda de la línea visual del panel de Essential: sin colores fijos (azul, morado, naranja…, ni hexadecimales en
 * clases) en las pantallas del panel. Los colores salen de la marca de la empresa (`primary`) o del significado
 * (`text-success`, `bg-warning/10`… o `@/lib/panelTones`).
 *
 *  - Pantallas ya migradas: ninguno.
 *  - Resto de pantallas del panel de Essential: trinquete; ninguna puede tener más líneas con colores fijos que hoy.
 *    Al migrar una, baja aquí su número (o pásala a MIGRATED).
 * Además, sin la clase `truncate` en las migradas (se usa `overflow-hidden text-ellipsis whitespace-nowrap`).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "../client/src");
const FIXED = /\b(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|divide|shadow|accent|caret|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|-\[#[0-9a-fA-F]{3,8}\]/;

const MIGRATED = [
  "components/admin/PanelUi.tsx",
  "components/admin/PanelStates.tsx",
  "components/admin/crm/ClientImportDialog.tsx",
  "components/admin/crm/ClientFormDialog.tsx",
  "components/onboarding/SetupStatusCard.tsx",
  "pages/admin/crm/ClientsManager.tsx",
  "pages/admin/crm/ClientDetail.tsx",
  "pages/admin/crm/CrmTasks.tsx",
  "pages/admin/home/EssentialHome.tsx",
  "pages/admin/shop/OnlineOrders.tsx",
  "pages/admin/setup/PrimerosPasos.tsx",
  "pages/admin/setup/PrimerosPasosSteps.tsx",
  "pages/admin/tpv/TpvScreen.tsx",
  "pages/admin/tpv/TpvBackoffice.tsx",
  "pages/admin/tpv/TpvReports.tsx",
  "pages/admin/tpv/TpvOpenSession.tsx",
  "pages/admin/tpv/TpvCloseSession.tsx",
  "pages/admin/tpv/TpvCashMovement.tsx",
  "pages/admin/tpv/TpvSplitPayment.tsx",
  "pages/admin/tpv/TpvTicket.tsx",
  "pages/admin/tpv/TpvCashPayment.tsx",
  "pages/admin/products/CategoriesManager.tsx",
  "pages/admin/products/LocationsManager.tsx",
  "pages/admin/products/VariantsManager.tsx",
  "pages/admin/products/ExperiencesManager.tsx",
  "pages/admin/cms/PagesManager.tsx",
  "pages/admin/settings/CompanyData.tsx",
  "pages/admin/settings/Settings.tsx",
  "pages/admin/settings/BrandTheme.tsx",
  "components/connect/ConnectParts.tsx",
  "pages/admin/connect/ConnectPage.tsx",
  "pages/admin/connect/ConnectDetailPage.tsx",
  "components/connect/Showcase.tsx",
  "components/connect/SheetBlocks.tsx",
  "pages/admin/crm/ProposalsPage.tsx",
  "pages/admin/crm/CrmTags.tsx",
];

/** Pendientes de migrar (pantallas del panel de Essential): líneas con colores fijos hoy. Solo pueden bajar. */
const BASELINE: Record<string, number> = {
  "components/AdminLayout.tsx": 21,
  "pages/admin/crm/CRMDashboard.tsx": 725,
  "pages/admin/crm/ProposalsManager.tsx": 34,
  "pages/admin/crm/CancellationsManager.tsx": 51,
  "pages/admin/crm/CancellationDetailModal.tsx": 103,
  "pages/admin/crm/NewInvoiceDialog.tsx": 7,
  "pages/admin/crm/CreditNoteDialog.tsx": 8,
  "pages/admin/accounting/AccountingDashboard.tsx": 74,
  "pages/admin/accounting/TransactionsList.tsx": 21,
  "pages/admin/accounting/AccountingReports.tsx": 30,
  "pages/admin/cms/BlogManager.tsx": 7,
  "pages/admin/settings/ConfigPanel.tsx": 17,
  "pages/admin/DocumentNumbersAdmin.tsx": 9,
  // Colores que elige el usuario para sus etiquetas (gris, azul, verde…): fijos a propósito
  "components/admin/crm/CrmParts.tsx": 5,
};

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeLines = (text: string) => text.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
const fixedLines = (rel: string) => codeLines(read(rel)).filter((l) => FIXED.test(l));

describe("línea visual del panel: sin colores fijos", () => {
  it("las pantallas migradas no tienen colores fijos", () => {
    const found = MIGRATED.flatMap((f) => fixedLines(f).map((l) => `${f}: ${l.trim().slice(0, 140)}`));
    expect(found).toEqual([]);
  });

  it("las migradas no usan la clase truncate", () => {
    const found = MIGRATED.filter((f) => codeLines(read(f)).some((l) => /["'`\s]truncate["'`\s]/.test(l)));
    expect(found).toEqual([]);
  });

  it("el resto de pantallas del panel no tiene más colores fijos que en la línea base", () => {
    const over = Object.entries(BASELINE)
      .map(([f, max]) => [f, fixedLines(f).length, max] as const)
      .filter(([, n, max]) => n > max)
      .map(([f, n, max]) => `${f}: ${n} (máximo ${max})`);
    expect(over).toEqual([]);
  });

  it("la guarda detecta los colores fijos (comprobación de la propia guarda)", () => {
    expect(FIXED.test(`className="bg-blue-600 text-white"`)).toBe(true);
    expect(FIXED.test(`className="hover:bg-violet-500"`)).toBe(true);
    expect(FIXED.test(`className="bg-[#0d1526]"`)).toBe(true);
    expect(FIXED.test(`className="bg-primary text-success border-warning/40 text-muted-foreground"`)).toBe(false);
  });
});
