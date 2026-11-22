import { describe, it, expect } from "vitest";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("Confirmación única del panel (ConfirmHost)", () => {
  it("el marco del panel monta el anfitrión: sin él confirmAction resolvería siempre false", () => {
    expect(read("client/src/components/AdminLayout.tsx")).toMatch(/<ConfirmHost \/>/);
  });
  it("sin anfitrión montado no se ejecuta ninguna acción (resuelve false) y la cancelación/cierre también", () => {
    const src = read("client/src/components/admin/ConfirmHost.tsx");
    expect(src).toMatch(/if \(!host\) \{ resolve\(false\); return; \}/);
    expect(src).toMatch(/onOpenChange=\{\(o\) => \{ if \(!o\) close\(false\); \}\}/);
    expect(src).toMatch(/onClick=\{\(\) => close\(true\)\}/);
  });
  it("las pantallas migradas ya no usan el confirm() del navegador", () => {
    for (const f of [
      "client/src/pages/admin/accounting/ExpensesManager.tsx",
      "client/src/pages/admin/accounting/RecurringExpensesManager.tsx",
      "client/src/pages/admin/hr/BonusManager.tsx",
      "client/src/pages/admin/cms/MenusManager.tsx",
    ]) {
      const s = read(f);
      expect(/(?<![\w.])(?:window\.)?confirm\(/.test(s), f).toBe(false);
      expect(s, f).toMatch(/confirmAction/);
    }
  });
});
