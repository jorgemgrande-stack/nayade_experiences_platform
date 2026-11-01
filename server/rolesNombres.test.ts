/**
 * Nombres visibles de los roles: una sola fuente (shared/roleLabels) para la lista de usuarios, la cabecera del
 * panel y la invitación por correo; sin «Controler» ni «Agente Comercial».
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROLE_LABELS, roleLabel } from "../shared/roleLabels";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("nombres de rol", () => {
  it("lista completa en español claro", () => {
    expect(ROLE_LABELS).toEqual({
      admin: "Administrador",
      agente: "Comercial",
      monitor: "Monitor",
      adminrest: "Responsable de restaurante",
      controler: "Control de gestión",
      readonly: "Solo lectura",
      user: "Usuario",
      commercial_agent: "Comercial",
      sales_cashier: "Comercial + caja",
    });
    expect(roleLabel("desconocido")).toBe("desconocido");
  });

  it("ninguna pantalla ni correo usa los nombres antiguos", () => {
    for (const f of ["client/src/components/admin/UsersManager.tsx", "client/src/components/AdminLayout.tsx", "server/emailTemplates.ts", "shared/helpCenter.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/"Controler"|Agente Comercial|agente comercial|Agente \+ Caja|Gestor Restaurantes/);
    }
    expect(read("client/src/components/AdminLayout.tsx")).toContain('from "@shared/roleLabels"');
    expect(read("client/src/components/admin/UsersManager.tsx")).toContain('from "@shared/roleLabels"');
    expect(read("server/emailTemplates.ts")).toContain('from "../shared/roleLabels"');
  });
});
