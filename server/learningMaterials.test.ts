import { describe, expect, it } from "vitest";
import { GB, MB, checkUpload, formatBytes, spaceLevel } from "../shared/learningMaterials";

const base = { kind: "video", mimeType: "video/mp4", sizeBytes: 100 * MB, maxBytes: 2048 * MB, usedBytes: 10 * GB, limitGb: 25 };

describe("materiales: validación de subida", () => {
  it("acepta un fichero del tipo correcto, dentro del máximo y con espacio", () => {
    expect(checkUpload(base)).toEqual({ ok: true });
  });
  it("rechaza tipo incorrecto con un mensaje comprensible", () => {
    const r = checkUpload({ ...base, kind: "pdf", mimeType: "video/mp4" });
    expect(r).toMatchObject({ ok: false, problem: "WRONG_TYPE" });
    expect(r.message).toMatch(/PDF/);
  });
  it("un audio puede llegar como contenedor video/mp4 (Articulate)", () => {
    expect(checkUpload({ ...base, kind: "audio", mimeType: "video/mp4" }).ok).toBe(true);
  });
  it("rechaza ficheros vacíos y demasiado grandes", () => {
    expect(checkUpload({ ...base, sizeBytes: 0 }).problem).toBe("EMPTY");
    expect(checkUpload({ ...base, sizeBytes: 3000 * MB }).problem).toBe("TOO_LARGE");
  });
  it("sin cuota concedida (0 o ausente) no se sube nada", () => {
    expect(checkUpload({ ...base, limitGb: 0 }).problem).toBe("NO_QUOTA");
    expect(checkUpload({ ...base, limitGb: null }).problem).toBe("NO_QUOTA");
  });
  it("rechaza si no cabe y dice cuánto queda; el límite exacto sí cabe", () => {
    const r = checkUpload({ ...base, usedBytes: 24.95 * GB, sizeBytes: 100 * MB });
    expect(r).toMatchObject({ ok: false, problem: "QUOTA_EXCEEDED" });
    expect(r.message).toMatch(/quedan/);
    expect(checkUpload({ ...base, usedBytes: 25 * GB - 100 * MB, sizeBytes: 100 * MB }).ok).toBe(true);
  });
  it("formatea tamaños y niveles de espacio", () => {
    expect(formatBytes(16 * GB)).toBe("16,0 GB");
    expect(formatBytes(2.3 * GB)).toBe("2,30 GB");
    expect(formatBytes(512)).toBe("512 B");
    expect(spaceLevel(10 * GB, 25)).toBe("ok");
    expect(spaceLevel(20 * GB, 25)).toBe("warning");
    expect(spaceLevel(24 * GB, 25)).toBe("critical");
    expect(spaceLevel(26 * GB, 25)).toBe("exceeded");
    expect(spaceLevel(1, 0)).toBe("none");
  });
});
