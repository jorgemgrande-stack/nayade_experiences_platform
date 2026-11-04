/**
 * Social Token Net · Tokens internos — recompensas y canjes (STN-2): lógica pura (códigos de un solo uso, condiciones de
 * canje), enlaces firmados del área de puntos y la migración aditiva. El comportamiento con MySQL real está en
 * server/loyaltyRewards.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatRedemptionCode,
  generateRedemptionCode,
  normalizeRedemptionCode,
  rewardDenial,
  type LoyaltyReward,
} from "../shared/loyalty";
import { portalToken, verifyPortalToken } from "./loyaltyPortal";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { destructiveMigration } from "../scripts/deploy/esRailwayLib";

const reward = (o: Partial<LoyaltyReward> = {}): LoyaltyReward => ({
  id: 1, name: "Café", description: null, costPoints: 100, stock: null, perClientLimit: null, limitPeriod: null, codeValidDays: 30, active: true, startsAt: null, endsAt: null, ...o,
});

describe("códigos de canje", () => {
  it("10 caracteres del alfabeto sin ambigüedades, distintos entre sí", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateRedemptionCode((n) => crypto.randomBytes(n))));
    expect(codes.size).toBe(2000);
    for (const c of Array.from(codes)) {
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });
  it("se normaliza lo que se teclea o lee (minúsculas, guiones, espacios) y se rechaza lo que no es un código", () => {
    expect(normalizeRedemptionCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(normalizeRedemptionCode(" ABCDE FGHJK ")).toBe("ABCDEFGHJK");
    expect(normalizeRedemptionCode("ABCDE-FGHJ")).toBeNull();
    expect(normalizeRedemptionCode("ABCDE-FGHJ0")).toBeNull();
    expect(formatRedemptionCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });
});

describe("condiciones de canje", () => {
  const ctx = { at: 1_000, committed: 0, clientCommitted: 0, balance: 500 };
  it("activa, vigente, con unidades, dentro del límite del cliente y con saldo", () => {
    expect(rewardDenial(reward(), ctx)).toBeNull();
    expect(rewardDenial(reward({ active: false }), ctx)).toBe("inactive");
    expect(rewardDenial(reward({ startsAt: 2_000 }), ctx)).toBe("not_started");
    expect(rewardDenial(reward({ endsAt: 500 }), ctx)).toBe("ended");
    expect(rewardDenial(reward({ stock: 3 }), { ...ctx, committed: 3 })).toBe("out_of_stock");
    expect(rewardDenial(reward({ stock: 3 }), { ...ctx, committed: 2 })).toBeNull();
    expect(rewardDenial(reward({ perClientLimit: 1, limitPeriod: "month" }), { ...ctx, clientCommitted: 1 })).toBe("client_limit");
    expect(rewardDenial(reward({ costPoints: 600 }), ctx)).toBe("insufficient_balance");
  });
});

describe("enlace firmado al área de puntos", () => {
  it("válido para su cliente y hasta que caduca; cualquier cambio lo invalida", () => {
    const now = Date.UTC(2026, 10, 5);
    const t = portalToken(42, now);
    expect(verifyPortalToken(t, now)).toBe(42);
    expect(verifyPortalToken(t, now + 29 * 86_400_000)).toBe(42);
    expect(verifyPortalToken(t, now + 31 * 86_400_000)).toBeNull();
    const [, exp, sig] = t.split(".");
    expect(verifyPortalToken(`43.${exp}.${sig}`, now)).toBeNull();
    expect(verifyPortalToken(`42.${Number(exp) + 86_400}.${sig}`, now)).toBeNull();
    expect(verifyPortalToken("basura", now)).toBeNull();
    expect(verifyPortalToken(undefined, now)).toBeNull();
  });
});

describe("licencia y migración 0028", () => {
  it("los procedimientos de recompensas y canjes exigen la capacidad de tokens", () => {
    for (const p of ["loyalty.rewards", "loyalty.consumeCode", "loyalty.redeemForClient", "loyalty.cancelRedemption", "loyalty.sendPortalLink"]) expect(capabilityForProcedure(p)).toBe("social-token-net-tokens");
  });
  it("es aditiva (ordinaria) y tiene reversión", () => {
    const dir = path.resolve(__dirname, "../db/migrations");
    expect(destructiveMigration(fs.readFileSync(path.join(dir, "0028_loyalty_rewards.sql"), "utf8"))).toBeNull();
    expect(fs.existsSync(path.join(dir, "0028_loyalty_rewards.down.sql"))).toBe(true);
  });
});
