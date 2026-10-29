/**
 * Alertas operativas, incidencias y retención.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IncidentService, MemoryIncidentStore, webhookNotifier, type Incident } from "./_core/ops/incidents";
import { runAlerts } from "./_core/ops/alerts";
import { DEFAULT_RETENTION, runRetention, selectBackupsToDelete, type BackupFile } from "./_core/ops/retention";
import { MemoryUsageStore } from "./_core/erm/usage";
import type { Tenant } from "./_core/tenantRegistry/contract";

const T0 = Date.UTC(2026, 9, 14, 12);
const tenant = (id: string, status: Tenant["status"]): Tenant => ({
  id,
  displayName: id.toUpperCase(),
  status,
  statusReason: null,
  baselineVersion: null,
  schemaVersion: null,
  registryVersion: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

let now = T0;
let store: MemoryIncidentStore;
let sent: Array<{ ev: string; i: Incident }>;
let svc: IncidentService;

beforeEach(() => {
  now = T0;
  store = new MemoryIncidentStore();
  sent = [];
  svc = new IncidentService(store, { notify: async (i, ev) => void sent.push({ ev, i }) }, () => now);
});

describe("incidencias", () => {
  it("deduplica: repetir no abre otra ni vuelve a avisar", async () => {
    const a = await svc.raise({ dedupeKey: "k", kind: "x", severity: "warning", title: "t" });
    now += 60_000;
    const b = await svc.raise({ dedupeKey: "k", kind: "x", severity: "warning", title: "t" });
    expect(b.id).toBe(a.id);
    expect(b.occurrences).toBe(2);
    expect(sent.map((s) => s.ev)).toEqual(["opened"]);
  });

  it("escala de severidad avisa; resolver cierra; reaparecer reabre", async () => {
    const a = await svc.raise({ dedupeKey: "k", kind: "x", severity: "warning", title: "t" });
    await svc.raise({ dedupeKey: "k", kind: "x", severity: "critical", title: "t" });
    expect(sent.map((s) => s.ev)).toEqual(["opened", "escalated"]);
    await svc.acknowledge(a.id, "ana");
    expect((await store.get(a.id))!.status).toBe("acknowledged");
    await svc.resolve(a.id, "ana");
    expect((await store.get(a.id))!.status).toBe("resolved");
    const c = await svc.raise({ dedupeKey: "k", kind: "x", severity: "warning", title: "t" });
    expect(c.id).not.toBe(a.id);
    expect(sent.at(-1)!.ev).toBe("reopened");
  });

  it("un notificador que falla no rompe la operación", async () => {
    const bad = new IncidentService(store, { notify: async () => { throw new Error("webhook caído"); } }, () => now);
    await expect(bad.raise({ dedupeKey: "z", kind: "x", severity: "info", title: "t" })).resolves.toBeTruthy();
  });

  it("webhookNotifier exige https y envía texto", async () => {
    expect(() => webhookNotifier("http://x.example")).toThrow();
    const calls: Array<{ url: string; body: string }> = [];
    const n = webhookNotifier("https://hooks.example/abc", (async (url: string, init: { body: string }) => void calls.push({ url, body: init.body })) as unknown as typeof fetch);
    const i = await svc.raise({ dedupeKey: "w", kind: "x", severity: "critical", title: "Caída", tenantId: "acme" });
    await n.notify(i, "opened");
    expect(JSON.parse(calls[0].body).text).toContain("Caída");
    expect(calls[0].body).not.toMatch(/secret|password/i);
  });
});

describe("reglas de alerta", () => {
  it("impago, suspensión, copias antiguas, cuotas y licencias por caducar", async () => {
    const usage = new MemoryUsageStore();
    const hour = Math.floor(T0 / 3_600_000) * 3_600_000;
    await usage.add([{ tenantId: "a", metric: "email.sent", hourStart: hour, quantity: 95 }]);
    const res = await runAlerts({
      reader: { listTenants: async () => [tenant("a", "active"), tenant("b", "grace"), tenant("c", "suspended"), tenant("d", "deleted")] },
      incidents: svc,
      usage,
      quotas: { listQuotas: async (t) => (t === "a" ? [{ tenantId: "a", metric: "email.sent", period: "day", limit: 100, enforcement: "hard" }] : []) },
      entitlements: { listEntitlements: async (t) => (t === "a" ? [{ tenantId: "a", moduleId: "hotel", status: "active", validUntil: new Date(T0 + 86_400_000), source: "crm" }] : []) },
      lastBackupAt: async () => ({ a: T0 - 80 * 3_600_000, b: T0 - 1 * 3_600_000 }),
      failedProvisioning: async () => ["nuevo"],
      now: () => now,
    });
    const keys = res.active.sort();
    expect(keys).toEqual(
      [
        "backup.stale:a",
        "entitlement.expiring:a:hotel",
        "provisioning.failed:nuevo",
        "quota:a:email.sent:day",
        "tenant.grace:b",
        "tenant.suspended:c",
      ].sort(),
    );
    const byKey = Object.fromEntries((await svc.list()).map((i) => [i.dedupeKey, i.severity]));
    expect(byKey["backup.stale:a"]).toBe("critical"); // > 2× el máximo
    expect(byKey["quota:a:email.sent:day"]).toBe("warning"); // 95 %
  });

  it("lo que deja de observarse se resuelve solo", async () => {
    const deps = (status: Tenant["status"]) => ({ reader: { listTenants: async () => [tenant("b", status)] }, incidents: svc, now: () => now });
    await runAlerts(deps("grace"));
    expect((await svc.list({ status: "open" })).length).toBe(1);
    const r = await runAlerts(deps("active"));
    expect(r.resolved).toBe(1);
    expect((await svc.list({ status: "open" })).length).toBe(0);
  });
});

describe("retención", () => {
  const day = 86_400_000;
  const files = (n: number, stepDays = 1): BackupFile[] =>
    Array.from({ length: n }, (_, i) => ({ tenantId: "a", file: `a-${i}.sql.gz`, createdAt: T0 - i * stepDays * day }));

  it("conserva las últimas, las mensuales y lo reciente; nunca borra la más reciente", () => {
    const del = selectBackupsToDelete(files(40), { ...DEFAULT_RETENTION, keepLast: 7, keepMonthly: 2, minAgeDays: 3 }, T0);
    const kept = files(40).filter((f) => !del.includes(f));
    expect(kept.some((f) => f.file === "a-0.sql.gz")).toBe(true);
    expect(kept.length).toBeGreaterThanOrEqual(7);
    expect(del.length).toBeGreaterThan(20);
    expect(del.every((f) => f.file !== "a-0.sql.gz")).toBe(true);
  });

  it("una sola copia vieja no se borra", () => {
    const old: BackupFile[] = [{ tenantId: "a", file: "old.sql.gz", createdAt: T0 - 500 * day }];
    expect(selectBackupsToDelete(old, DEFAULT_RETENTION, T0)).toEqual([]);
  });

  describe("sobre ficheros", () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "es-ret-"));
      for (let i = 0; i < 12; i++) {
        const name = `a-${i}.sql.gz`;
        fs.writeFileSync(path.join(dir, name), "x");
        fs.writeFileSync(path.join(dir, `a-${i}.manifest.json`), JSON.stringify({ tenantId: "a", file: name, createdAt: new Date(T0 - i * 30 * day).toISOString() }));
      }
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("dry-run no borra; apply borra copia y manifiesto", async () => {
      const policy = { keepLast: 3, keepMonthly: 0, minAgeDays: 1 };
      const dry = await runRetention({ backupDir: dir }, { policy, now: T0 });
      expect(dry.backupsDeleted.length).toBe(9);
      expect(fs.readdirSync(dir).length).toBe(24);
      const done = await runRetention({ backupDir: dir }, { policy, now: T0, apply: true });
      expect(done.applied).toBe(true);
      expect(fs.readdirSync(dir).filter((f) => f.endsWith(".sql.gz")).length).toBe(3);
      expect(fs.readdirSync(dir).filter((f) => f.endsWith(".manifest.json")).length).toBe(3);
    });
  });
});

describe("alerta de la medición del Resource Manager", () => {
  const reader = { listTenants: async () => [tenant("a", "active"), tenant("b", "trial"), tenant("z", "deleted")] };
  const H = 3_600_000;

  it("sin consumo de ninguna empresa en servicio durante más de 12 h: aviso; al doble, crítico; al volver, se cierra sola", async () => {
    const usage = new MemoryUsageStore();
    const hour = Math.floor(T0 / H) * H;
    await usage.add([{ tenantId: "a", metric: "http.requests", hourStart: hour - 14 * H, quantity: 5 }]);
    let res = await runAlerts({ reader, incidents: svc, usage, now: () => now });
    expect(res.active).toEqual(["erm.collector_stale"]);
    const open = (await svc.list()).find((i) => i.kind === "erm.collector_stale")!;
    expect(open.severity).toBe("warning");
    expect(open.tenantId).toBeNull();
    now = T0 + 12 * H;
    await runAlerts({ reader, incidents: svc, usage, now: () => now });
    expect((await svc.list()).find((i) => i.kind === "erm.collector_stale" && i.status !== "resolved")!.severity).toBe("critical");
    // Vuelve a medir (basta una empresa): la incidencia se resuelve sola
    await usage.add([{ tenantId: "b", metric: "http.requests", hourStart: Math.floor(now / H) * H, quantity: 1 }]);
    res = await runAlerts({ reader, incidents: svc, usage, now: () => now });
    expect(res.active).not.toContain("erm.collector_stale");
    expect((await svc.list()).every((i) => i.kind !== "erm.collector_stale" || i.status === "resolved")).toBe(true);
  });

  it("nunca medido: crítico; con consumo reciente de una sola empresa: sin alerta; sin medición configurada: no se evalúa", async () => {
    const empty = new MemoryUsageStore();
    await runAlerts({ reader, incidents: svc, usage: empty, now: () => now });
    expect((await svc.list()).find((i) => i.kind === "erm.collector_stale")!.severity).toBe("critical");
    const fresh = new MemoryUsageStore();
    await fresh.add([{ tenantId: "a", metric: "http.requests", hourStart: Math.floor(T0 / H) * H - 2 * H, quantity: 1 }]);
    expect((await runAlerts({ reader, incidents: svc, usage: fresh, now: () => now })).active).not.toContain("erm.collector_stale");
    expect((await runAlerts({ reader, incidents: svc, now: () => now })).active).not.toContain("erm.collector_stale");
  });
});

describe("incidencias de ritmo de fallos (rate.*)", () => {
  it("se cierran solas sin repeticiones en 24 h; una reciente sigue abierta; las demás familias no se tocan", async () => {
    await svc.raise({ dedupeKey: "rate.mail.send_failed", kind: "rate.mail.send_failed", severity: "critical", title: "Correo" });
    now = T0 + 25 * 3_600_000;
    await svc.raise({ dedupeKey: "rate.stripe.worker_failed", kind: "rate.stripe.worker_failed", severity: "critical", title: "Stripe" });
    await svc.raise({ dedupeKey: "manual", kind: "manual.x", severity: "warning", title: "Manual" });
    const res = await runAlerts({ reader: { listTenants: async () => [] }, incidents: svc, now: () => now });
    expect(res.resolved).toBe(1);
    const st = Object.fromEntries((await svc.list()).map((i) => [i.kind, i.status]));
    expect(st).toEqual({ "rate.mail.send_failed": "resolved", "rate.stripe.worker_failed": "open", "manual.x": "open" });
  });
});
