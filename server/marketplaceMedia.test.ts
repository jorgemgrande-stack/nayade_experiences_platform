/**
 * Imágenes oficiales del marketplace: subida con texto alternativo obligatorio, solo imágenes reales, variantes WebP
 * y AVIF sin ampliar ni metadatos, id por huella (sin duplicados), borrado solo si nadie la usa y entrega pública
 * inmutable. Imágenes sintéticas generadas en la prueba.
 */
import type { AddressInfo } from "node:net";
import express from "express";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { MediaError, MediaService, MemoryMediaStore, createPublicMediaRouter, mediaIdFromUrl, mediaSrcset, mediaUrl, sniffImage } from "./web/media";
import { MemoryWebStore } from "./web/store";

let png: Buffer;
let small: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#3366aa" } }).png().withMetadata({ exif: { IFD0: { Copyright: "dato privado" } } }).toBuffer();
  small = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
});

const setup = () => {
  const store = new MemoryMediaStore();
  const web = new MemoryWebStore();
  return { store, web, svc: new MediaService({ store, web, now: () => 1 }) };
};

describe("subida de imágenes del marketplace", () => {
  it("crea variantes WebP y AVIF de 480 a 2400 px sin ampliar y sin metadatos; repetir no duplica", async () => {
    const { svc, store } = setup();
    const r = await svc.upload({ data: png, alt: "Panel de fichajes", author: "operador:1" });
    expect(r.created).toBe(true);
    expect(r.media).toMatchObject({ alt: "Panel de fichajes", width: 1200, height: 800, createdBy: "operador:1" });
    const files = store.rows.get(r.media.id)!.files;
    expect(files.map((f) => f.variant).sort()).toEqual(["w1600.avif", "w1600.webp", "w2400.avif", "w2400.webp", "w480.avif", "w480.webp", "w960.avif", "w960.webp"]);
    expect(files.find((f) => f.variant === "w480.webp")!.width).toBe(480);
    expect(files.find((f) => f.variant === "w2400.webp")!.width).toBe(1200);
    const meta = await sharp(files.find((f) => f.variant === "w960.webp")!.data).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    const again = await svc.upload({ data: png, alt: "Otro texto", author: "operador:2" });
    expect(again).toMatchObject({ created: false, media: { id: r.media.id, alt: "Panel de fichajes" } });
  });

  it("rechaza sin texto alternativo, ficheros que no son imágenes, imágenes pequeñas o dañadas", async () => {
    const { svc } = setup();
    await expect(svc.upload({ data: png, alt: "  ", author: "o" })).rejects.toThrow(/obligatorio/);
    await expect(svc.upload({ data: Buffer.from("<svg onload=alert(1)></svg>".padEnd(64)), alt: "x", author: "o" })).rejects.toThrow(/Solo imágenes/);
    await expect(svc.upload({ data: small, alt: "x", author: "o" })).rejects.toThrow(/al menos 320/);
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.alloc(200)]);
    await expect(svc.upload({ data: broken, alt: "x", author: "o" })).rejects.toBeInstanceOf(MediaError);
  });

  it("sabe qué borradores o publicaciones del catálogo la usan", async () => {
    const { svc, web } = setup();
    const { media } = await svc.upload({ data: png, alt: "Cabecera", author: "o" });
    const src = mediaUrl("https://admin.bigelephant.es", media.id);
    await web.createEntry({ kind: "marketplace_slide", key: "campana", family: null, sortOrder: 0, publication: "draft", draft: { background: { src, alt: "Cabecera" } }, draftVersion: 1, published: null, publishedVersion: null, createdAt: 1, createdBy: "o", updatedAt: 1, updatedBy: "o", publishedAt: null, publishedBy: null });
    expect(await svc.usage(media.id)).toEqual(["marketplace_slide:campana"]);
    const e = (await web.getEntry("marketplace_slide", "campana"))!;
    await web.saveDraft(e.id, e.draftVersion, { background: { src: "https://otra.example/a.webp", alt: "x" } }, 0, "o", 2);
    expect(await svc.usage(media.id)).toEqual([]);
  });

  it("el texto alternativo se puede corregir, nunca vaciar", async () => {
    const { svc } = setup();
    const { media } = await svc.upload({ data: png, alt: "Antes", author: "o" });
    await svc.setAlt(media.id, "Después");
    expect((await svc.list())[0].alt).toBe("Después");
    await expect(svc.setAlt(media.id, "")).rejects.toThrow(/obligatorio/);
  });
});

describe("URLs y entrega pública", () => {
  it("reconoce las URLs del almacén y genera el srcset por formato", () => {
    const id = "a".repeat(32);
    const src = mediaUrl("https://admin.bigelephant.es/", id);
    expect(src).toBe(`https://admin.bigelephant.es/cp/v1/public/media/${id}/w1600.webp`);
    expect(mediaIdFromUrl(src)).toBe(id);
    expect(mediaSrcset(src)!.avif).toContain(`/media/${id}/w480.avif 480w`);
    expect(mediaSrcset("https://otra.example/x.webp")).toBeNull();
    expect(sniffImage(png)).toBe("png");
  });

  it("sirve variantes inmutables con caché de un año; lo demás es 404", async () => {
    const { svc, store } = setup();
    const { media } = await svc.upload({ data: png, alt: "Cabecera", author: "o" });
    const app = express().use("/public/media", createPublicMediaRouter(store));
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/public/media`;
      const ok = await fetch(`${base}/${media.id}/w960.avif`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("image/avif");
      expect(ok.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);
      for (const p of [`${media.id}/original.png`, `${media.id}/w961.webp`, "no-es-un-id/w960.webp", `${"b".repeat(32)}/w960.webp`]) expect((await fetch(`${base}/${p}`)).status, p).toBe(404);
    } finally {
      server.close();
    }
  });
});
