/** Aviso de seguridad al operador tras activar o retirar su segundo factor (plantilla security.mfa_changed). */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { OperatorAuthService } from "./controlPlane/operatorAuth";
import { MemoryOperatorStore } from "./controlPlane/operatorStore";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { base32Decode, hotp, totpStep } from "./controlPlane/totp";

const PW = { root: "ci-only-placeholder-not-a-secret-1", sara: "ci-only-placeholder-not-a-secret-2" };

describe("segundo factor de los operadores", () => {
  it("activar y retirar avisan a la propia persona; sin correo, nada", async () => {
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const clock = { t: Date.UTC(2026, 9, 30, 9) };
    const notices: Array<{ to: string; enabled: boolean }> = [];
    const store = new MemoryOperatorStore({ mfa: true });
    const svc = new OperatorAuthService(store, { now: () => clock.t, mfaKeyring: ring, securityNotice: async (to, i) => void notices.push({ to, enabled: i.enabled }) });
    await svc.bootstrap({ username: "root", displayName: "Raíz", password: PW.root });
    const root = { id: 1, username: "root", role: "superadmin" as const };
    await svc.create(root, { username: "sara", email: "sara@bigelephant.example", displayName: "Sara", role: "admin", password: PW.sara });
    const sara = { id: 2, username: "sara", role: "admin" as const };
    const { secret } = await svc.setupMfa(sara);
    await svc.enableMfa(sara, hotp(base32Decode(secret), totpStep(clock.t)));
    await svc.resetMfa(root, 2);
    expect(notices).toEqual([{ to: "sara@bigelephant.example", enabled: true }, { to: "sara@bigelephant.example", enabled: false }]);
    // root no tiene correo: su cambio no genera aviso
    const r = await svc.setupMfa(root);
    await svc.enableMfa(root, hotp(base32Decode(r.secret), totpStep(clock.t)));
    expect(notices).toHaveLength(2);
  });
});
