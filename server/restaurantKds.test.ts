/**
 * Restaurant Net · cocina (KDS) — reglas puras (shared/restaurantKds.ts). El recorrido con base de datos real está en
 * restaurantKds.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import { kdsSettingsProblem, kitchenMetrics, kitchenTransitionProblem, madridDayRange, stationFor, trafficLight } from "../shared/restaurantKds";
import { isMissingKdsSchema, isMissingSalaSchema } from "./restaurantNetDb";

const MIN = 60_000;

describe("estados de cocina", () => {
  it("avanza (también saltando pasos) y deshace solo un paso", () => {
    expect(kitchenTransitionProblem("sent", "preparing")).toBeNull();
    expect(kitchenTransitionProblem("sent", "ready")).toBeNull();
    expect(kitchenTransitionProblem("preparing", "served")).toBeNull();
    expect(kitchenTransitionProblem("ready", "preparing")).toBeNull();
    expect(kitchenTransitionProblem("served", "sent")).toMatch(/un paso/);
    expect(kitchenTransitionProblem("ready", "ready")).toBeNull();
  });
  it("una línea sin marchar o anulada no cambia desde cocina", () => {
    expect(kitchenTransitionProblem("pending", "preparing")).toMatch(/marchado/);
    expect(kitchenTransitionProblem("void", "ready")).toMatch(/anulada/);
  });
});

describe("semáforo", () => {
  const s = { greenMaxMin: 10, amberMaxMin: 20 };
  it("verde, ámbar y rojo según los minutos desde la marcha", () => {
    const t0 = 1_000_000_000_000;
    expect(trafficLight(t0, t0 + 5 * MIN, s)).toBe("green");
    expect(trafficLight(t0, t0 + 10 * MIN, s)).toBe("green");
    expect(trafficLight(t0, t0 + 15 * MIN, s)).toBe("amber");
    expect(trafficLight(t0, t0 + 21 * MIN, s)).toBe("red");
    expect(trafficLight(null, t0, s)).toBe("green");
  });
  it("umbrales válidos: el ámbar mayor que el verde", () => {
    expect(kdsSettingsProblem(10, 20)).toBeNull();
    expect(kdsSettingsProblem(20, 20)).toMatch(/mayor/);
    expect(kdsSettingsProblem(0, 20)).toMatch(/verde/);
    expect(kdsSettingsProblem(10, 500)).toMatch(/ámbar/);
  });
});

describe("enrutado a partidas", () => {
  const routing = new Map([["Postres", "Postres"], ["Bebidas", "Barra"]]);
  it("manda la categoría; si no hay enrutado, la partida del plato; si no, ninguna", () => {
    expect(stationFor("Bebidas", "Cocina", routing)).toBe("Barra");
    expect(stationFor("Entrantes", "Cocina", routing)).toBe("Cocina");
    expect(stationFor(null, "  ", routing)).toBeNull();
  });
});

describe("métricas del día", () => {
  it("tiempos medios de preparación y pase, tarde según la partida, por partida y platos más lentos", () => {
    const t = 1_700_000_000_000;
    const m = kitchenMetrics(
      [
        { name: "Arroz", station: "Cocina", quantity: 2, firedAt: t, readyAt: t + 20 * MIN, servedAt: t + 22 * MIN },
        { name: "Ensalada", station: "Cocina", quantity: 1, firedAt: t, readyAt: t + 4 * MIN, servedAt: t + 5 * MIN },
        { name: "Caña", station: "Barra", quantity: 3, firedAt: t, readyAt: t + 1 * MIN, servedAt: null },
        { name: "Tarta", station: null, quantity: 1, firedAt: t, readyAt: null, servedAt: null },
      ],
      new Map([["Cocina", 15], ["Barra", 3]]),
      2,
    );
    expect(m.totals).toEqual({ lines: 4, plates: 7, avgCookMin: 8.3, avgServeMin: 1.5, lateCount: 1, incidents: 2 });
    expect(m.byStation).toEqual([
      { station: "Cocina", plates: 3, avgCookMin: 12, lateCount: 1 },
      { station: "Barra", plates: 3, avgCookMin: 1, lateCount: 0 },
      { station: "Sin partida", plates: 1, avgCookMin: 0, lateCount: 0 },
    ]);
    expect(m.slowest.map((x) => x.name)).toEqual(["Arroz", "Ensalada", "Caña"]);
  });
  it("sin líneas, todo a cero", () => {
    expect(kitchenMetrics([], new Map()).totals).toEqual({ lines: 0, plates: 0, avgCookMin: 0, avgServeMin: 0, lateCount: 0, incidents: 0 });
  });
});

describe("día de Madrid y migraciones", () => {
  it("el día empieza a medianoche de Madrid (invierno y verano)", () => {
    expect(new Date(madridDayRange("2026-01-15").start).toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(new Date(madridDayRange("2026-07-15").start).toISOString()).toBe("2026-07-14T22:00:00.000Z");
    const r = madridDayRange("2026-07-15");
    expect(r.end - r.start).toBe(86_400_000 - 1);
  });
  it("distingue la falta de la 0035 (cocina) de la falta de la 0033 (sala)", () => {
    const kdsMissing = { code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'x.hospo_kitchen_stations' doesn't exist" };
    const salaMissing = { code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'x.hospo_orders' doesn't exist" };
    expect(isMissingKdsSchema(kdsMissing)).toBe(true);
    expect(isMissingSalaSchema(kdsMissing)).toBe(false);
    expect(isMissingKdsSchema(salaMissing)).toBe(false);
    expect(isMissingSalaSchema(salaMissing)).toBe(true);
  });
});
