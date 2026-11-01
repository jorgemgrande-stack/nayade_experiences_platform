/** Importar clientes desde CSV: lectura, columnas, duplicados y revisión (lógica pura). */
import { describe, it, expect } from "vitest";
import { clientCsvTemplate, csvCell, detectDelimiter, mapHeader, parseDelimitedText, toClientCsv } from "../shared/clientImportCsv";
import { ClientImportError, namesCompatible, normalizePhone, planClientImport, type ExistingClient } from "./clientImport";

const client = (o: Partial<ExistingClient> & { id: number; name: string; email: string }): ExistingClient => ({
  phone: "", company: "", nif: "", address: null, city: "", postalCode: "", country: "ES", notes: null, ...o,
});

describe("lectura del CSV (RFC 4180)", () => {
  it("separador dentro de comillas, comillas dobladas, saltos de línea y BOM", () => {
    const p = parseDelimitedText('﻿nombre;notas\r\n"Pérez; hijos";"dice ""hola""\nsegunda línea"\r\nAna;\r\n\r\n');
    expect(p.header).toEqual(["nombre", "notas"]);
    expect(p.rows.map((r) => r.fields)).toEqual([["Pérez; hijos", 'dice "hola"\nsegunda línea'], ["Ana", ""]]);
    expect(p.malformed).toEqual([]);
  });
  it("detecta el separador y avisa de las filas que no cuadran (nunca las pierde)", () => {
    expect(detectDelimiter("nombre,email\nA,b")).toBe(",");
    expect(detectDelimiter("nombre\temail")).toBe("\t");
    expect(detectDelimiter("nombre;email,otro;x")).toBe(";");
    const p = parseDelimitedText("nombre,email\nAna,ana@x.example,de más\nLuis,luis@x.example\n");
    expect(p.rows).toHaveLength(1);
    expect(p.malformed).toEqual([{ line: 2, reason: "Tiene 3 columnas y la cabecera 2" }]);
  });
  it("reconoce cabeceras habituales e ignora el resto", () => {
    const m = mapHeader(["Nombre completo", "Correo electrónico", "Teléfono móvil", "CIF", "Población", "C.P.", "Colegio"]);
    expect(m.columns).toEqual({ name: 0, email: 1, phone: 2, nif: 3, city: 4, postalCode: 5 });
    expect(m.ignored).toEqual(["Colegio"]);
  });
  it("exportación segura en una hoja de cálculo y plantilla que se vuelve a importar", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a;"b"')).toBe('"a;""b"""');
    const csv = toClientCsv([{ name: "Ana", email: "ana@x.example", phone: "+34600111222" }]);
    expect(csv.startsWith("﻿nombre;email;telefono;")).toBe(true);
    const plan = planClientImport(csv, []);
    expect(plan.rows[0]).toMatchObject({ action: "create", values: { name: "Ana", email: "ana@x.example", phone: "+34600111222" } });
    expect(planClientImport(clientCsvTemplate(), []).totals.create).toBe(1);
  });
});

describe("teléfono y nombre", () => {
  it("normaliza sin inventar prefijos", () => {
    expect(normalizePhone("600 11 12 22")).toBe("+34600111222");
    expect(normalizePhone("0034 600111222")).toBe("+34600111222");
    expect(normalizePhone("34600111222")).toBe("+34600111222");
    expect(normalizePhone("+351 912 345 678")).toBe("+351912345678");
    expect(normalizePhone("1234567")).toBe("");
  });
  it("nombres compatibles si comparten una palabra (sin tildes)", () => {
    expect(namesCompatible("José Pérez", "jose perez gil")).toBe(true);
    expect(namesCompatible("Ana", "Luis Gómez")).toBe(false);
    expect(namesCompatible("", "Luis")).toBe(true);
  });
});

describe("plan de importación", () => {
  const existing = [
    client({ id: 1, name: "Marta Ruiz", email: "marta@x.example", phone: "600111222" }),
    client({ id: 2, name: "Pablo Gil", email: "pablo@x.example", phone: "+34 600 333 444", nif: "12345678Z" }),
    client({ id: 3, name: "Pablo Gil hijo", email: "pablo.hijo@x.example", phone: "600333444" }),
    client({ id: 4, name: "Jorge Sanz", email: "jorge@x.example", phone: "600555666" }),
  ];
  const csv = [
    "nombre;email;telefono;nif;ciudad",
    "Lucía Pérez;LUCIA@x.example;;;Madrid", // 2 alta
    "Marta Ruiz;marta@x.example;;;Sevilla", // 3 existente por email: rellena ciudad
    "Marta;;600111222;;", // 4 existente por teléfono, nada que rellenar
    "Otra persona;;600111222;;", // 5 repetido de la fila 4 (mismo teléfono)
    "Pablo;;600333444;;", // 6 teléfono de dos clientes: revisión
    "Marta Ruiz;marta@x.example;;;", // 7 repetida
    "Sin correo;;;;", // 8 alta sin email: error
    "Nombre;no-es-email;;;", // 9 email no válido
    "Jorge;pablo@x.example;600555666;;", // 10 email de Pablo y teléfono de Jorge: revisión
  ].join("\n");

  it("cada fila con su acción y su motivo", () => {
    const plan = planClientImport(csv, existing);
    const by = Object.fromEntries(plan.rows.map((r) => [r.line, r]));
    expect(by[2]).toMatchObject({ action: "create", values: { name: "Lucía Pérez", email: "lucia@x.example", city: "Madrid" } });
    expect(by[3]).toMatchObject({ action: "update", clientId: 1, fill: { city: "Sevilla" } });
    expect(by[4]).toMatchObject({ action: "unchanged", clientId: 1 });
    expect(by[5]).toMatchObject({ action: "error", reason: "Repite el cliente de la fila 4" });
    expect(by[6]).toMatchObject({ action: "review", candidateIds: [2, 3] });
    expect(by[7]).toMatchObject({ action: "error", reason: "Repite el cliente de la fila 3" });
    expect(by[8].reason).toMatch(/Falta el email/);
    expect(by[9].reason).toBe("El email no es válido");
    expect(by[10]).toMatchObject({ action: "review", candidateIds: [2, 4] });
    expect(plan.totals).toEqual({ create: 1, update: 1, unchanged: 1, review: 2, error: 4 });
  });
  it("nunca sobrescribe un dato que el cliente ya tiene", () => {
    const plan = planClientImport("nombre;email;nif;empresa\nPablo Gil;pablo@x.example;99999999R;Gil SL", existing);
    expect(plan.rows[0]).toMatchObject({ action: "update", clientId: 2, fill: { company: "Gil SL" } });
  });
  it("la huella cambia si cambian los clientes de la empresa", () => {
    const a = planClientImport(csv, existing).fingerprint;
    expect(planClientImport(csv, existing).fingerprint).toBe(a);
    expect(planClientImport(csv, [...existing, client({ id: 9, name: "Lucía Pérez", email: "lucia@x.example" })]).fingerprint).not.toBe(a);
  });
  it("cabecera irreconocible o demasiadas filas: error claro", () => {
    expect(() => planClientImport("a;b\n1;2", [])).toThrow(ClientImportError);
    const big = "nombre;email\n" + Array.from({ length: 5001 }, (_, i) => `N${i};n${i}@x.example`).join("\n");
    expect(() => planClientImport(big, [])).toThrow(/más de 5000 filas/);
  });
});
