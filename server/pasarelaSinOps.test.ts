/** La pasarela pública nunca deja pasar los canales internos del Core (/_ops/*): solo por la red privada. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const caddy = fs.readFileSync(path.resolve(__dirname, "../deploy/railway/gateway/Caddyfile"), "utf8").replace(/\r\n/g, "\n");

describe("pasarela: /_ops/* cerrado desde internet", () => {
  it("responde 404 a /_ops y /_ops/* antes de cualquier proxy", () => {
    expect(caddy).toMatch(/@internal path \/_ops \/_ops\/\*\n\thandle @internal \{\n\t\trespond 404\n\t\}/);
    expect(caddy.indexOf("@internal path")).toBeLessThan(caddy.indexOf("reverse_proxy {$UPSTREAM}"));
  });
  it("el plano de control llama al Core por la red privada, no por la pasarela", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "controlPlane/tenantAccess.ts"), "utf8");
    expect(src).toMatch(/DEFAULT_CORE_INTERNAL_URL = "http:\/\/core\.railway\.internal:3000"/);
  });
});
