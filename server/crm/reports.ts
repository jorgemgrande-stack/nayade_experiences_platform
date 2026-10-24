/**
 * Informes comerciales del CRM (solo lectura; nunca modifica registros). Periodo [from, to) en ms; los meses se cuentan
 * en hora de Madrid (un lead del 31/12 a las 23:30 UTC es de enero en Madrid).
 *
 *  - evolución de clientes potenciales por mes y origen;
 *  - conversión de oportunidades creadas en el periodo (ganadas, perdidas, abiertas, tasa y días hasta cierre);
 *  - actividad por responsable (actividades registradas, tareas hechas, pendientes y vencidas);
 *  - seguimientos pendientes (próximas acciones y tareas vencidas);
 *  - calidad de los datos: duplicados, registros sin responsable, estados incoherentes y relaciones inexistentes.
 */
import { madridDate } from "../controlPlane/madridCalendar";
import { normalizeCompanyName } from "./service";
import type { Activity, Company, Contact, Lead, Opportunity } from "./types";

export interface ReportData {
  leads: Lead[];
  opportunities: Opportunity[];
  companies: Company[];
  contacts: Contact[];
  activities: Activity[];
}

export const madridMonth = (ms: number) => madridDate(new Date(ms)).slice(0, 7);
const inRange = (t: number | null | undefined, from: number, to: number) => t !== null && t !== undefined && t >= from && t < to;
const DAY = 86_400_000;

export function crmReports(d: ReportData, o: { from: number; to: number; now: number; knownTenants?: Set<string> }) {
  const { from, to, now } = o;

  // ── Clientes potenciales ──
  const leads = d.leads.filter((l) => inRange(l.createdAt, from, to));
  const leadsByMonth: Record<string, { total: number; converted: number; bySource: Record<string, number> }> = {};
  for (const l of leads) {
    const m = (leadsByMonth[madridMonth(l.createdAt)] ??= { total: 0, converted: 0, bySource: {} });
    m.total++;
    if (l.status === "converted") m.converted++;
    const src = l.source?.trim() || "sin origen";
    m.bySource[src] = (m.bySource[src] ?? 0) + 1;
  }

  // ── Oportunidades creadas en el periodo ──
  const opps = d.opportunities.filter((x) => inRange(x.createdAt, from, to));
  const won = opps.filter((x) => x.stage === "won");
  const lost = opps.filter((x) => x.stage === "lost");
  const closed = won.length + lost.length;
  const closeDays = [...won, ...lost].filter((x) => x.closedAt).map((x) => (x.closedAt! - x.createdAt) / DAY);
  const lostReasons: Record<string, number> = {};
  for (const x of lost) {
    const r = x.lostReason?.trim() || "sin motivo";
    lostReasons[r] = (lostReasons[r] ?? 0) + 1;
  }
  const conversion = {
    created: opps.length,
    won: won.length,
    lost: lost.length,
    open: opps.length - closed,
    winRate: closed ? won.length / closed : null,
    wonCents: won.reduce((a, x) => a + (x.amountCents ?? 0), 0),
    avgDaysToClose: closeDays.length ? Math.round((closeDays.reduce((a, x) => a + x, 0) / closeDays.length) * 10) / 10 : null,
    lostReasons,
  };

  // ── Actividad por responsable ──
  const byPerson: Record<string, { activities: number; tasksDone: number; tasksPending: number; tasksOverdue: number; openOpportunities: number }> = {};
  const person = (k: string | null | undefined) => (byPerson[k?.trim() || "sin responsable"] ??= { activities: 0, tasksDone: 0, tasksPending: 0, tasksOverdue: 0, openOpportunities: 0 });
  for (const a of d.activities) {
    if (a.kind !== "task" && inRange(a.createdAt, from, to)) person(a.author).activities++;
    if (a.kind === "task") {
      const who = person(a.assignee ?? null);
      if (a.doneAt !== null) {
        if (inRange(a.doneAt, from, to)) who.tasksDone++;
      } else {
        who.tasksPending++;
        if (a.dueAt !== null && a.dueAt < now) who.tasksOverdue++;
      }
    }
  }
  for (const x of d.opportunities) if (x.stage !== "won" && x.stage !== "lost") person(x.owner).openOpportunities++;

  // ── Seguimientos pendientes (estado actual) ──
  const openOpps = d.opportunities.filter((x) => x.stage !== "won" && x.stage !== "lost");
  const followUps = {
    overdueNextActions: openOpps.filter((x) => x.nextActionAt !== null && x.nextActionAt < now).map((x) => ({ id: x.id, title: x.title, owner: x.owner, nextActionAt: x.nextActionAt })),
    withoutNextAction: openOpps.filter((x) => x.nextActionAt === null).length,
    overdueTasks: d.activities.filter((a) => a.kind === "task" && a.doneAt === null && a.dueAt !== null && a.dueAt < now).length,
    untouchedLeads: d.leads.filter((l) => l.status === "new" && now - l.createdAt > 7 * DAY).length,
  };

  // ── Calidad de los datos (solo detecta; no corrige nada) ──
  const companyIds = new Set(d.companies.map((c) => c.id));
  const groups = new Map<string, number[]>();
  for (const c of d.companies) {
    const k = normalizeCompanyName(c.name);
    if (k) groups.set(k, [...(groups.get(k) ?? []), c.id]);
  }
  const taxGroups = new Map<string, number[]>();
  for (const c of d.companies) if (c.taxId?.trim()) taxGroups.set(c.taxId.trim().toUpperCase(), [...(taxGroups.get(c.taxId.trim().toUpperCase()) ?? []), c.id]);
  const emailGroups = new Map<string, number[]>();
  for (const l of d.leads) if (l.email?.trim()) emailGroups.set(l.email.trim().toLowerCase(), [...(emailGroups.get(l.email.trim().toLowerCase()) ?? []), l.id]);
  const dup = (m: Map<string, number[]>) => Array.from(m.values()).filter((ids) => ids.length > 1);
  const quality = {
    duplicateCompaniesByName: dup(groups),
    duplicateCompaniesByTaxId: dup(taxGroups),
    duplicateLeadsByEmail: dup(emailGroups),
    leadsWithoutOwner: d.leads.filter((l) => !l.owner && l.status !== "converted" && l.status !== "disqualified").length,
    openOpportunitiesWithoutOwner: openOpps.filter((x) => !x.owner).length,
    // Estados incoherentes
    convertedLeadsWithoutCompany: d.leads.filter((l) => l.status === "converted" && !l.convertedCompanyId).length,
    closedOpportunitiesWithoutDate: d.opportunities.filter((x) => (x.stage === "won" || x.stage === "lost") && !x.closedAt).length,
    openOpportunitiesWithCloseDate: openOpps.filter((x) => x.closedAt !== null).length,
    // Relaciones inexistentes
    opportunitiesWithMissingCompany: d.opportunities.filter((x) => !companyIds.has(x.companyId)).length,
    contactsWithMissingCompany: d.contacts.filter((c) => c.companyId !== null && !companyIds.has(c.companyId)).length,
    companiesWithUnknownTenant: o.knownTenants ? d.companies.filter((c) => c.tenantId && !o.knownTenants!.has(c.tenantId)).map((c) => ({ id: c.id, tenantId: c.tenantId })) : null,
  };

  return { period: { from, to, timeZone: "Europe/Madrid" }, leads: { total: leads.length, byMonth: leadsByMonth }, conversion, activityByPerson: byPerson, followUps, quality, generatedAt: now };
}

/** CSV seguro (separador «;», cabecera, campos entre comillas y sin fórmulas: los que empiezan por = + - @ se prefijan). */
export function toCsv(rows: Array<Record<string, string | number | null>>): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: string | number | null) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [cols.map(cell).join(";"), ...rows.map((r) => cols.map((c) => cell(r[c] ?? null)).join(";"))].join("\r\n");
}
