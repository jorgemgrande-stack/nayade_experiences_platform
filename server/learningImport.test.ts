import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InventoryError, parseDuration, planInventory } from "../shared/learningImport";

const lesson = (orden: number, bloques: any[]) => ({ orden, titulo: `LEKTION ${orden}`, url: `https://share.articulate.com/x#/lessons/${orden}`, bloques });
const inv = (modulo: number, lecciones: any[], extra: Record<string, unknown> = {}) => ({ modulo, titulo: `TEIL ${modulo} - KURS`, url: "https://share.articulate.com/x", secciones: [{ orden: 1, titulo: `TEIL ${modulo} – THEMA`, lecciones }], ...extra });
const opts = { courseSlug: "reconnect-online", courseTitle: "RECONNECT ONLINE" };

describe("planificador de importación de Articulate", () => {
  it("convierte secciones, lecciones y bloques conservando títulos originales, orden y origen", () => {
    const plan = planInventory([inv(1, [lesson(1, [
      { orden: 1, tipo: "texto", titulo: "Einführung", descripcion: "Texto" },
      { orden: 2, tipo: "video", titulo: "Matrix Felder - Video", duracion: "09:27", actividad: null },
      { orden: 3, tipo: "pdf", titulo: "Das Unterbewusstsein", archivo: "Unterbewusstsein.pdf", tamano: "171.6 KB" },
      { orden: 4, tipo: "audio_meditacion", titulo: "Meditationsreise - Audio", reproductor: "video", actividad: "meditación guiada" },
      { orden: 5, tipo: "enlace_youtube", titulo: "Empfehlung", etiqueta: "Emotionscode", url: "https://www.youtube.com/watch?v=abc" },
    ])])], opts);
    const m = plan.modules[0];
    expect(m).toMatchObject({ sourceKey: "m1", position: 1, title: "TEIL 1 – THEMA", originalTitle: "TEIL 1 - KURS", sourceUrl: "https://share.articulate.com/x" });
    const b = m.lessons[0].blocks;
    expect(b.map((x) => [x.position, x.kind, x.title])).toEqual([[1, "text", "Einführung"], [2, "video", "Matrix Felder - Video"], [3, "pdf", "Das Unterbewusstsein"], [4, "audio", "Meditationsreise - Audio"], [5, "external_link", "Empfehlung"]]);
    expect(b[1]).toMatchObject({ durationSeconds: 567, resource: { kind: "video" } });
    expect(b[2].resource).toMatchObject({ kind: "pdf", originalName: "Unterbewusstsein.pdf", sizeHint: "171.6 KB" });
    expect(b[3].resource?.provenance).toContain("reproductor de vídeo");
    expect(b[4]).toMatchObject({ externalUrl: "https://www.youtube.com/watch?v=abc", resource: null }); // un enlace de terceros no se convierte en fichero propio
    expect(b[0].resource).toBeNull();
    expect(plan.report.pendingResources).toHaveLength(3);
  });

  it("compara con los recuentos declarados y avisa de diferencias", () => {
    const plan = planInventory([inv(1, [lesson(1, [{ orden: 1, tipo: "video", titulo: "A - Video" }])], { recuento: { lecciones: 2, videos: 1 } })], opts);
    expect(plan.report.perModule[0].mismatches).toEqual(["lecciones: inventario 2, importado 1"]);
  });

  it("detecta posibles duplicados entre módulos sin fusionarlos", () => {
    const v = { orden: 1, tipo: "video", titulo: "Erd-Quell Anbindung - Video", duracion: "06:50" };
    const f = { orden: 2, tipo: "pdf", titulo: "Übung", archivo: "Übung.pdf", tamano: "168.2 KB" };
    const plan = planInventory([inv(1, [lesson(1, [v, f])]), inv(3, [lesson(1, [v, f])])], opts);
    expect(plan.report.duplicates.map((d) => d.reason)).toEqual(["mismo título y duración", "mismo nombre y tamaño de fichero"]);
    expect(plan.report.counts.videos).toBe(2); // ambos se importan: la decisión es de la propietaria
  });

  it("conserva el crédito visible sin atribuirlo ni eliminarlo", () => {
    const plan = planInventory([inv(3, [lesson(1, [{ orden: 1, tipo: "video", titulo: "X - Video" }])], { portada: { credito_visible: "By Sabrina Fleschutz", presentacion_visible: "Mit Indira Birgit Dollinger" } })], opts);
    expect(plan.course.sourceNote).toContain("By Sabrina Fleschutz");
    expect(plan.modules[0].lessons[0].blocks[0].resource?.provenance).toContain("pendiente de verificar");
  });

  it("rechaza inventarios no válidos con la lista de problemas", () => {
    const bad = [{ modulo: 1, secciones: [{ lecciones: [{ titulo: "L", bloques: [{ orden: 1, tipo: "cuestionario", titulo: "?" }, { orden: 1, tipo: "video", titulo: "dup" }, { orden: 2, tipo: "enlace_externo", titulo: "http", url: "http://x" }] }] }], titulo: "T" }, { modulo: 1, secciones: [] }];
    try { planInventory(bad, opts); throw new Error("debía fallar"); } catch (e) {
      expect(e).toBeInstanceOf(InventoryError);
      const p = (e as InventoryError).problems.join("|");
      expect(p).toContain("cuestionario");
      expect(p).toContain("https");
      expect(p).toContain("repetido");
    }
    expect(() => planInventory([], opts)).toThrow(InventoryError);
  });

  it("duraciones", () => {
    expect(parseDuration("09:27")).toBe(567);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration("abc")).toBeNull();
  });

  const dir = "C:/Users/Usuario/Documents/BIG ELEPHANT/Big Elephant Plattform/quantum-soulrise-referencia/articulate/";
  it.skipIf(!existsSync(dir + "articulate-modulo-3.json"))("inventarios reales de RECONNECT: 3 módulos, 21 lecciones y recuentos del inventario", () => {
    const files = [1, 2, 3].map((n) => JSON.parse(readFileSync(dir + `articulate-modulo-${n}.json`, "utf8")));
    const plan = planInventory(files, opts);
    expect(plan.report.counts).toMatchObject({ modules: 3, lessons: 21, videos: 53, audios: 10, pdfs: 23, externalLinks: 3 });
    expect(plan.report.perModule.map((m) => [m.lessons, m.videos, m.audios, m.pdfs])).toEqual([[6, 16, 3, 9], [8, 17, 6, 9], [7, 20, 1, 5]]);
    expect(plan.report.perModule.flatMap((m) => m.mismatches)).toEqual([]);
    expect(plan.report.duplicates).toHaveLength(3);
  });
});
