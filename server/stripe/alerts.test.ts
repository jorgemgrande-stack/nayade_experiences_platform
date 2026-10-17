/** Cada alerta que anota el código de Stripe tiene regla: sin ella `recordFailure` la descarta en silencio. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FailureAlerts } from "../_core/ops/failureAlerts";
import { STRIPE_FAILURE_RULES } from "./alerts";

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });

describe("alertas de Stripe", () => {
  it("todos los tipos anotados en server/stripe y en el orquestador tienen regla", () => {
    const files = [...sources(path.resolve(__dirname)), path.resolve(__dirname, "../orchestrator/service.ts"), path.resolve(__dirname, "../controlPlane/api.ts")];
    const kinds = new Set<string>();
    for (const f of files) for (const m of Array.from(fs.readFileSync(f, "utf8").matchAll(/recordFailure\("((?:stripe|orders\.stripe)[a-z_.]*)"/g))) kinds.add(m[1]);
    expect(kinds.size).toBeGreaterThan(10);
    const missing = Array.from(kinds).filter((k) => !STRIPE_FAILURE_RULES[k]);
    expect(missing).toEqual([]);
  });

  it("una sola anotación de un dato que no corresponde abre la incidencia", async () => {
    const raised: string[] = [];
    const a = new FailureAlerts({ incidents: { raise: async (i: { dedupeKey: string }) => void raised.push(i.dedupeKey) } as never, rules: STRIPE_FAILURE_RULES });
    expect(await a.record("stripe.event_mismatch")).toBe(true);
    expect(await a.record("stripe.gateway_error")).toBe(false);
    expect(raised).toEqual(["rate:stripe.event_mismatch"]);
  });
});
