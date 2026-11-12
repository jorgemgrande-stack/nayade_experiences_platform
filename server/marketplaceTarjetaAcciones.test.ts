/**
 * Tarjetas del marketplace (/admin/ampliar, fichas y «Suscripción»): las acciones nunca desbordan ni se recortan.
 * Comprobación estática de las clases de la tarjeta compartida (ProductCard), del carril y de las cuadrículas.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const parts = read("client/src/components/connect/ConnectParts.tsx");
const card = parts.slice(parts.indexOf("export function ProductCard("), parts.indexOf("// ── Solicitudes"));

describe("marketplace: acciones de la tarjeta", () => {
  it("las acciones van en un contenedor que parte en varias líneas", () => {
    expect(card).toMatch(/data-card-actions className="[^"]*\bflex\b[^"]*\bflex-wrap\b[^"]*"/);
  });

  it("la acción principal puede encoger y partir su texto (sin altura fija ni nowrap)", () => {
    const primary = card.match(/<Button type="button" size="sm" className="([^"]+)" onClick=\{run\}>/);
    expect(primary).not.toBeNull();
    const cls = primary![1].split(/\s+/);
    for (const c of ["min-w-0", "max-w-full", "whitespace-normal", "text-center", "h-auto", "min-h-10", "shrink"]) expect(cls, c).toContain(c);
    expect(cls).not.toContain("h-10");
    expect(cls).not.toContain("whitespace-nowrap");
  });

  it("«Ver ficha» no se recorta: ocupa su ancho y, sola en su línea, todo el ancho", () => {
    const ficha = card.match(/<Button asChild variant="outline" size="sm" className="([^"]+)">\s*<Link href=\{href\}>\s*Ver ficha/);
    expect(ficha).not.toBeNull();
    const cls = ficha![1].split(/\s+/);
    for (const c of ["shrink-0", "grow", "max-w-full", "h-auto", "min-h-10"]) expect(cls, c).toContain(c);
  });

  it("la descripción admite más líneas y las acciones quedan abajo", () => {
    expect(card).toMatch(/\{lead && <p className="[^"]*line-clamp-4/);
    expect(card).toMatch(/className="mt-auto /);
    expect(card).toMatch(/cx-card [^"]*\bflex h-full flex-col\b/);
  });

  it("el carril y las cuadrículas dimensionan por el espacio disponible, no por el viewport", () => {
    const rail = read("client/src/components/connect/Rail.tsx");
    expect(rail).toMatch(/className="relative @container"/);
    expect(rail).toMatch(/@2xl:w-\[calc\(\(100%-1\.25rem\)\/2\)\]/);
    expect(rail).not.toMatch(/(?<![@\w])(sm|md|lg|xl|2xl):w-\[calc/);
    const grid = /grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,19rem\),1fr\)\)\]/;
    expect(read("client/src/pages/admin/connect/ConnectPage.tsx")).toMatch(grid);
    expect(read("client/src/components/connect/SheetBlocks.tsx")).toMatch(grid);
  });
});
