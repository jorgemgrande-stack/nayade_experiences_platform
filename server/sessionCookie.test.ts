/** Cookie de sesión de la aplicación: `__Host-` por HTTPS y cookie antigua solo donde no hay riesgo (MEDIO-8). */
import { describe, it, expect, afterEach } from "vitest";
import { clearSessionCookies, readSessionToken, setSessionCookie, SESSION_COOKIE_HOST, SESSION_COOKIE_LEGACY } from "./_core/sessionCookie";

const req = (cookie: string, secure: boolean) => ({ headers: { cookie }, secure }) as any;
const fakeRes = () => {
  const calls: { op: string; name: string; value?: string; opts: any }[] = [];
  return {
    calls,
    cookie: (name: string, value: string, opts: any) => calls.push({ op: "set", name, value, opts }),
    clearCookie: (name: string, opts: any) => calls.push({ op: "clear", name, opts }),
  } as any;
};
const prevMode = process.env.TENANT_MODE;
afterEach(() => {
  process.env.TENANT_MODE = prevMode;
});

describe("cookie de sesión de la aplicación", () => {
  it("por HTTPS emite __Host- (Secure, Path=/, sin Domain) y borra la antigua; sin HTTPS, la de siempre", () => {
    const r = fakeRes();
    setSessionCookie(req("", true), r, "tok", 1000);
    expect(r.calls[0]).toMatchObject({ op: "set", name: SESSION_COOKIE_HOST, value: "tok", opts: { secure: true, path: "/", httpOnly: true, sameSite: "lax" } });
    expect(r.calls[0].opts.domain).toBeUndefined();
    expect(r.calls[1]).toMatchObject({ op: "clear", name: SESSION_COOKIE_LEGACY });
    const h = fakeRes();
    setSessionCookie(req("", false), h, "tok", 1000);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ name: SESSION_COOKIE_LEGACY, opts: { path: "/", httpOnly: true } });
  });

  it("multiempresa por HTTPS: solo __Host- (la antigua podría venir de otra empresa del mismo dominio padre)", () => {
    process.env.TENANT_MODE = "multi";
    expect(readSessionToken(req(`${SESSION_COOKIE_LEGACY}=viejo`, true))).toBeUndefined();
    expect(readSessionToken(req(`${SESSION_COOKIE_LEGACY}=viejo; ${SESSION_COOKIE_HOST}=nuevo`, true))).toBe("nuevo");
    // Sin HTTPS (desarrollo) se mantiene la antigua
    expect(readSessionToken(req(`${SESSION_COOKIE_LEGACY}=viejo`, false))).toBe("viejo");
  });

  it("una sola empresa: la cookie antigua sigue valiendo por HTTPS (la transición no cierra sesiones)", () => {
    process.env.TENANT_MODE = "single";
    expect(readSessionToken(req(`${SESSION_COOKIE_LEGACY}=viejo`, true))).toBe("viejo");
    expect(readSessionToken(req(`${SESSION_COOKIE_LEGACY}=viejo; ${SESSION_COOKIE_HOST}=nuevo`, true))).toBe("nuevo");
  });

  it("cookies mal codificadas no lanzan y el cierre borra las dos variantes", () => {
    expect(readSessionToken(req(`${SESSION_COOKIE_HOST}=%E0%A4%A`, true))).toBe("%E0%A4%A");
    const r = fakeRes();
    clearSessionCookies(r);
    expect(r.calls.map((c: any) => c.name)).toEqual([SESSION_COOKIE_HOST, SESSION_COOKIE_LEGACY]);
    expect(r.calls[0].opts).toMatchObject({ secure: true, path: "/" });
  });
});
