/**
 * Contenido de las páginas de la web de cada empresa (`cms.savePageContent`): solo administradores, dirección válida y
 * HTML saneado antes de guardarlo.
 */
import { describe, expect, it, vi } from "vitest";

const saved: unknown[] = [];
vi.mock("./db", async (orig) => {
  const real = await orig<typeof import("./db")>();
  return {
    ...real,
    savePageContent: vi.fn(async (data: { slug: string; content: string }) => {
      const { sanitizeRichHtml } = await import("./_core/htmlSanitize");
      saved.push({ ...data, content: sanitizeRichHtml(data.content) });
      return { success: true, slug: data.slug };
    }),
  };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { sanitizeRichHtml } from "./_core/htmlSanitize";

const ctxFor = (role: string): TrpcContext => ({
  user: { id: 1, openId: "o", email: "a@empresa.example", name: "Ana", loginMethod: "local", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as NonNullable<TrpcContext["user"]>,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});

const page = { slug: "quienes-somos", title: "Quiénes somos", content: "<p>Hola</p>", isPublished: true };

describe("cms.savePageContent", () => {
  it("solo administradores", async () => {
    await expect(appRouter.createCaller(ctxFor("user")).cms.savePageContent(page)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rechaza direcciones no válidas y títulos vacíos", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    for (const slug of ["", "Con-Mayus", "con espacio", "-guion", "guion-", "../admin", "a".repeat(65)]) {
      await expect(caller.cms.savePageContent({ ...page, slug })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(caller.cms.savePageContent({ ...page, title: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("crea o actualiza la página con el HTML saneado", async () => {
    saved.length = 0;
    const r = await appRouter.createCaller(ctxFor("admin")).cms.savePageContent({
      ...page,
      slug: "inicio",
      content: '<h1>Bienvenido</h1><script>alert(1)</script><a href="javascript:alert(1)" onclick="x()">enlace</a>',
    });
    expect(r).toEqual({ success: true, slug: "inicio" });
    const stored = saved[0] as { content: string };
    expect(stored.content).toContain("<h1>Bienvenido</h1>");
    expect(stored.content).not.toContain("<script");
    expect(stored.content).not.toContain("javascript:");
    expect(stored.content).not.toContain("onclick");
  });

  it("el saneado conserva el formato habitual", () => {
    const html = '<h2>Título</h2><p>Texto <strong>fuerte</strong></p><ul><li>uno</li></ul><a href="https://empresa.example">web</a>';
    const out = sanitizeRichHtml(html);
    for (const t of ["<h2>", "<strong>", "<ul>", "<li>", 'href="https://empresa.example"']) expect(out).toContain(t);
  });
});

describe("guardado real", () => {
  it("savePageContent sanea en el servidor (no confía en el cliente)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("export async function savePageContent"));
    expect(fn.slice(0, 800)).toContain("sanitizeRichHtml(data.content)");
  });
});
