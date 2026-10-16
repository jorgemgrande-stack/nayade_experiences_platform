/**
 * Controles preventivos de ficheros sensibles: `.manus/` y similares no vuelven a entrar en el repositorio,
 * ni por un commit nuevo ni por una fusión que traiga historia antigua.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error módulo .mjs sin tipos
import { sensitiveReason, findSensitive } from "../scripts/ci/sensitive-files.mjs";

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/ci/sensitive-files.mjs");
const HOOKS = path.join(ROOT, ".githooks");

describe("clasificación de rutas", () => {
  it("detecta exportaciones, credenciales, claves y volcados", () => {
    for (const p of [
      ".manus/db/db-query-1774174467142.json",
      ".manus/otra/cosa.txt",
      ".manus-logs/x.log",
      "cualquier/db-query-123.json",
      ".env",
      ".env.production",
      "server/.env.local",
      "certs/servidor.pem",
      "deploy/clave.key",
      "id_ed25519",
      "home/id_rsa.pub",
      "credentials.json",
      "gcp/service-account-prod.json",
      "datos/produccion.sqlite",
      "backup-2026-10-01.sql",
      "volcado.sql.gz",
      ".netrc",
    ])
      expect(sensitiveReason(p), p).not.toBeNull();
  });
  it("no bloquea código, migraciones, plantillas ni la baseline", () => {
    for (const p of [
      "server/_core/index.ts",
      "db/migrations/0001_integration_credentials.sql",
      "db/baseline/0000_baseline.sql",
      "drizzle/0001_init.sql",
      "env.example.txt",
      ".env.example",
      "server/keyring.ts",
      "client/src/pages/Login.tsx",
      "scripts/export-seed.mjs",
      "docs/manus.md",
    ])
      expect(sensitiveReason(p), p).toBeNull();
  });
});

describe("estado del repositorio", () => {
  it("el árbol versionado no contiene ficheros sensibles (en particular .manus/)", () => {
    expect(findSensitive("--tracked", undefined, ROOT)).toEqual([]);
  });
  it(".gitignore excluye .manus/ y las credenciales habituales", () => {
    for (const p of [".manus/db/db-query-1.json", ".manus-logs/a.log", ".env.production", "clave.pem", "id_ed25519", "volcado.sql.gz"]) {
      const r = spawnSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: ROOT });
      expect(r.status, p).toBe(0);
    }
    expect(spawnSync("git", ["check-ignore", "-q", "--no-index", ".env.example"], { cwd: ROOT }).status).toBe(1);
  });
});

describe("historial y gancho pre-commit (repositorio temporal)", () => {
  let dir = "";
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  const write = (p: string, s = "x") => {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), s);
  };
  const run = (...a: string[]) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: "utf8" });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sensibles-"));
    g("init", "-q", "-b", "main");
    g("config", "user.email", "pruebas@example.invalid");
    g("config", "user.name", "Pruebas");
    g("config", "commit.gpgsign", "false");
    write("README.md");
    g("add", ".");
    g("commit", "-q", "-m", "base");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("--range detecta un commit que añade .manus/, también cuando llega por una fusión", () => {
    const base = g("rev-parse", "HEAD");
    g("checkout", "-q", "-b", "antigua");
    write(".manus/db/db-query-1.json", "{}");
    g("add", "-f", ".");
    g("commit", "-q", "-m", "historia antigua");
    g("checkout", "-q", "main");
    write("src/a.ts");
    g("add", ".");
    g("commit", "-q", "-m", "trabajo normal");
    expect(run("--range", `${base}..HEAD`).status).toBe(0);
    g("merge", "-q", "--no-ff", "--no-edit", "antigua");
    const r = run("--range", `${base}..HEAD`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(".manus/db/db-query-1.json");
  });

  it("--range permite el commit que BORRA .manus/", () => {
    const before = g("rev-parse", "HEAD");
    g("rm", "-q", "-r", ".manus");
    g("commit", "-q", "-m", "retirar");
    expect(run("--range", `${before}..HEAD`).status).toBe(0);
    expect(run("--tracked").status).toBe(0);
  });

  it("el gancho pre-commit bloquea .manus/ y deja pasar un commit normal", () => {
    g("config", "core.hooksPath", HOOKS.replace(/\\/g, "/"));
    write(".manus/db/db-query-2.json", "{}");
    g("add", "-f", ".manus");
    const blocked = spawnSync("git", ["commit", "-q", "-m", "no debe entrar"], { cwd: dir, encoding: "utf8" });
    expect(blocked.status).not.toBe(0);
    expect(g("log", "-1", "--format=%s")).toBe("retirar");
    g("reset", "-q");
    fs.rmSync(path.join(dir, ".manus"), { recursive: true, force: true });
    write("src/b.ts");
    g("add", "src/b.ts");
    const ok = spawnSync("git", ["commit", "-q", "-m", "normal"], { cwd: dir, encoding: "utf8" });
    expect(ok.status).toBe(0);
  });
});
