/**
 * Importación de clientes por CSV: singular y plural correctos en todos los mensajes del diálogo
 * (antes «1 clientes completados»).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { importButtonLabel, importDoneToast, importPreviewSummary, importResultSentence } from "../shared/clientImportTexts";

describe("textos de la importación de clientes", () => {
  it("aviso al terminar", () => {
    expect(importDoneToast(2, 1)).toBe("Importación terminada: 2 altas y 1 cliente completado");
    expect(importDoneToast(1, 3)).toBe("Importación terminada: 1 alta y 3 clientes completados");
  });

  it("vista previa", () => {
    expect(importPreviewSummary({ create: 1, update: 1, unchanged: 1, review: 1, error: 1 }))
      .toBe("1 alta nueva, 1 cliente a completar, 1 fila sin cambios, 1 fila para revisar a mano y 1 fila que no se importa.");
    expect(importPreviewSummary({ create: 2, update: 0, unchanged: 3, review: 0, error: 2 }))
      .toBe("2 altas nuevas, 0 clientes a completar, 3 filas sin cambios, 0 filas para revisar a mano y 2 filas que no se importan.");
  });

  it("resultado y botón", () => {
    expect(importResultSentence(1, 1)).toBe("Se ha dado de alta 1 cliente y se han completado los datos de 1 cliente existente.");
    expect(importResultSentence(2, 0)).toBe("Se han dado de alta 2 clientes y no se ha completado ningún cliente existente.");
    expect(importResultSentence(0, 4)).toBe("No se ha dado de alta ningún cliente y se han completado los datos de 4 clientes existentes.");
    expect(importButtonLabel(0)).toBe("Nada que importar");
    expect(importButtonLabel(1)).toBe("Importar 1 cliente");
    expect(importButtonLabel(5)).toBe("Importar 5 clientes");
  });

  it("el diálogo usa estos textos (sin números pegados a plurales fijos)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/components/admin/crm/ClientImportDialog.tsx"), "utf8");
    expect(src).toContain('from "@shared/clientImportTexts"');
    expect(src).not.toMatch(/\} altas|\} clientes|\} sin cambios|\} que no se importan/);
  });
});
