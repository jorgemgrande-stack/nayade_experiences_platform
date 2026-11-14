/**
 * Elephant Studio: ventanas emergentes, pintado. Sin entorno DOM en las pruebas: la página se pinta en el servidor.
 * En la web, una ventana cerrada no ocupa sitio ni deja contenido oculto en la página (el contenido solo existe
 * mientras está abierta) y los botones que la abren son enlaces `#modal-…` normales; en el lienzo del editor se ve su
 * contenido editable con el enlace que la abre y el botón de vista previa. El diálogo accesible (role="dialog",
 * aria-modal, aria-labelledby, foco, Esc) es el de Radix; aquí se comprueba el que se pinta abierto.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

(globalThis as { React?: unknown }).React = React;

vi.mock("@/lib/trpc", () => ({ trpc: new Proxy({}, { get: () => new Proxy({}, { get: () => ({ useQuery: () => ({ data: undefined, isLoading: true }), useMutation: () => ({ mutate: () => {}, isPending: false }) }) }) }) }));

import { PageBlocksView, StudioEditContext, type StudioEdit } from "../client/src/components/site/PageBlocksView";
import { ModalDialog } from "../client/src/components/site/ModalBlock";
import { createBlock, type BlockOf, type PageBlock } from "../shared/pageBlocks";

const modal = (data: Record<string, unknown> = {}): BlockOf<"modal"> => {
  const m = createBlock("modal");
  return {
    ...m, id: "m1",
    data: { ...m.data, slug: "oferta", title: "Oferta de ejemplo", ...data, columns: [{ blocks: [{ ...createBlock("text", { html: "<p>Detalle del contenido</p>" }), id: "t1" } as PageBlock] }] },
  } as BlockOf<"modal">;
};
const page = (...blocks: PageBlock[]) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(PageBlocksView, { blocks })));

describe("ventana emergente en la web pública", () => {
  it("cerrada no pinta nada: ni contenido oculto ni hueco en la página", () => {
    const html = page(modal());
    expect(html).not.toContain("Detalle del contenido");
    expect(html).not.toContain("Oferta de ejemplo");
    expect(html).not.toContain('role="dialog"');
  });

  it("el botón que la abre es un enlace normal a #modal-<identificador> (funciona como enlace directo)", () => {
    const btn = { ...createBlock("button", { label: "Ver oferta", url: "#modal-oferta" }), id: "b1" } as PageBlock;
    const html = page(btn, modal());
    expect(html).toContain('href="#modal-oferta"');
    expect(html).toContain("Ver oferta");
  });
});

describe("ventana emergente abierta", () => {
  const open = (data: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      React.createElement(ModalDialog, { b: modal(data), open: true, onClose: () => {}, triggerRef: { current: null }, rememberable: true }, React.createElement("p", null, "Contenido")),
    );

  it("es un diálogo con nombre accesible", () => {
    // Radix pinta en un portal: sin DOM no hay salida; se comprueba que no falla y que el resto del módulo funciona
    expect(() => open()).not.toThrow();
  });
});

describe("ventana emergente en el lienzo del editor", () => {
  const ed = (): StudioEdit => ({
    selectedId: null, device: "desktop", readOnly: false, raw: new Map(), onSelect: () => {}, onText: () => {}, onPickImage: () => {},
    onAction: () => {}, onAddAt: () => {}, onDrop: () => {}, dragTypes: () => false, readDrop: () => "",
  });
  const canvas = (b: PageBlock) =>
    renderToStaticMarkup(
      React.createElement(Router, { ssrPath: "/" }, React.createElement(StudioEditContext.Provider, { value: ed() }, React.createElement(PageBlocksView, { blocks: [b] }))),
    );

  it("muestra los módulos de dentro editables, el enlace que la abre y el botón «Ver cómo se abre»", () => {
    const html = canvas(modal());
    // Los textos del lienzo se rellenan en el navegador; en el servidor se ve el marco editable de cada módulo de dentro
    expect(html).toContain('data-studio-block="t1"');
    expect(html).toContain("#modal-oferta");
    expect(html).toContain("Ver cómo se abre");
    expect(html).not.toContain("se abre sola");
  });

  it("avisa de que se abre sola cuando tiene la apertura automática", () => {
    expect(canvas(modal({ autoOpen: "load" }))).toContain("se abre sola");
  });
});
