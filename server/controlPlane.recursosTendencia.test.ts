/** Histórico diario y tendencia de las métricas medidas por empresa (día civil de Madrid). */
import { describe, it, expect } from "vitest";
import { madridDay, tenantMetrics, trendOf } from "./_core/erm/tenantMetrics";
import { MemoryUsageStore, hourOf } from "./_core/erm/usage";

describe("tendencia de consumo", () => {
  it("el día se cuenta en hora de Madrid", () => {
    expect(madridDay(Date.parse("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
  });

  it("serie diaria y tendencia: últimos 7 días frente a los 7 anteriores", async () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    const usage = new MemoryUsageStore();
    const day = 86_400_000;
    const rows = [];
    for (let i = 0; i < 14; i++) rows.push({ tenantId: "t", metric: "http.request", hourStart: hourOf(now - i * day), quantity: i < 7 ? 200 : 100 });
    rows.push({ tenantId: "otra", metric: "http.request", hourStart: hourOf(now), quantity: 9999 });
    await usage.add(rows);
    const r = await tenantMetrics({ usage }, "t", now, 30);
    expect(r.daily).toHaveLength(14);
    expect(r.daily.at(-1)).toMatchObject({ date: "2026-10-24", "http.request": 200 });
    expect(r.trend["http.request"]).toMatchObject({ last7: 200, previous7: 100, change: 1, direction: "up" });
    expect(r.trend["email.sent"]).toMatchObject({ last7: 0, previous7: 0, direction: "flat" });
    // Otra empresa no aparece en la serie
    expect(r.daily.some((x) => x["http.request"] === 9999)).toBe(false);
  });

  it("sin 14 días de periodo no hay comparación; sin medición no hay serie ni tendencia", async () => {
    expect(trendOf([], ["http.request"], "2026-10-24", 7)["http.request"].direction).toBe("unknown");
    const r = await tenantMetrics({}, "t", Date.now(), 30);
    expect(r).toMatchObject({ daily: [], trend: {}, measurement: "not_configured" });
  });
});
