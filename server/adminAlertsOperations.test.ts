/**
 * Alertas administrativas operativas: solicitudes RGPD (32), caída de la plataforma de un cliente (34), restauración de
 * prueba fallida (39) y publicación automática fallida (42). Cada fuente dispara solo con el hecho real, una vez.
 */
import { describe, expect, it } from "vitest";
import { ADMIN_ALERTS } from "./adminAlerts/catalog";
import { AdminAlertService, type AlertMailer } from "./adminAlerts/service";
import { MemoryAdminAlertStore } from "./adminAlerts/store";
import { DeployWatcher, RESTORE_STALE_MS, RestoreDrillWatcher, UptimeMonitor, deployFailureAlert, isTestTenant, restoreDrillAlerts, type GithubGet } from "./adminAlerts/operations";
import { runAlertCycle } from "./adminAlerts/runtime";
import { MemorySettingsStore } from "./crm/leadNotices";
import { DataRequestService, dataRequestDeadlineAlerts, LEGAL_DEADLINE_DAYS } from "./dataRequests/service";
import { MemoryDataRequestStore } from "./dataRequests/store";
import type { RestoreLogRecord } from "./_core/ops/backupCopies";
import type { MailContent } from "./mail/types";

const T0 = Date.UTC(2026, 9, 30, 10);
const MIN = 60_000;
const DAY = 24 * 3600_000;

function setup() {
  const store = new MemoryAdminAlertStore();
  const sent: Array<{ to: string; c: MailContent }> = [];
  const keys = new Set<string>();
  const mailer: AlertMailer = {
    policy: { mode: "sandbox" },
    send: async (_t, key, _cat, to, c) => {
      if (!keys.has(key)) (keys.add(key), sent.push({ to, c }));
      return { status: "pending", reason: null, duplicate: false, id: sent.length } as never;
    },
  };
  let now = T0;
  const svc = new AdminAlertService({ store, settings: new MemorySettingsStore(), mailer, crmUrl: "https://admin.bigelephant.example", environment: "pruebas", now: () => now });
  const raise = (id: string, f: Parameters<AdminAlertService["raise"]>[1]) => svc.raise(id, f);
  return { svc, store, sent, raise, clock: () => now, tick: (ms: number) => (now += ms) };
}

describe("catálogo", () => {
  it("32, 34, 39 y 42 conectadas con su fuente; solo queda pendiente la 14", () => {
    for (const n of [32, 34, 39, 42]) {
      const a = ADMIN_ALERTS.find((x) => x.n === n)!;
      expect(a.state, a.id).toBe("conectada");
      expect(a.source, a.id).not.toBe("—");
      expect(a.pending, a.id).toBeUndefined();
    }
    expect(ADMIN_ALERTS.filter((a) => a.state === "pendiente").map((a) => a.n)).toEqual([]);
  });
});

describe("solicitudes RGPD (admin.data_request)", () => {
  const input = { kind: "erasure", channel: "email", requesterName: "Ana Cliente", requesterEmail: "ana@cliente.example", tenantId: "empresa-real" };

  it("registrar una solicitud avisa una vez, con el plazo legal de 30 días; sin registro, nada", async () => {
    const { raise, sent, clock } = setup();
    const svc = new DataRequestService({ store: new MemoryDataRequestStore(), raise, now: clock });
    expect(sent).toHaveLength(0);
    const r = await svc.register(input, "operator:1");
    expect(r.status).toBe("received");
    expect(r.dueAt - r.receivedAt).toBe(LEGAL_DEADLINE_DAYS * DAY);
    expect(r.reference).toMatch(/^RGPD-20261030-[A-Z2-9]{6}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0].c.subject).toContain("Solicitud de eliminación o exportación de datos");
    expect(sent[0].c.text).toContain("supresión de los datos");
    expect(sent[0].c.text).not.toContain("ana@cliente.example");
  });

  it("valida la entrada y las transiciones; cerrar exige la resolución", async () => {
    const { clock } = setup();
    const svc = new DataRequestService({ store: new MemoryDataRequestStore(), now: clock });
    await expect(svc.register({ ...input, kind: "otra" }, "operator:1")).rejects.toThrow(/no válida/);
    await expect(svc.register({ ...input, receivedAt: T0 + DAY }, "operator:1")).rejects.toThrow(/futura/);
    const r = await svc.register(input, "operator:1");
    await expect(svc.setStatus(r.id, "resolved", null, "operator:1")).rejects.toThrow(/resuelto/);
    expect((await svc.setStatus(r.id, "in_progress", null, "operator:1")).status).toBe("in_progress");
    expect((await svc.setStatus(r.id, "resolved", "Datos suprimidos el 31/10.", "operator:1")).resolvedAt).toBe(T0);
    await expect(svc.setStatus(r.id, "in_progress", null, "operator:1")).rejects.toThrow(/No se puede pasar/);
  });

  it("escalada al acercarse el plazo y otra al vencer; nada si se resuelve; cada una una sola vez", async () => {
    const { svc: alerts, raise, sent, clock, tick } = setup();
    const store = new MemoryDataRequestStore();
    const svc = new DataRequestService({ store, raise, now: clock });
    const open = await svc.register(input, "operator:1");
    const closed = await svc.register({ ...input, kind: "access" }, "operator:1");
    await svc.setStatus(closed.id, "resolved", "Copia enviada.", "operator:1");
    const cycle = () => runAlertCycle({ alerts, now: clock, operations: [{ name: "dataRequests", run: async () => { const l = dataRequestDeadlineAlerts(await svc.open(), clock()); for (const a of l) await raise(a.id, a.facts); return l.length; } }] });
    expect(dataRequestDeadlineAlerts(await svc.open(), clock())).toEqual([]);
    tick(23 * DAY);
    await cycle();
    await cycle();
    tick(8 * DAY);
    await cycle();
    await cycle();
    const subjects = sent.slice(2).map((s) => s.c.subject);
    expect(subjects).toHaveLength(2);
    expect(subjects.every((s) => s.startsWith("[CRÍTICO]"))).toBe(true);
    expect(sent[2].c.text).toContain("Quedan 7 días");
    expect(sent[3].c.text).toContain("ha superado el plazo legal");
    expect(open.id).not.toBe(closed.id);
  });
});

describe("restauración de prueba (admin.restore_drill_failed)", () => {
  const rec = (id: number, o: Partial<RestoreLogRecord>): RestoreLogRecord => ({ id, startedAt: T0 + MIN, finishedAt: T0 + 2 * MIN, actor: "operator:x", source: "primary", targetKind: "tenant", targetId: "empresa-real", status: "ok", verified: true, switched: false, filesCount: null, error: null, ...o });

  it("solo las fallidas o colgadas desde la activación (pura)", () => {
    const list = [rec(1, {}), rec(2, { status: "failed", verified: false, error: "checksum" }), rec(3, { status: "failed", startedAt: T0 - MIN }), rec(4, { status: "running", finishedAt: null }), rec(5, { status: "running", finishedAt: null, startedAt: T0 })];
    const out = restoreDrillAlerts(list, T0, T0 + RESTORE_STALE_MS);
    expect(out.map((a) => a.facts.key)).toEqual(["restore:2", "restore:5"]);
    expect(out[0].facts.summary).toContain("ha fallado");
    expect(out[1].facts.status.label).toBe("Sin terminar");
  });

  it("la primera pasada solo anota la activación; después avisa una vez por restauración fallida", async () => {
    const { svc, store, raise, sent, clock, tick } = setup();
    const list: RestoreLogRecord[] = [rec(1, { status: "failed", startedAt: T0 - DAY })];
    const w = new RestoreDrillWatcher({ restores: async () => list, store, raise, now: clock });
    expect(await w.tick()).toBe(0);
    tick(MIN);
    list.push(rec(2, { startedAt: clock(), status: "ok" }));
    await w.tick();
    expect(sent).toHaveLength(0);
    list.push(rec(3, { startedAt: clock(), status: "failed", error: "la verificación de tablas no coincide" }));
    await w.tick();
    await w.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].c.subject).toMatch(/^\[CRÍTICO\] Fallo de restauración de prueba/);
    expect((await svc.log({ alertId: "admin.restore_drill_failed" })).length).toBe(1);
  });
});

describe("disponibilidad de cada empresa (admin.customer_down)", () => {
  function monitor(o: { up: () => boolean } , s = setup()) {
    const m = new UptimeMonitor({ targets: async () => [{ tenantId: "t9-cliente", company: "Cliente Real, S.L.", url: "https://cliente.app.bigelephant.example/readyz" }], probe: async () => o.up(), store: s.store, raise: s.raise, now: s.clock });
    return { m, ...s };
  }

  it("un fallo suelto o dos no avisan; 3 seguidos en 5 minutos o más, un único aviso crítico", async () => {
    let up = false;
    const { m, sent, tick } = monitor({ up: () => up });
    await m.tick();
    tick(2 * MIN);
    await m.tick();
    expect(sent).toHaveLength(0);
    tick(2 * MIN);
    await m.tick(); // 3 fallos, pero solo 4 minutos
    expect(sent).toHaveLength(0);
    tick(2 * MIN);
    expect((await m.tick()).down).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].c.subject).toBe("[CRÍTICO] Servicio de un cliente no disponible · Cliente Real, S.L.");
    // Caída prolongada: ningún aviso más
    for (let i = 0; i < 30; i++) (tick(2 * MIN), await m.tick());
    expect(sent).toHaveLength(1);
    // Recuperación: un aviso distinto, una sola vez
    up = true;
    tick(2 * MIN);
    expect((await m.tick()).recovered).toBe(1);
    await m.tick();
    expect(sent).toHaveLength(2);
    expect(sent[1].c.text).toContain("vuelve a responder");
  });

  it("un fallo intermitente que se recupera antes de declararse no avisa de nada", async () => {
    let n = 0;
    const { m, sent, tick } = monitor({ up: () => ++n % 3 === 0 });
    for (let i = 0; i < 20; i++) (tick(2 * MIN), await m.tick());
    expect(sent).toHaveLength(0);
  });

  it("un reinicio a mitad de la caída no repite el aviso y la recuperación sigue llegando", async () => {
    let up = false;
    const s = setup();
    const a = monitor({ up: () => up }, s);
    for (let i = 0; i < 4; i++) (s.tick(2 * MIN), await a.m.tick());
    expect(s.sent).toHaveLength(1);
    const b = monitor({ up: () => up }, s); // proceso nuevo, mismo registro
    for (let i = 0; i < 6; i++) (s.tick(2 * MIN), await b.m.tick());
    expect(s.sent).toHaveLength(1);
    up = true;
    s.tick(MIN);
    await b.m.tick();
    expect(s.sent).toHaveLength(2);
  });

  it("las empresas de prueba o demostración no se vigilan", () => {
    expect(isTestTenant("t1-empresa-demo-elephant-a", "Empresa Demo Elephant A")).toBe(true);
    expect(isTestTenant("cms-prueba-a-20261030")).toBe(true);
    expect(isTestTenant("prueba-e2e-stripe-sandbox-20261018")).toBe(true);
    expect(isTestTenant("t9-cliente", "Cliente Real, S.L.")).toBe(false);
    expect(isTestTenant("t5-skibox", "Skibox")).toBe(false);
  });
});

describe("publicación automática (admin.deploy_failed)", () => {
  const run = (id: number, o: Record<string, unknown> = {}) => ({ id, run_attempt: 1, run_number: id, conclusion: "failure", status: "completed", created_at: new Date(T0 + MIN).toISOString(), head_sha: "a".repeat(40), html_url: `https://github.com/x/y/actions/runs/${id}`, name: "Publicación (tras Railway)", ...o });

  it("solo cuando falla un trabajo de publicación (pura)", () => {
    expect(deployFailureAlert(run(1), [{ name: "Railway terminó en live", conclusion: "failure" }], T0)).toBeNull();
    expect(deployFailureAlert(run(1), [{ name: "Publicar en live / publicar (live)", conclusion: "success" }], T0)).toBeNull();
    const a = deployFailureAlert(run(1), [{ name: "Publicar en live / publicar (live)", conclusion: "success" }, { name: "Publicar en production (ordinario) / publicar (production)", conclusion: "failure" }], T0)!;
    expect(a.facts.key).toBe("deploy:1:1");
    expect(a.facts.status.label).toBe("Fallida en production");
  });

  it("consulta GitHub como mucho cada 10 minutos, solo ejecuciones nuevas y cada una una vez", async () => {
    const { store, raise, sent, clock, tick } = setup();
    const runs: Array<ReturnType<typeof run>> = [run(10, { created_at: new Date(T0 - DAY).toISOString() })];
    const calls: string[] = [];
    const get: GithubGet = async (path) => {
      calls.push(path);
      if (path.includes("/jobs")) return { status: 200, body: { jobs: [{ name: "Publicar en live / publicar (live)", conclusion: path.includes("/runs/12/") ? "success" : "failure" }] } };
      return { status: 200, body: { workflow_runs: path.includes("publicacion.yml") ? runs : [] } };
    };
    const w = new DeployWatcher({ get, repo: "x/y", branch: "integration/elephant-source", store, raise, now: clock });
    expect(await w.tick()).toBe(0); // activación
    expect(calls).toHaveLength(0);
    tick(5 * MIN);
    runs.push(run(11, { created_at: new Date(clock()).toISOString() }), run(12, { created_at: new Date(clock()).toISOString() }), run(13, { conclusion: "success", created_at: new Date(clock()).toISOString() }));
    expect(await w.tick()).toBe(0); // dentro de los 10 minutos
    tick(6 * MIN);
    expect(await w.tick()).toBe(1);
    tick(11 * MIN);
    expect(await w.tick()).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].c.subject).toMatch(/^\[CRÍTICO\] Error de despliegue que afecte a clientes/);
    expect(sent[0].c.text).toContain("ha fallado en live");
    expect(calls.filter((c) => c.includes("/jobs"))).toHaveLength(2); // 11 y 12; la 10 es anterior y la 13 no falló
  });

  it("si GitHub no responde no marca nada y lo reintenta", async () => {
    const { store, raise, sent, clock, tick } = setup();
    let ok = false;
    const get: GithubGet = async (path) => (!ok ? { status: 403, body: null } : path.includes("/jobs") ? { status: 200, body: { jobs: [{ name: "Publicar en live / publicar (live)", conclusion: "failure" }] } } : { status: 200, body: { workflow_runs: [run(20, { created_at: new Date(T0 + 5 * MIN).toISOString() })] } });
    const w = new DeployWatcher({ get, repo: "x/y", branch: "integration/elephant-source", workflows: ["publicacion.yml"], store, raise, now: clock });
    await w.tick();
    tick(11 * MIN);
    await w.tick();
    expect(sent).toHaveLength(0);
    ok = true;
    tick(11 * MIN);
    await w.tick();
    expect(sent).toHaveLength(1);
  });
});
