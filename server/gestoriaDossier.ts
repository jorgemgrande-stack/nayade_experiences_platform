// Gestoría e Impuestos — generación de expedientes ZIP para la gestoría (Fase 5).
//
// Empaqueta en un ZIP los resúmenes fiscales del ejercicio (IVA, laboral,
// sociedades, calendario de obligaciones) en CSV + un resumen ejecutivo,
// listos para enviar a la gestoría externa.

import JSZip from "jszip";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, asc } from "drizzle-orm";
import { taxObligations, taxSettings } from "../drizzle/schema";
import { compute303, compute111, computeCorporate } from "./gestoriaTax";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

/** CSV con separador ';' y BOM UTF-8 (compatible con Excel en español). */
function csv(rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
}

const money = (n: number) => Number(n || 0).toFixed(2);

/**
 * Construye el ZIP del expediente del ejercicio. Devuelve el buffer y el
 * número de ficheros incluidos.
 */
export async function buildDossierZip(year: number): Promise<{ buffer: Buffer; fileCount: number }> {
  const zip = new JSZip();

  const [settings] = await db.select().from(taxSettings).where(eq(taxSettings.id, 1));
  const rate = Number(settings?.corporateTaxRate ?? 25);
  const company = settings?.companyName ?? "Náyade Experiences";

  // ── IVA (303) ──────────────────────────────────────────────────────────────
  const q303 = await Promise.all([1, 2, 3, 4].map((q) => compute303(`${year}-T${q}`)));
  zip.file(`IVA/resumen_303_${year}.csv`, csv([
    ["Trimestre", "IVA repercutido", "IVA REAV", "IVA soportado", "Resultado 303"],
    ...q303.map((r, i) => [`T${i + 1}`, money(r.outputAmount), money(r.reavAmount), money(r.inputAmount), money(r.result)]),
    ["Total ejercicio",
      money(q303.reduce((s, r) => s + r.outputAmount, 0)),
      money(q303.reduce((s, r) => s + r.reavAmount, 0)),
      money(q303.reduce((s, r) => s + r.inputAmount, 0)),
      money(q303.reduce((s, r) => s + r.result, 0)),
    ],
  ]));

  // ── Laboral (111) ──────────────────────────────────────────────────────────
  const q111 = await Promise.all([1, 2, 3, 4].map((q) => compute111(`${year}-T${q}`)));
  zip.file(`Laboral/resumen_111_${year}.csv`, csv([
    ["Trimestre", "Retenciones trabajo", "Retenciones profesionales", "Total 111"],
    ...q111.map((r, i) => [`T${i + 1}`, money(r.workerRetention), money(r.professionalRetention), money(r.totalRetention)]),
    ["Total ejercicio",
      money(q111.reduce((s, r) => s + r.workerRetention, 0)),
      money(q111.reduce((s, r) => s + r.professionalRetention, 0)),
      money(q111.reduce((s, r) => s + r.totalRetention, 0)),
    ],
  ]));

  // ── Sociedades (200 / 202) ─────────────────────────────────────────────────
  const corp = await computeCorporate(year, rate);
  zip.file(`Sociedades/resumen_200_202_${year}.csv`, csv([
    ["Concepto", "Importe"],
    ["Ingresos devengados", money(corp.income)],
    ["Gastos deducibles", money(corp.expenses)],
    ["Resultado contable estimado", money(corp.result)],
    [`Tipo impositivo (%)`, money(corp.taxRate)],
    ["Cuota IS estimada (Modelo 200)", money(corp.quota)],
    ...corp.installments.map((i) => [`Pago fraccionado ${i.period} (Modelo 202)`, money(i.payment)]),
  ]));

  // ── Calendario de obligaciones ─────────────────────────────────────────────
  const obs = await db.select().from(taxObligations)
    .where(eq(taxObligations.year, year))
    .orderBy(asc(taxObligations.dueDate));
  zip.file(`Obligaciones/calendario_${year}.csv`, csv([
    ["Modelo", "Periodo", "Vencimiento", "Estado", "Importe estimado", "Importe presentado"],
    ...obs.map((o) => [
      o.model, o.periodLabel, o.dueDate, o.status,
      money(Number(o.estimatedAmount ?? 0)), o.presentedAmount != null ? money(Number(o.presentedAmount)) : "",
    ]),
  ]));

  // ── Resumen ejecutivo ──────────────────────────────────────────────────────
  const ivaResult = q303.reduce((s, r) => s + r.result, 0);
  const irpfTotal = q111.reduce((s, r) => s + r.totalRetention, 0);
  zip.file(`Resumen_Ejecutivo_${year}.txt`, [
    `EXPEDIENTE FISCAL ${year} — ${company}`,
    settings?.companyNif ? `NIF: ${settings.companyNif}` : "",
    `Generado: ${new Date().toLocaleString("es-ES")}`,
    "",
    "RESUMEN DE OBLIGACIONES",
    `  IVA (Modelo 303, resultado anual estimado): ${money(ivaResult)} €`,
    `  Retenciones IRPF (Modelo 111, total anual): ${money(irpfTotal)} €`,
    `  Impuesto de Sociedades (Modelo 200, cuota estimada): ${money(corp.quota)} €`,
    `  Pagos fraccionados (Modelo 202): ${money(corp.installments.reduce((s, i) => s + i.payment, 0))} €`,
    "",
    `Obligaciones registradas en el ejercicio: ${obs.length}`,
    "",
    "NOTA: Cifras estimadas a partir de los datos de la plataforma. La",
    "liquidación y presentación oficial corresponde a la gestoría.",
  ].filter((l) => l !== "").join("\r\n"));

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, fileCount: Object.keys(zip.files).length };
}
