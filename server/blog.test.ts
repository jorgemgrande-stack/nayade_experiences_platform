/**
 * Blog (cms-blog): reglas puras, validación, SEO del HTML inicial, guardián de licencia y menú.
 * La prueba con la aplicación real y MySQL está en essential.web.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import { slugify, visibleStatus, isPubliclyVisible, resolvePublishedAt, pageCount, validateBlogDraft, type BlogDraft } from "../shared/blog";
import { blogMetaOverride, blogRouteOf } from "./blogSeo";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { TASK_NAV, LEGACY_NAV } from "../shared/adminNav";

const NOW = Date.UTC(2026, 9, 16, 10);
const draft = (o: Partial<BlogDraft> = {}): BlogDraft => ({
  title: "Hola", slug: "hola", excerpt: "", content: "", featuredImageUrl: "", featuredImageAlt: "",
  authorName: "", category: "", metaTitle: "", metaDescription: "", ...o,
});

describe("reglas del blog", () => {
  it("slugify quita acentos, signos y guiones sobrantes", () => {
    expect(slugify("¡Llega el verano a Álava! (2026)")).toBe("llega-el-verano-a-alava-2026");
    expect(slugify("  --Ñandú  y  más-- ")).toBe("nandu-y-mas");
    expect(slugify("a".repeat(300)).length).toBe(160);
    expect(slugify("¿?")).toBe("");
  });

  it("estado visible: borrador, programada y publicada; solo lo publicado con fecha alcanzada es público", () => {
    expect(visibleStatus("draft", NOW - 1, NOW)).toBe("draft");
    expect(visibleStatus("published", NOW + 60_000, NOW)).toBe("scheduled");
    expect(visibleStatus("published", NOW - 1, NOW)).toBe("published");
    expect(isPubliclyVisible("draft", NOW - 1, NOW)).toBe(false);
    expect(isPubliclyVisible("published", NOW + 1, NOW)).toBe(false);
    expect(isPubliclyVisible("published", null, NOW)).toBe(false);
    expect(isPubliclyVisible("published", NOW, NOW)).toBe(true);
  });

  it("fecha de publicación: al publicar sin fecha, ahora; la programada se respeta; el borrador no inventa fecha", () => {
    expect(resolvePublishedAt("published", undefined, NOW)).toBe(NOW);
    expect(resolvePublishedAt("published", null, NOW)).toBe(NOW);
    expect(resolvePublishedAt("published", NOW + 5, NOW)).toBe(NOW + 5);
    expect(resolvePublishedAt("draft", undefined, NOW)).toBeNull();
    expect(resolvePublishedAt("draft", NOW + 5, NOW)).toBe(NOW + 5);
  });

  it("paginación", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(9)).toBe(1);
    expect(pageCount(10)).toBe(2);
    expect(pageCount(21, 10)).toBe(3);
  });

  it("validación del formulario con mensajes en español", () => {
    expect(validateBlogDraft(draft())).toEqual({});
    const e = validateBlogDraft(draft({ title: " ", slug: "Mal Slug", featuredImageUrl: "javascript:alert(1)", metaTitle: "x".repeat(201) }));
    expect(e.title).toBe("El título es obligatorio.");
    expect(e.slug).toMatch(/minúsculas, números y guiones/);
    expect(e.featuredImageUrl).toMatch(/URL http\(s\)/);
    expect(e.metaTitle).toMatch(/máximo 200/);
    expect(validateBlogDraft(draft({ slug: "" })).slug).toMatch(/obligatoria/);
    expect(validateBlogDraft(draft({ featuredImageUrl: "/media/foto.jpg" }))).toEqual({});
    expect(validateBlogDraft(draft({ featuredImageUrl: "//evil.example/x.jpg" })).featuredImageUrl).toBeDefined();
  });
});

describe("SEO del blog en el HTML inicial", () => {
  const post = { title: "Mi <entrada>", excerpt: "Resumen \"bueno\"", metaTitle: null, metaDescription: null, featuredImageUrl: "https://cdn.example/a.jpg" };
  const deps = (o: { licensed?: boolean; post?: typeof post | null } = {}) => ({
    licensed: async () => o.licensed ?? true,
    getPost: async (slug: string) => (slug === "mi-entrada" ? (o.post === undefined ? post : o.post) : null),
  });

  it("rutas del blog", () => {
    expect(blogRouteOf("/blog")).toEqual({ kind: "list" });
    expect(blogRouteOf("/blog/")).toEqual({ kind: "list" });
    expect(blogRouteOf("/blog/mi-entrada")).toEqual({ kind: "post", slug: "mi-entrada" });
    expect(blogRouteOf("/blog/Mal_Slug")).toBeNull();
    expect(blogRouteOf("/blog/a/b")).toBeNull();
    expect(blogRouteOf("/blogger")).toBeNull();
  });

  it("entrada publicada: título con la marca, descripción del extracto e imagen; todo escapado", async () => {
    const m = await blogMetaOverride("/blog/mi-entrada", "Empresa A", deps());
    expect(m).toEqual({
      title: "Mi &lt;entrada&gt; | Empresa A",
      description: "Resumen &quot;bueno&quot;",
      h1: "Mi &lt;entrada&gt;",
      body: "Resumen &quot;bueno&quot;",
      image: "https://cdn.example/a.jpg",
    });
  });

  it("metaTitle y metaDescription mandan; imagen no http(s) se descarta", async () => {
    const m = await blogMetaOverride("/blog/mi-entrada", "", deps({ post: { ...post, metaTitle: "SEO", metaDescription: "Desc", featuredImageUrl: "javascript:x" } }));
    expect(m?.title).toBe("SEO");
    expect(m?.description).toBe("Desc");
    expect(m?.image).toBeUndefined();
  });

  it("borrador o inexistente, sin licencia o fuera del blog: no aporta nada", async () => {
    expect(await blogMetaOverride("/blog/otra", "A", deps())).toBeNull();
    expect(await blogMetaOverride("/blog/mi-entrada", "A", deps({ post: null }))).toBeNull();
    expect(await blogMetaOverride("/blog/mi-entrada", "A", deps({ licensed: false }))).toBeNull();
    expect(await blogMetaOverride("/blog", "A", deps({ licensed: false }))).toBeNull();
    expect(await blogMetaOverride("/contacto", "A", deps())).toBeNull();
    expect((await blogMetaOverride("/blog", "A & B", deps()))?.title).toBe("Blog | A &amp; B");
  });
});

describe("licencia y menú", () => {
  it("todo el namespace blog (también lo público) lo licencia cms-blog", () => {
    for (const p of ["blog.publicList", "blog.publicGet", "blog.list", "blog.create", "blog.update", "blog.remove", "blog.preview"]) {
      expect(capabilityForProcedure(p), p).toBe("cms-blog");
    }
  });

  it("entrada «Blog» en Web del menú por tareas; el menú de siempre (Náyade) no cambia", () => {
    const web = TASK_NAV.find((s) => s.id === "web")!;
    expect(web.items.find((i) => i.key === "t-blog")).toMatchObject({ href: "/admin/cms/blog", capabilities: ["cms-blog"], roles: ["admin"] });
    expect(JSON.stringify(LEGACY_NAV)).not.toContain("/admin/cms/blog");
  });
});
