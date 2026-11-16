import { describe, it, expect } from "vitest";
import { validateRedirect, resolveRedirect, normalizeFromPath, isProtectedPath, type RedirectRule } from "../shared/redirects";

const rule = (fromPath: string, toPath: string, extra: Partial<RedirectRule> = {}): RedirectRule => ({ id: 1, fromPath, toPath, statusCode: 301, isActive: true, ...extra });

describe("redirecciones: validación", () => {
  it("acepta una regla interna correcta y normaliza el origen", () => {
    const r = validateRedirect({ fromPath: "/Programa-Antiguo/", toPath: "/tienda/reconnect" }, []);
    expect(r).toEqual({ ok: true, fromPath: "/programa-antiguo", toPath: "/tienda/reconnect" });
  });
  it("rechaza destinos externos y trucos de redirección abierta", () => {
    for (const to of ["https://otra.web/x", "//otra.web/x", "/\\otra.web", "javascript:alert(1)", "otra-ruta", "/%2F%2Fotra.web"]) {
      const r = validateRedirect({ fromPath: "/viejo", toPath: to }, []);
      expect(r.ok, to).toBe(false);
    }
  });
  it("rechaza orígenes malformados o con parámetros", () => {
    for (const from of ["viejo", "//viejo", "/con espacio", "/viejo?x=1", "/viejo#a", "/a\\b", ""]) expect(validateRedirect({ fromPath: from, toPath: "/nuevo" }, []).ok, from).toBe(false);
  });
  it("protege la portada, el panel, la API, los ficheros y los archivos técnicos", () => {
    for (const from of ["/", "/admin/cms", "/api/trpc/x", "/cp/v1", "/assets/a.js", "/local-storage/x", "/sitemap.xml", "/robots.txt", "/Admin"]) {
      expect(validateRedirect({ fromPath: from, toPath: "/nuevo" }, []).ok, from).toBe(false);
      expect(isProtectedPath(from), from).toBe(true);
    }
  });
  it("no deja tapar una ruta que ya existe", () => {
    const r = validateRedirect({ fromPath: "/healer-activation", toPath: "/otra" }, [], { existingPaths: new Set(["/healer-activation"]) });
    expect(r.ok).toBe(false);
  });
  it("rechaza origen = destino, duplicados, bucles y cadenas", () => {
    expect(validateRedirect({ fromPath: "/a", toPath: "/a/" }, []).ok).toBe(false);
    expect(validateRedirect({ fromPath: "/a", toPath: "/b" }, [rule("/a", "/c")]).ok).toBe(false);
    const loop = validateRedirect({ fromPath: "/b", toPath: "/a" }, [rule("/a", "/b")]);
    expect(loop.ok === false && /bucle/.test(loop.error)).toBe(true);
    const chain1 = validateRedirect({ fromPath: "/a", toPath: "/b" }, [rule("/b", "/c")]);
    expect(chain1.ok === false && /cadena/.test(chain1.error) && /\/c/.test(chain1.error)).toBe(true);
    const chain2 = validateRedirect({ fromPath: "/b", toPath: "/c" }, [rule("/a", "/b")]);
    expect(chain2.ok === false && /cadena/.test(chain2.error)).toBe(true);
  });
  it("al editar, la propia regla no cuenta como conflicto", () => {
    expect(validateRedirect({ fromPath: "/a", toPath: "/c" }, [rule("/a", "/b", { id: 7 })], { selfId: 7 }).ok).toBe(true);
  });
  it("solo admite 301 y 302", () => {
    expect(validateRedirect({ fromPath: "/a", toPath: "/b", statusCode: 307 }, []).ok).toBe(false);
    expect(validateRedirect({ fromPath: "/a", toPath: "/b", statusCode: 302 }, []).ok).toBe(true);
  });
  it("las rutas localizadas son rutas distintas", () => {
    expect(validateRedirect({ fromPath: "/de/alt", toPath: "/de/neu" }, [rule("/es/alt", "/es/nuevo")]).ok).toBe(true);
  });
});

describe("redirecciones: resolución", () => {
  const rules = [rule("/viejo", "/tienda/reconnect"), rule("/apagada", "/x", { isActive: false, id: 2 }), rule("/con-q", "/destino?a=1", { id: 3 }), rule("/temp", "/t", { statusCode: 302, id: 4 })];
  it("coincide ignorando mayúsculas y barra final, conserva la consulta y usa 301", () => {
    expect(resolveRedirect(rules, "/VIEJO/", "?utm=1")).toEqual({ to: "/tienda/reconnect?utm=1", status: 301, ruleId: 1 });
    expect(resolveRedirect(rules, "/viejo")).toEqual({ to: "/tienda/reconnect", status: 301, ruleId: 1 });
  });
  it("no pisa una consulta propia del destino y respeta el 302", () => {
    expect(resolveRedirect(rules, "/con-q", "?utm=1")?.to).toBe("/destino?a=1");
    expect(resolveRedirect(rules, "/temp")?.status).toBe(302);
  });
  it("ignora reglas apagadas, rutas sin regla y rutas protegidas", () => {
    expect(resolveRedirect(rules, "/apagada")).toBeNull();
    expect(resolveRedirect(rules, "/otra")).toBeNull();
    expect(resolveRedirect([rule("/admin/x", "/y")], "/admin/x")).toBeNull();
  });
  it("nunca sigue un destino inseguro aunque estuviera guardado", () => {
    expect(resolveRedirect([rule("/malo", "https://otra.web")], "/malo")).toBeNull();
  });
  it("normalizeFromPath", () => {
    expect(normalizeFromPath("Foo//Bar/")).toBe("/foo/bar");
  });
});

import { planRenameRedirects } from "../shared/redirects";

describe("redirecciones al renombrar una página", () => {
  it("crea la regla de la dirección antigua a la nueva", () => {
    const p = planRenameRedirects([], "/quantum-healing-activation", "/reconnect");
    expect(p).toEqual({ retarget: [], remove: [], upsert: { id: undefined, fromPath: "/quantum-healing-activation", toPath: "/reconnect" } });
  });
  it("aplana cadenas: lo que apuntaba a la dirección antigua apunta ya a la nueva", () => {
    const p = planRenameRedirects([rule("/muy-antigua", "/vieja", { id: 5 })], "/vieja", "/nueva");
    expect(p?.retarget).toEqual([{ id: 5, toPath: "/nueva" }]);
    expect(p?.upsert.toPath).toBe("/nueva");
  });
  it("retira la regla que taparía la página con su nueva dirección", () => {
    const p = planRenameRedirects([rule("/nueva", "/otra", { id: 9 })], "/vieja", "/nueva");
    expect(p?.remove).toEqual([9]);
  });
  it("si ya había regla desde la dirección antigua, la actualiza en lugar de duplicarla", () => {
    expect(planRenameRedirects([rule("/vieja", "/x", { id: 3 })], "/vieja", "/nueva")?.upsert.id).toBe(3);
  });
  it("no hace nada si la dirección no cambia o es una ruta protegida", () => {
    expect(planRenameRedirects([], "/a", "/a/")).toBeNull();
    expect(planRenameRedirects([], "/admin/x", "/y")).toBeNull();
  });
});
