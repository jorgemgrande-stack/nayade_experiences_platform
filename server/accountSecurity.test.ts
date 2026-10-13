/**
 * Seguridad de cuentas (S5 y S6):
 *  - los enlaces de recuperación e invitación no pueden apuntar a un dominio que elija el cliente,
 *  - `auth.me` y el listado de usuarios no devuelven hash de contraseña ni tokens de invitación.
 *
 * BD, correo y RBAC simulados. Los valores sensibles son marcadores ficticios.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  sentInvites: [] as Array<{ setPasswordUrl: string; email: string }>,
  resetUrls: [] as string[],
  users: [] as any[],
}));

vi.mock("./db", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getAllUsers: async () => state.users,
    createInvitedUser: async () => ({ id: 99 }),
    resendUserInvite: async () => undefined,
    getDb: async () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 7, email: "persona@example.invalid", name: "Persona", isActive: true }],
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async () => undefined }),
      execute: async () => [[]],
    }),
  };
});

vi.mock("./inviteEmail", () => ({
  sendInviteEmail: async (p: { setPasswordUrl: string; email: string }) => {
    state.sentInvites.push({ setPasswordUrl: p.setPasswordUrl, email: p.email });
    return true;
  },
}));

vi.mock("./emailTemplates", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    buildPasswordResetHtml: (p: { resetUrl: string }) => {
      state.resetUrls.push(p.resetUrl);
      return "<p>reset</p>";
    },
  };
});

vi.mock("./mailer", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, sendEmail: async () => true };
});

vi.mock("./emailManager", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, logDirectEmail: async () => undefined };
});

vi.mock("./_core/rbac", () => ({
  checkRbacOrLegacy: async () => true,
  getUserPermissions: async () => [],
}));

import { appRouter } from "./routers";
import { createPasswordResetRouter } from "./passwordReset";
import { getTrustedBaseUrl } from "./_core/publicUrl";
import { toPublicUser } from "./_core/publicUser";
import type { TrpcContext } from "./_core/context";

const SENSITIVE = {
  passwordHash: "FICTICIO_HASH_NO_REAL",
  inviteToken: "FICTICIO_TOKEN_INVITACION",
  inviteTokenExpiry: new Date("2030-01-01"),
};

const baseUser = {
  id: 1,
  openId: "u-1",
  name: "Admin de Prueba",
  email: "admin@example.invalid",
  loginMethod: "local",
  role: "admin",
  partnerId: null,
  supplierId: null,
  phone: null,
  avatarUrl: null,
  isActive: true,
  inviteAccepted: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
  ...SENSITIVE,
};

function ctx(user: any): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {}, socket: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const ENV = { ...process.env };
beforeEach(() => {
  state.sentInvites.length = 0;
  state.resetUrls.length = 0;
  state.users = [{ ...baseUser }, { ...baseUser, id: 2, email: "otro@example.invalid" }];
  process.env.APP_URL = "https://app.ejemplo.test/";
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("getTrustedBaseUrl", () => {
  it("usa APP_URL sin barra final", () => {
    process.env.APP_URL = "https://app.ejemplo.test///";
    expect(getTrustedBaseUrl()).toBe("https://app.ejemplo.test");
  });
  it("en desarrollo sin APP_URL usa localhost", () => {
    delete process.env.APP_URL;
    process.env.NODE_ENV = "development";
    expect(getTrustedBaseUrl()).toMatch(/^http:\/\/localhost:\d+$/);
  });
  it("en producción sin APP_URL falla de forma visible", () => {
    delete process.env.APP_URL;
    process.env.NODE_ENV = "production";
    expect(() => getTrustedBaseUrl()).toThrow(/APP_URL/);
  });
});

describe("toPublicUser", () => {
  it("elimina hash y tokens y conserva el resto", () => {
    const out = toPublicUser({ ...baseUser }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("passwordHash");
    expect(out).not.toHaveProperty("inviteToken");
    expect(out).not.toHaveProperty("inviteTokenExpiry");
    expect(out).toMatchObject({ id: 1, role: "admin", email: "admin@example.invalid", isActive: true });
  });
  it("no muta el original y admite null", () => {
    const src = { ...baseUser };
    toPublicUser(src);
    expect(src.passwordHash).toBe(SENSITIVE.passwordHash);
    expect(toPublicUser(null)).toBeNull();
  });
});

describe("S6 — auth.me y listado de usuarios", () => {
  it("auth.me no devuelve passwordHash ni tokens", async () => {
    const me: any = await appRouter.createCaller(ctx({ ...baseUser })).auth.me();
    expect(me).toMatchObject({ id: 1, role: "admin", name: "Admin de Prueba" });
    expect(JSON.stringify(me)).not.toMatch(/FICTICIO_/);
    expect(me).not.toHaveProperty("passwordHash");
    expect(me).not.toHaveProperty("inviteToken");
  });
  it("auth.me sin sesión devuelve null", async () => {
    const me = await appRouter.createCaller(ctx(null)).auth.me();
    expect(me).toBeNull();
  });
  it("el listado de usuarios del admin tampoco los devuelve", async () => {
    const list: any[] = await appRouter.createCaller(ctx({ ...baseUser })).admin.getUsers();
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toMatch(/FICTICIO_/);
    expect(list[0]).toMatchObject({ id: 1, role: "admin" });
  });
});

describe("S5 — enlaces de recuperación e invitación", () => {
  function forgotHandler() {
    const router = createPasswordResetRouter() as any;
    const layer = router.stack.find((l: any) => l.route?.path === "/api/auth/forgot-password");
    return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
  }
  function res() {
    const r: any = { statusCode: 200, body: undefined };
    r.status = (c: number) => ((r.statusCode = c), r);
    r.json = (b: unknown) => ((r.body = b), r);
    return r;
  }

  it("forgot-password ignora el origin enviado por el cliente", async () => {
    const r = res();
    await forgotHandler()({ body: { email: "persona@example.invalid", origin: "https://atacante.example" } }, r);
    expect(r.statusCode).toBe(200);
    expect(state.resetUrls).toHaveLength(1);
    expect(state.resetUrls[0].startsWith("https://app.ejemplo.test/nueva-contrasena?token=")).toBe(true);
    expect(state.resetUrls[0]).not.toContain("atacante");
  });

  it("forgot-password sin origin usa la misma URL de confianza", async () => {
    const r = res();
    await forgotHandler()({ body: { email: "persona@example.invalid" } }, r);
    expect(state.resetUrls[0].startsWith("https://app.ejemplo.test/")).toBe(true);
  });

  it("createUser ignora el origin y usa la URL de confianza", async () => {
    await appRouter.createCaller(ctx({ ...baseUser })).admin.createUser({
      name: "Nueva Persona",
      email: "nueva@example.invalid",
      role: "agente",
      origin: "https://atacante.example",
    } as any);
    expect(state.sentInvites).toHaveLength(1);
    expect(state.sentInvites[0].setPasswordUrl.startsWith("https://app.ejemplo.test/establecer-contrasena?token=")).toBe(true);
    expect(state.sentInvites[0].setPasswordUrl).not.toContain("atacante");
  });

  it("resendInvite ignora el origin y sigue aceptando clientes que no lo envían", async () => {
    const caller = appRouter.createCaller(ctx({ ...baseUser }));
    await caller.admin.resendInvite({ userId: 5, email: "x@example.invalid", name: "X", origin: "https://atacante.example" });
    await caller.admin.resendInvite({ userId: 5, email: "x@example.invalid", name: "X" });
    expect(state.sentInvites).toHaveLength(2);
    for (const s of state.sentInvites) {
      expect(s.setPasswordUrl.startsWith("https://app.ejemplo.test/establecer-contrasena?token=")).toBe(true);
    }
  });
});
