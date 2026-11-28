/**
 * Newsletter · almacén en memoria (pruebas y simulaciones), con las mismas reglas que el de MySQL: una fila por correo,
 * estados, idioma de alta inmutable, importación histórica en «transacción» y recuentos por idioma.
 */
import type { LocaleSource } from "../../shared/newsletterLocalePolicy";
import type { ApplyImportInput, ImportBatch, ListFilters, ListQuery, MailLogEntry, NewsletterStore, Settings, Stats, StatusCounts, Subscriber, SubscriberEvent } from "./service";

const empty = (): StatusCounts => ({ active: 0, pending: 0, unsubscribed: 0, imported: 0, total: 0 });

export class MemoryNewsletterStore implements NewsletterStore {
  settingsRow: Settings = { enabled: true, publicEnabled: true, templates: {} };
  subs: Subscriber[] = [];
  evs: Array<SubscriberEvent & { subscriberId: number }> = [];
  mailRows: Array<MailLogEntry & { subscriberId: number; key: string }> = [];
  exports: unknown[] = [];
  batches: ImportBatch[] = [];
  /** Clientes del CRM simulados (correo → id) para enlazar históricos sin crear clientes. */
  crmClients = new Map<string, number>();
  private seq = 0;
  private tokens = new Map<number, string>();

  async settings() {
    return { ...this.settingsRow };
  }
  async saveSettings(p: Partial<Settings>) {
    this.settingsRow = { ...this.settingsRow, ...p };
  }
  async byEmail(e: string) {
    return this.subs.find((s) => s.email === e) ?? null;
  }
  async byEmails(emails: string[]) {
    const set = new Set(emails);
    return this.subs.filter((s) => set.has(s.email));
  }
  async byId(id: number) {
    return this.subs.find((s) => s.id === id) ?? null;
  }
  async byClientId(clientId: number) {
    return this.subs.filter((s) => s.clientId === clientId);
  }
  async byTokenHash(h: string) {
    for (const [id, t] of Array.from(this.tokens.entries())) if (t === h) return this.subs.find((s) => s.id === id) ?? null;
    return null;
  }
  async insert(x: Parameters<NewsletterStore["insert"]>[0]) {
    if (this.subs.some((s) => s.email === x.email)) return null;
    const id = ++this.seq;
    this.subs.push({
      id, email: x.email, status: "pending", locale: x.locale, signupLocale: x.locale, localeSource: "web", name: null, importId: null, importedAt: null,
      source: x.source, page: x.page, clientId: null, consentText: x.consentText, consentVersion: x.consentVersion, consentAt: x.now, confirmExpiresAt: x.expiresAt,
      confirmSentCount: 0, lastConfirmSentAt: null, confirmedAt: null, unsubscribedAt: null, unsubscribedBy: null, welcomeSentAt: null, crmSyncError: null, createdAt: x.now, updatedAt: x.now,
    });
    this.tokens.set(id, x.tokenHash);
    return id;
  }
  async restart(id: number, x: Parameters<NewsletterStore["restart"]>[1]) {
    const s = this.subs.find((r) => r.id === id)!;
    Object.assign(s, {
      status: "pending", locale: x.locale, signupLocale: s.signupLocale ?? x.locale, localeSource: "web", source: x.source, page: x.page, consentText: x.consentText, consentVersion: x.consentVersion, consentAt: x.now,
      confirmExpiresAt: x.expiresAt, confirmSentCount: 0, lastConfirmSentAt: null, confirmedAt: null, unsubscribedAt: null, unsubscribedBy: null, welcomeSentAt: null, updatedAt: x.now,
    });
    this.tokens.set(id, x.tokenHash);
  }
  async refreshToken(id: number, h: string, exp: number) {
    const s = this.subs.find((r) => r.id === id)!;
    if (s.status !== "pending") return;
    this.tokens.set(id, h);
    s.confirmExpiresAt = exp;
  }
  async touchConfirm(id: number, now: number) {
    const s = this.subs.find((r) => r.id === id)!;
    s.confirmSentCount++;
    s.lastConfirmSentAt = now;
  }
  async activate(id: number, now: number) {
    const s = this.subs.find((r) => r.id === id)!;
    if (s.status !== "pending") return false;
    s.status = "active";
    s.confirmedAt = now;
    this.tokens.delete(id);
    return true;
  }
  async deactivate(id: number, by: string, now: number) {
    const s = this.subs.find((r) => r.id === id)!;
    if (s.status === "unsubscribed") return false;
    s.status = "unsubscribed";
    s.unsubscribedAt = now;
    s.unsubscribedBy = by;
    this.tokens.delete(id);
    return true;
  }
  async patch(id: number, p: { locale?: string; localeSource?: LocaleSource; name?: string | null; clientId?: number | null; welcomeSentAt?: number | null; crmSyncError?: string | null }, now?: number) {
    Object.assign(this.subs.find((r) => r.id === id)!, p, now ? { updatedAt: now } : {});
  }
  async addEvent(id: number, e: { action: string; consentText?: string | null; consentVersion?: string | null; actor: string; detail?: string | null }, now: number) {
    this.evs.push({ id: this.evs.length + 1, subscriberId: id, action: e.action, consentText: e.consentText ?? null, consentVersion: e.consentVersion ?? null, actor: e.actor, detail: e.detail ?? null, at: now });
  }
  async events(id: number) {
    return this.evs.filter((e) => e.subscriberId === id);
  }
  async reserveMail(id: number, kind: "confirm" | "welcome", key: string, now: number) {
    if (this.mailRows.some((m) => m.key === key)) return false;
    this.mailRows.push({ id: this.mailRows.length + 1, subscriberId: id, key, kind, status: "sending", error: null, at: now, finishedAt: null });
    return true;
  }
  async finishMail(key: string, status: "sent" | "failed", error: string | null, now: number) {
    const m = this.mailRows.find((r) => r.key === key)!;
    m.status = status;
    m.error = error;
    m.finishedAt = now;
  }
  async mails(id: number) {
    return this.mailRows.filter((m) => m.subscriberId === id);
  }
  private match(f: ListFilters, s: Subscriber) {
    const locale = f.locale ?? (f.list?.startsWith("newsletter-") ? f.list.slice("newsletter-".length) : undefined);
    const q = f.q?.toLowerCase();
    return (!q || s.email.includes(q) || (s.name ?? "").toLowerCase().includes(q)) && (!f.status || s.status === f.status) && (!locale || s.locale === locale) && (!f.source || s.source === f.source);
  }
  async list(q: ListQuery) {
    const rows = this.subs.filter((s) => this.match(q, s));
    return { rows: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length };
  }
  async all(f: ListFilters, limit: number) {
    return this.subs.filter((s) => this.match(f, s)).slice(0, limit);
  }
  private countsOf(rows: Subscriber[]): StatusCounts {
    const c = empty();
    for (const s of rows) {
      c[s.status]++;
      c.total++;
    }
    return c;
  }
  async stats(): Promise<Stats> {
    const byLocale = Array.from(new Set(this.subs.map((s) => s.locale)))
      .sort()
      .map((locale) => ({ locale, ...this.countsOf(this.subs.filter((s) => s.locale === locale)) }));
    return { ...this.countsOf(this.subs), joined7d: 0, joined30d: 0, left30d: 0, byLocale };
  }
  async facets() {
    return { locales: Array.from(new Set(this.subs.map((s) => s.locale))).sort(), sources: Array.from(new Set(this.subs.map((s) => s.source))) };
  }
  async recentSignups(since: number) {
    return this.subs.filter((s) => s.createdAt >= since).length;
  }
  async recordExport(e: unknown) {
    this.exports.push(e);
  }
  async applyImport(i: ApplyImportInput) {
    const importId = this.batches.length + 1;
    let created = 0;
    let raced = 0;
    for (const c of i.creates) {
      if (this.subs.some((s) => s.email === c.email)) {
        raced++;
        continue;
      }
      const id = ++this.seq;
      this.subs.push({
        id, email: c.email, status: "imported", locale: c.locale, signupLocale: null, localeSource: "import", name: c.name, importId, importedAt: i.now, source: c.source, page: null,
        clientId: this.crmClients.get(c.email) ?? null, consentText: null, consentVersion: null, consentAt: null, confirmExpiresAt: null, confirmSentCount: 0, lastConfirmSentAt: null,
        confirmedAt: null, unsubscribedAt: null, unsubscribedBy: null, welcomeSentAt: null, crmSyncError: null, createdAt: i.now, updatedAt: i.now,
      });
      this.evs.push({ id: this.evs.length + 1, subscriberId: id, action: "imported", consentText: null, consentVersion: null, actor: i.batch.actor, detail: `Lote ${importId} «${i.batch.label}»`, at: i.now });
      created++;
    }
    for (const f of i.fillNames) {
      const s = this.subs.find((r) => r.id === f.id);
      if (s && !s.name) s.name = f.name;
    }
    const b = i.batch;
    this.batches.push({ id: importId, label: b.label, fileName: b.fileName, fileSha256: b.sha256, format: b.format, defaultLocale: b.defaultLocale, rowCount: b.rowCount, createdCount: created, matchedCount: b.matchedCount + raced, rejectedCount: b.rejectedCount, sendMails: false, actor: b.actor, createdAt: i.now });
    return { importId, created, raced };
  }
  async imports(limit: number) {
    return [...this.batches].reverse().slice(0, limit);
  }
}
