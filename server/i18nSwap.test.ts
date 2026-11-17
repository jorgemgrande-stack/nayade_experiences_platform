import { describe, it, expect } from "vitest";
import { swapMenuUrl, swapPageRoles, type SwapBase, type SwapTranslation } from "../shared/i18nSwap";

const blk = (id: string, text: string) => ({ id, type: "text", data: { text } }) as any;
const base = (o: Partial<SwapBase> = {}): SwapBase => ({ slug: "sobre-mi", title: "Sobre mí", metaTitle: "Sobre mí | X", metaDescription: "Hola", isPublished: true, isHome: false, publishedBlocks: [blk("a", "Hola")], draftBlocks: null, ...o });
const tr = (o: Partial<SwapTranslation> = {}): SwapTranslation => ({
  slug: "ueber-mich", publishedSlug: "ueber-mich", title: "Über mich", metaTitle: "Über mich | X", metaDescription: "Hallo", draftBlocks: [blk("a", "Hallo")], publishedBlocks: [blk("a", "Hallo")],
  publishedMeta: { title: "Über mich", metaTitle: "Über mich | X", metaDescription: "Hallo", ogImageUrl: null }, status: "validated", ...o,
});

describe("intercambio de papeles base ↔ traducción", () => {
  it("el alemán pasa a base y el español queda como traducción validada con su dirección", () => {
    const r = swapPageRoles(base(), tr());
    expect(r.base).toMatchObject({ slug: "ueber-mich", title: "Über mich", publishedBlocks: [blk("a", "Hallo")], draftBlocks: null });
    expect(r.oldLocaleTranslation).toMatchObject({ slug: "sobre-mi", publishedSlug: "sobre-mi", title: "Sobre mí", status: "validated", publishedBlocks: [blk("a", "Hola")] });
    expect(r.slugChanged).toBe(true);
    expect(r.oldLocaleTranslation.baseHash).toMatch(/^[0-9a-f]{16}$/);
  });
  it("la portada conserva su dirección interna", () => {
    const r = swapPageRoles(base({ slug: "inicio", isHome: true }), tr({ slug: "startseite", publishedSlug: "startseite" }));
    expect(r.base.slug).toBe("inicio");
    expect(r.slugChanged).toBe(false);
    expect(r.oldLocaleTranslation.slug).toBe("inicio");
  });
  it("un borrador pendiente solo se conserva si difiere de lo publicado", () => {
    expect(swapPageRoles(base(), tr()).base.draftBlocks).toBeNull();
    expect(swapPageRoles(base(), tr({ draftBlocks: [blk("a", "Neu")] })).base.draftBlocks).toEqual([blk("a", "Neu")]);
  });
  it("una página sin publicar da una traducción en borrador y no publica nada", () => {
    const r = swapPageRoles(base({ isPublished: false, publishedBlocks: null, draftBlocks: [blk("a", "Hola")] }), tr({ status: "draft", publishedBlocks: null, publishedSlug: null, publishedMeta: null }));
    expect(r.oldLocaleTranslation).toMatchObject({ status: "draft", publishedSlug: null, publishedBlocks: null });
    expect(r.base.publishedBlocks).toBeNull();
    expect(r.base.slug).toBe("ueber-mich");
  });
  it("direcciones del menú: la traducción manda; si no, sigue a la página que cambió", () => {
    const map = new Map([["sobre-mi", "ueber-mich"]]);
    expect(swapMenuUrl("/sobre-mi", "/kontakt", map)).toBe("/kontakt");
    expect(swapMenuUrl("/sobre-mi", "", map)).toBe("/ueber-mich");
    expect(swapMenuUrl("/sobre-mi#x", undefined, map)).toBe("/ueber-mich#x");
    expect(swapMenuUrl("https://otra.web", undefined, map)).toBe("https://otra.web");
    expect(swapMenuUrl(null, undefined, map)).toBeNull();
  });
});
