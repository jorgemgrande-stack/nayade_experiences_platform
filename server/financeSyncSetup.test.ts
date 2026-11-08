/**
 * Puesta en marcha de Finance Sync: cálculo de los pasos y del estado «listo», guardado del buzón en la bóveda de la
 * empresa (cifrado, sin devolver la contraseña), comprobación con límite de tiempo y lectura automática por empresa.
 * Todo con dobles: sin base de datos ni servidores de correo reales.
 */
import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { financeSyncSetup, type FinanceSyncFacts } from "../shared/financeSyncSetup";
import { IntegrationVault, MemoryCredentialStore, type Keyring } from "./_core/credentials/vault";
import { imapLoginCheck, IMAP_CHECK_TIMEOUTS, testProvider, type ImapCheckClient, type MailProbes } from "./_core/credentials/testers";
import { mailHostNameProblem, MailHostError, resolveMailHost, type HostResolver } from "./_core/credentials/mailHost";
import {
  createRateLimiter,
  FinanceSyncSetupError,
  getFinanceSyncSetup,
  readFinanceSyncCounts,
  saveMailbox,
  setMailboxIngestion,
  testMailbox,
  writeIngestionFlag,
  type FinanceSyncCounts,
  type FinanceSyncDeps,
} from "./financeSyncSetup";

const facts = (o: { bank?: number; excel?: number; ops?: number; mailbox?: Partial<FinanceSyncFacts["mailbox"]>; confirmed?: number; suggested?: number } = {}): FinanceSyncFacts => ({
  bank: { imports: o.bank ? 1 : 0, movements: o.bank ?? 0 },
  cardTerminal: { excelImports: o.excel ?? 0, operations: o.ops ?? 0 },
  mailbox: { available: true, state: "off", detail: null, ingestionEnabled: false, emailsRead: 0, ...o.mailbox },
  conciliation: { confirmed: o.confirmed ?? 0, suggested: o.suggested ?? 0 },
});
const step = (f: FinanceSyncFacts, id: string) => financeSyncSetup(f).steps.find((s) => s.id === id)!;

describe("cálculo de los pasos de Finance Sync", () => {
  it("empresa nueva: nada hecho, no está lista y dice qué falta", () => {
    const r = financeSyncSetup(facts());
    expect(r.ready).toBe(false);
    expect(r.completed).toBe(0);
    expect(r.total).toBe(2);
    expect(r.missing).toHaveLength(2);
    expect(r.steps.map((s) => s.id)).toEqual(["bankStatement", "cardTerminal", "mailbox", "conciliation"]);
    expect(step(facts(), "conciliation").status).toBe("blocked");
  });

  it("solo el extracto no basta: falta una fuente del datáfono", () => {
    const r = financeSyncSetup(facts({ bank: 120 }));
    expect(r.ready).toBe(false);
    expect(r.completed).toBe(1);
    expect(r.missing).toEqual(["Importar el Excel de operaciones del datáfono o comprobar el buzón de tickets."]);
  });

  it("extracto + Excel de operaciones: listo; el buzón pasa a opcional y la conciliación queda disponible", () => {
    const f = facts({ bank: 120, excel: 1, ops: 40 });
    const r = financeSyncSetup(f);
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(step(f, "mailbox").status).toBe("optional");
    expect(step(f, "conciliation").status).toBe("todo");
  });

  it("extracto + buzón comprobado (sin Excel): listo", () => {
    const f = facts({ bank: 5, mailbox: { state: "working" } });
    expect(financeSyncSetup(f).ready).toBe(true);
    expect(step(f, "cardTerminal").detail).toMatch(/buzón de tickets comprobado/);
    // Comprobado pero con la lectura apagada: el paso del buzón sigue pendiente
    expect(step(f, "mailbox").status).toBe("todo");
    expect(step({ ...f, mailbox: { ...f.mailbox, ingestionEnabled: true } }, "mailbox").status).toBe("done");
  });

  it("un buzón guardado sin comprobar, o que falla, no cuenta como fuente", () => {
    expect(financeSyncSetup(facts({ bank: 5, mailbox: { state: "unchecked" } })).ready).toBe(false);
    const failing = facts({ bank: 5, mailbox: { state: "failing", detail: "El servidor rechaza el usuario o la contraseña" } });
    expect(financeSyncSetup(failing).ready).toBe(false);
    expect(step(failing, "mailbox").status).toBe("attention");
    expect(step(failing, "cardTerminal").status).toBe("attention");
  });

  it("operaciones sueltas sin fuente comprobada (p. ej. de otra vía) no dan el paso por hecho", () => {
    expect(step(facts({ bank: 5, ops: 10 }), "cardTerminal").status).toBe("todo");
  });

  it("sin bóveda por empresa (instalación única) el buzón es opcional y no bloquea", () => {
    const f = facts({ bank: 5, excel: 1, mailbox: { available: false, state: "working" } });
    expect(step(f, "mailbox").status).toBe("optional");
    expect(financeSyncSetup(facts({ bank: 5, mailbox: { available: false, state: "working" } })).ready).toBe(false);
  });

  it("primera conciliación: sugerencias pendientes y confirmadas", () => {
    expect(step(facts({ bank: 5, excel: 1, suggested: 3 }), "conciliation").detail).toMatch(/3 sugerencias pendientes/);
    expect(step(facts({ bank: 5, excel: 1, confirmed: 1 }), "conciliation").status).toBe("done");
  });
});

// ─── Dobles ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const ring: Keyring = { keys: new Map([["k1", crypto.randomBytes(32)]]), activeId: "k1" };
const ZERO: FinanceSyncCounts = { bankImports: 0, bankMovements: 0, tpvExcelImports: 0, cardOperations: 0, emailsRead: 0, confirmedConciliations: 0, suggestedConciliations: 0 };
const SECRET = "contrasena-de-prueba-no-real";

const ACTOR = { id: 1, name: "Ana" };
/** DNS de prueba: nombres de ejemplo con IP pública de documentación… salvo los que se hacen pasar por internos. */
const fakeDns: HostResolver = async (h) => (h.startsWith("interno.") ? ["10.0.0.5"] : h.startsWith("metadatos.") ? ["169.254.169.254"] : ["8.8.8.8"]);

function harness(o: { tenant?: string; multi?: boolean; counts?: Partial<FinanceSyncCounts>; probe?: FinanceSyncDeps["probe"]; allowTest?: FinanceSyncDeps["allowTest"] } = {}) {
  const store = new MemoryCredentialStore();
  const vault = new IntegrationVault(store, () => o.tenant ?? "empresa-a", () => ring);
  const checks: Array<{ outcome: string; at: string }> = [];
  let flag = false;
  const flagWrites: boolean[] = [];
  const deps: FinanceSyncDeps = {
    multi: () => o.multi ?? true,
    tenantId: () => o.tenant ?? "empresa-a",
    checkHost: async (host) => {
      await resolveMailHost(host, fakeDns);
    },
    allowTest: o.allowTest ?? (() => true),
    vault: () => vault,
    // Estado de integraciones: lo último comprobado (como integration_status)
    health: async () =>
      checks.length ? [{ provider: "imap_tpv", connection: checks.at(-1)!.outcome === "connected" ? "connected" : "error", stateAt: checks.at(-1)!.at, lastCheck: { message: "ok" }, lastSync: null }] : [],
    probe: o.probe ?? (async () => ({ ok: true, message: "Buzón accesible", outcome: "connected" })),
    recordCheck: async (outcome) => {
      checks.push({ outcome, at: new Date().toISOString() });
    },
    counts: async () => ({ ...ZERO, ...o.counts }),
    ingestion: {
      get: async () => flag,
      set: async (enabled) => {
        flag = enabled;
        flagWrites.push(enabled);
      },
    },
  };
  return { deps, store, vault, checks, flagWrites };
}

const MAILBOX = { host: "imap.ejemplo.test", port: "993", user: "tickets@ejemplo.test", pass: SECRET, allowedSender: "copia@banco.ejemplo.test" };

describe("buzón de tickets en la bóveda de la empresa", () => {
  it("guarda la contraseña cifrada y nunca la devuelve en la pantalla", async () => {
    const h = harness();
    await saveMailbox(h.deps, MAILBOX, ACTOR);
    const pass = (await h.store.list("imap_tpv")).find((r) => r.field === "pass")!;
    expect(pass.secret).toBe(true);
    expect(pass.value).not.toContain(SECRET);
    const view = await getFinanceSyncSetup(h.deps);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    const field = view.mailbox!.fields.find((f) => f.key === "pass")!;
    expect(field.set).toBe(true);
    expect(field.display).toBe("••••real");
    expect(view.mailbox!.state).toBe("unchecked");
  });

  it("aislamiento: lo cifrado para una empresa no se descifra en otra", async () => {
    const a = harness({ tenant: "empresa-a" });
    await saveMailbox(a.deps, MAILBOX, ACTOR);
    const b = new IntegrationVault(a.store, () => "empresa-b", () => ring);
    expect((await b.resolve("imap_tpv")).pass).toBeUndefined();
    expect((await a.vault.resolve("imap_tpv")).pass).toBe(SECRET);
  });

  it("una contraseña en blanco conserva la guardada (si no cambian los datos de conexión)", async () => {
    const h = harness();
    await saveMailbox(h.deps, MAILBOX, ACTOR);
    const r = await saveMailbox(h.deps, { allowedSender: "otra@banco.ejemplo.test", pass: "" }, ACTOR);
    expect(r.saved).toEqual(["allowedSender"]);
    expect((await h.vault.resolve("imap_tpv")).pass).toBe(SECRET);
  });

  it("si cambian servidor, puerto, usuario o cifrado hay que volver a escribir la contraseña", async () => {
    const h = harness();
    await saveMailbox(h.deps, MAILBOX, ACTOR);
    for (const change of [{ host: "imap2.ejemplo.test" }, { port: "143" }, { user: "otro@ejemplo.test" }, { secure: "false" }]) {
      await expect(saveMailbox(h.deps, { ...change, pass: "" }, ACTOR)).rejects.toThrow(/vuelve a escribir la contraseña/);
    }
    expect((await h.vault.resolve("imap_tpv")).host).toBe("imap.ejemplo.test");
    // Mismo valor que el guardado: no es un cambio
    await expect(saveMailbox(h.deps, { host: "imap.ejemplo.test" }, ACTOR)).resolves.toMatchObject({ saved: ["host"] });
    // Con la contraseña escrita de nuevo, sí
    await expect(saveMailbox(h.deps, { host: "imap2.ejemplo.test", pass: "otra-de-prueba-no-real" }, ACTOR)).resolves.toMatchObject({ saved: ["host", "pass"] });
  });

  it("SSRF: no guarda servidores internos, privados ni de metadatos", async () => {
    const h = harness();
    for (const host of ["localhost", "core.railway.internal", "127.0.0.1", "10.1.2.3", "192.168.1.10", "169.254.169.254", "100.64.0.1", "interno.ejemplo.test", "metadatos.ejemplo.test"]) {
      await expect(saveMailbox(h.deps, { ...MAILBOX, host }, ACTOR), host).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/privada o interna/) });
    }
    expect(await h.store.list()).toEqual([]);
  });

  it("al cambiar el buzón se apaga la lectura automática hasta volver a comprobarlo", async () => {
    const h = harness();
    await saveMailbox(h.deps, MAILBOX, ACTOR);
    await testMailbox(h.deps, "user:1");
    await setMailboxIngestion(h.deps, true, ACTOR);
    await new Promise((r) => setTimeout(r, 5));
    const r = await saveMailbox(h.deps, { mailbox: "Tickets" }, ACTOR);
    expect(r.ingestionDisabled).toBe(true);
    expect(h.flagWrites).toEqual([true, false]);
    const view = await getFinanceSyncSetup(h.deps);
    expect(view.ingestionEnabled).toBe(false);
    expect(view.mailbox!.state).toBe("unchecked");
    await expect(setMailboxIngestion(h.deps, true, ACTOR)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rechaza formatos no válidos con el nombre que ve el usuario y campos ajenos", async () => {
    const h = harness();
    await expect(saveMailbox(h.deps, { host: "https://imap mal" }, ACTOR)).rejects.toThrow(/Servidor de correo entrante/);
    await expect(saveMailbox(h.deps, { otro: "x" }, ACTOR)).rejects.toBeInstanceOf(FinanceSyncSetupError);
    expect(await h.store.list()).toEqual([]);
  });

  it("sin bóveda por empresa no se guarda nada", async () => {
    const h = harness({ multi: false });
    await expect(saveMailbox(h.deps, MAILBOX, ACTOR)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await getFinanceSyncSetup(h.deps)).mailbox).toBeNull();
  });
});

describe("comprobar la conexión del buzón", () => {
  it("usa el probador de la bóveda (solo inicio de sesión y carpeta en solo lectura) y registra el resultado", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const probes: MailProbes = {
      imapLogin: async (o) => {
        calls.push(o);
      },
      smtpVerify: async () => {
        throw new Error("no debe usarse");
      },
    };
    const h = harness({ probe: (v) => testProvider("imap_tpv", v, undefined, probes) });
    await saveMailbox(h.deps, MAILBOX, ACTOR);
    const r = await testMailbox(h.deps, "user:1");
    expect(r).toMatchObject({ ok: true, outcome: "connected" });
    expect(calls).toEqual([{ host: "imap.ejemplo.test", port: 993, secure: true, user: "tickets@ejemplo.test", pass: SECRET, mailbox: "INBOX" }]);
    expect(h.checks.map((c) => c.outcome)).toEqual(["connected"]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    const view = await getFinanceSyncSetup({ ...h.deps, counts: async () => ({ ...ZERO, bankMovements: 10, bankImports: 1 }) });
    expect(view.mailbox!.state).toBe("working");
    expect(view.ready).toBe(true);
  });

  it("credenciales rechazadas: queda como «No funciona» sin filtrar el secreto", async () => {
    const probes: MailProbes = { imapLogin: async () => Promise.reject(Object.assign(new Error("AUTHENTICATIONFAILED"), { authenticationFailed: true })), smtpVerify: async () => undefined };
    const h = harness({ probe: (v) => testProvider("imap_tpv", v, undefined, probes) });
    await saveMailbox(h.deps, MAILBOX, ACTOR);
    const r = await testMailbox(h.deps, "user:1");
    expect(r).toMatchObject({ ok: false, outcome: "rejected" });
    expect(h.checks.map((c) => c.outcome)).toEqual(["rejected"]);
  });

  it("corta por tiempo si el servidor no responde", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ probe: () => new Promise(() => undefined) });
      await saveMailbox(h.deps, MAILBOX, ACTOR);
      const p = testMailbox(h.deps, "user:1", 50);
      await vi.advanceTimersByTimeAsync(60);
      await expect(p).resolves.toMatchObject({ ok: false, outcome: "error", message: expect.stringMatching(/no respondió a tiempo/) });
      expect(h.checks.map((c) => c.outcome)).toEqual(["error"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin datos guardados no intenta conectar", async () => {
    const probe = vi.fn();
    const h = harness({ probe });
    const r = await testMailbox(h.deps, "user:1");
    expect(r.ok).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    expect(h.checks).toEqual([]);
  });
});

describe("lectura automática por empresa", () => {
  it("no se enciende sin el buzón comprobado; con él, sí (y se puede apagar siempre)", async () => {
    const h = harness();
    await saveMailbox(h.deps, MAILBOX, ACTOR);
    await expect(setMailboxIngestion(h.deps, true, { id: 1, name: "Ana" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.flagWrites).toEqual([]);
    await testMailbox(h.deps, "user:1");
    await setMailboxIngestion(h.deps, true, { id: 1, name: "Ana" });
    expect((await getFinanceSyncSetup(h.deps)).ingestionEnabled).toBe(true);
    await setMailboxIngestion(h.deps, false, { id: 1, name: "Ana" });
    expect(h.flagWrites).toEqual([true, false]);
  });

  it("el interruptor se escribe en la base de la empresa (feature_flags) con su registro de cambios", async () => {
    const queries: string[] = [];
    const db = {
      execute: async (q: unknown) => {
        const chunks = (q as { queryChunks: unknown[] }).queryChunks;
        queries.push(chunks.map((c) => (typeof c === "object" && c && "value" in c ? (c as { value: string[] }).value.join("") : "?")).join(""));
        return [[{ enabled: 0 }]];
      },
    };
    await writeIngestionFlag(db, true, { id: 7, name: "Ana" });
    expect(queries[0]).toMatch(/SELECT enabled FROM feature_flags/);
    expect(queries[1]).toMatch(/INSERT INTO feature_flags .*ON DUPLICATE KEY UPDATE enabled = VALUES\(enabled\)/s);
    expect(queries[2]).toMatch(/INSERT INTO config_change_logs/);
  });
});

describe("lectura de los datos de la empresa", () => {
  it("suma conciliaciones de remesas y de movimientos y tolera tablas que aún no existen", async () => {
    const db = {
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes("tpv_file_imports")) throw Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
        if (text.includes("'reconciled'")) return [[{ n: 2 }]];
        if (text.includes("'confirmed'")) return [[{ n: "1" }]];
        if (text.includes("'proposed'")) return [[{ n: 4 }]];
        return [[{ n: 3 }]];
      },
    };
    const c = await readFinanceSyncCounts(db);
    expect(c.tpvExcelImports).toBe(0);
    expect(c.confirmedConciliations).toBe(3);
    expect(c.suggestedConciliations).toBe(3 + 4);
    expect(c.bankMovements).toBe(3);
  });
});

describe("límite de ritmo de «Comprobar conexión»", () => {
  it("ventana deslizante por clave", () => {
    let t = 0;
    const allow = createRateLimiter(2, 1000, () => t);
    expect([allow("a"), allow("a"), allow("a"), allow("b")]).toEqual([true, true, false, true]);
    t = 1001;
    expect(allow("a")).toBe(true);
  });

  it("por empresa: al superarlo no se conecta ni se registra nada", async () => {
    const probe = vi.fn(async () => ({ ok: true, message: "ok", outcome: "connected" as const }));
    const allow = createRateLimiter(1, 60_000);
    const a = harness({ tenant: "empresa-a", probe, allowTest: allow });
    const b = harness({ tenant: "empresa-b", probe, allowTest: allow });
    await saveMailbox(a.deps, MAILBOX, ACTOR);
    await saveMailbox(b.deps, MAILBOX, ACTOR);
    await testMailbox(a.deps, "user:1");
    await expect(testMailbox(a.deps, "user:1")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(testMailbox(b.deps, "user:1")).resolves.toMatchObject({ ok: true });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(a.checks).toHaveLength(1);
  });

  it("SSRF también al comprobar: un buzón guardado que ahora resuelve a una IP interna no se conecta", async () => {
    const probe = vi.fn();
    const h = harness({ probe });
    await saveMailbox(h.deps, MAILBOX, ACTOR);
    // El DNS del servidor cambia después de guardarlo
    h.deps.checkHost = async (host) => {
      await resolveMailHost(host, async () => ["127.0.0.1"]);
    };
    await expect(testMailbox(h.deps, "user:1")).resolves.toMatchObject({ ok: false, outcome: "error", message: expect.stringMatching(/privada o interna/) });
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("servidores de correo públicos (SSRF)", () => {
  it("nombres internos e IP no públicas se rechazan sin resolver; los públicos pasan", () => {
    for (const h of ["localhost", "imap.localhost", "core.railway.internal", "buzon.local", "intranet", "127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.5.4", "192.168.0.1", "169.254.169.254", "100.64.1.1", "::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(mailHostNameProblem(h), h).toMatch(/privada o interna/);
    }
    for (const h of ["imap.gmail.com", "outlook.office365.com", "8.8.8.8", "2001:4860:4860::8888"]) expect(mailHostNameProblem(h), h).toBeNull();
  });

  it("resuelve y exige que TODAS las direcciones sean públicas; devuelve la IP y el nombre para SNI", async () => {
    await expect(resolveMailHost("imap.ejemplo.test", async () => ["8.8.8.8", "8.8.4.4"])).resolves.toEqual({ address: "8.8.8.8", servername: "imap.ejemplo.test" });
    await expect(resolveMailHost("imap.ejemplo.test", async () => ["8.8.8.8", "10.0.0.1"])).rejects.toBeInstanceOf(MailHostError);
    await expect(resolveMailHost("imap.ejemplo.test", async () => [])).rejects.toThrow(/No se encuentra/);
    await expect(resolveMailHost("imap.ejemplo.test", async () => Promise.reject(new Error("ENOTFOUND")))).rejects.toThrow(/No se encuentra/);
    await expect(resolveMailHost("8.8.8.8", async () => Promise.reject(new Error("no debe resolver")))).resolves.toEqual({ address: "8.8.8.8", servername: undefined });
  });

  it("la comprobación real conecta a la IP validada con SNI y tiempos acotados, en solo lectura", async () => {
    const opts: Array<Record<string, unknown>> = [];
    const locks: Array<{ path: string; readOnly: boolean }> = [];
    const client: ImapCheckClient = {
      connect: async () => undefined,
      getMailboxLock: async (path, o) => {
        locks.push({ path, readOnly: o.readOnly });
        return { release: () => undefined };
      },
      logout: async () => undefined,
    };
    const login = { host: "imap.ejemplo.test", port: 993, secure: true, user: "u@ejemplo.test", pass: SECRET, mailbox: "INBOX" };
    await imapLoginCheck(login, async () => ["8.8.8.8"], async (o) => {
      opts.push(o);
      return client;
    });
    expect(opts[0]).toMatchObject({ host: "8.8.8.8", servername: "imap.ejemplo.test", port: 993, secure: true, ...IMAP_CHECK_TIMEOUTS });
    expect(Number(opts[0].connectionTimeout) + Number(opts[0].greetingTimeout)).toBeLessThanOrEqual(20_000);
    expect(locks).toEqual([{ path: "INBOX", readOnly: true }]);
    // Interno: ni se crea el cliente; testProvider lo traduce a un error sin el secreto
    const make = vi.fn();
    await expect(imapLoginCheck({ ...login, host: "core.railway.internal" }, async () => ["8.8.8.8"], make)).rejects.toBeInstanceOf(MailHostError);
    expect(make).not.toHaveBeenCalled();
    const r = await testProvider("imap_tpv", { host: "localhost", user: "u", pass: SECRET }, undefined, { imapLogin: (o) => imapLoginCheck(o, async () => ["127.0.0.1"], make), smtpVerify: async () => undefined });
    expect(r).toMatchObject({ ok: false, outcome: "error", message: expect.stringMatching(/privada o interna/) });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});
