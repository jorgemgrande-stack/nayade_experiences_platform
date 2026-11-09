/**
 * Contador ANÓNIMO de la página de la prueba gratuita (CRM 0046): visitas e inicios del formulario por día y canal de
 * procedencia (utm_source o dominio de referencia, medio y campaña). Sin usuario, IP, navegador ni correo: la web
 * lo envía una vez por sesión del navegador. Junto con las etapas que salen de las propias pruebas
 * (`TrialStore.funnel`), da el embudo completo: visita → formulario → envío → verificación → plataforma → primer
 * acceso → primera acción → contratación o fin sin contratar.
 *
 * Sin la migración 0046 la ruta pública responde 202 y descarta en silencio: la web puede enviar siempre.
 */
import type mysql from "mysql2/promise";
import { normalizeAttribution, type TrialAttributionInput } from "./profile";

export const LANDING_STEPS = ["visit", "form_start"] as const;
export type LandingStep = (typeof LANDING_STEPS)[number];

export interface LandingCountRow {
  day: string;
  step: LandingStep;
  channel: string;
  medium: string;
  campaign: string;
  count: number;
}

export interface TrialFunnelCounter {
  add(step: LandingStep, key: { day: string; channel: string; medium: string; campaign: string }): Promise<void>;
  counts(f: { from: string; to: string }): Promise<LandingCountRow[]>;
}

export class MemoryTrialFunnelCounter implements TrialFunnelCounter {
  rows = new Map<string, LandingCountRow>();
  async add(step: LandingStep, k: { day: string; channel: string; medium: string; campaign: string }) {
    const id = [k.day, step, k.channel, k.medium, k.campaign].join("|");
    const r = this.rows.get(id) ?? { day: k.day, step, channel: k.channel, medium: k.medium, campaign: k.campaign, count: 0 };
    r.count++;
    this.rows.set(id, r);
  }
  async counts(f: { from: string; to: string }) {
    return Array.from(this.rows.values()).filter((r) => r.day >= f.from && r.day <= f.to);
  }
}

/** Sin la migración 0046 (la tabla aún no existe) el contador descarta en silencio. */
const missingTable = (e: unknown) => (e as { code?: string } | null)?.code === "ER_NO_SUCH_TABLE";

export class MysqlTrialFunnelCounter implements TrialFunnelCounter {
  constructor(private pool: mysql.Pool) {}
  async add(step: LandingStep, k: { day: string; channel: string; medium: string; campaign: string }) {
    try {
      await this.pool.query(
        "INSERT INTO funnel_landing_counts (day, step, channel, medium, campaign, count) VALUES (?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE count = count + 1",
        [k.day, step, k.channel, k.medium, k.campaign],
      );
    } catch (e) {
      if (!missingTable(e)) throw e;
    }
  }
  async counts(f: { from: string; to: string }) {
    let rows: mysql.RowDataPacket[];
    try {
      [rows] = await this.pool.query<mysql.RowDataPacket[]>(
        "SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, step, channel, medium, campaign, count FROM funnel_landing_counts WHERE day BETWEEN ? AND ? ORDER BY day",
        [f.from, f.to],
      );
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
    return rows.map((r) => ({ day: String(r.day), step: r.step as LandingStep, channel: String(r.channel), medium: String(r.medium), campaign: String(r.campaign), count: Number(r.count) }));
  }
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Cuenta un paso de la página con su procedencia ya saneada (lo que no encaja queda vacío). */
export async function countLandingStep(counter: TrialFunnelCounter | null, step: LandingStep, attribution: TrialAttributionInput | null, now: number): Promise<boolean> {
  if (!counter) return false;
  const a = normalizeAttribution(attribution);
  await counter.add(step, { day: dayOf(now), channel: (a?.source ?? a?.referrerHost ?? "directo").slice(0, 60), medium: (a?.medium ?? "").slice(0, 60), campaign: (a?.campaign ?? "").slice(0, 80) });
  return true;
}

/** Totales por paso y por canal en un rango de días. */
export function summarizeLanding(rows: LandingCountRow[]) {
  const totals: Record<LandingStep, number> = { visit: 0, form_start: 0 };
  const byChannel = new Map<string, Record<LandingStep, number>>();
  for (const r of rows) {
    totals[r.step] += r.count;
    const c = byChannel.get(r.channel) ?? { visit: 0, form_start: 0 };
    c[r.step] += r.count;
    byChannel.set(r.channel, c);
  }
  return { totals, channels: Array.from(byChannel.entries()).map(([channel, steps]) => ({ channel, ...steps })).sort((a, b) => b.visit - a.visit) };
}
