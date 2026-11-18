/** Implementación real de GitView sobre un repositorio local (clon completo). */
import { spawnSync } from "node:child_process";
import type { GitView } from "./esReleaseLib";

export function gitView(cwd: string = process.cwd()): GitView {
  const run = (args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const must = (args: string[]) => {
    const r = run(args);
    if (r.status !== 0) throw new Error(`git ${args[0]} falló: ${(r.stderr ?? "").slice(0, 200)}`);
    return r.stdout ?? "";
  };
  const commit = (c: string) => {
    if (!/^[0-9a-f]{7,40}$/.test(c)) throw new Error("commit no válido");
    return c;
  };
  return {
    diffFiles: (from, to) => must(["diff", "--name-only", `${commit(from)}..${commit(to)}`]).split("\n").filter(Boolean),
    diffText: (from, to) => must(["diff", "--unified=0", `${commit(from)}..${commit(to)}`, "--", "server", "shared", "client", ":!*.test.ts", ":!*.test.tsx"]),
    blobAt: (c, file) => {
      const r = run(["rev-parse", "--verify", "--quiet", `${commit(c)}:${file}`]);
      return r.status === 0 ? r.stdout.trim() : null;
    },
    sqlAt: (c, file) => {
      const r = run(["show", `${commit(c)}:${file}`]);
      return r.status === 0 ? r.stdout : null;
    },
    isAncestor: (a, d) => run(["merge-base", "--is-ancestor", commit(a), commit(d)]).status === 0,
    existsIn: (c, name) => run(["grep", "-q", "-w", name, commit(c), "--", "server", "shared", "client"]).status === 0,
  };
}
