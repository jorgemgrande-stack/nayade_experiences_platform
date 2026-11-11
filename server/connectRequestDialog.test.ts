/**
 * Diálogo «Contratar e iniciar implantación» (clase B) del marketplace del panel (12/11/2026). En production, con
 * Restaurant Net, «Solicitar contratación» cerraba el diálogo sin enviar nada: la caja no tenía altura máxima ni
 * desplazamiento, el pie quedaba fuera de la pantalla y el clic caía en la capa de fondo (que cierra). Se comprueba:
 * la caja se desplaza, el botón envía la solicitud con el tipo `implementation` y la confirmación se muestra.
 *
 * Sin entorno DOM en las pruebas: el diálogo se pinta en el servidor con los componentes de la interfaz sustituidos
 * por equivalentes sin portal, y el clic se hace llamando al manejador del botón que se ha pintado.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

(globalThis as { React?: unknown }).React = React;

const m = vi.hoisted(() => ({
  calls: [] as unknown[],
  data: undefined as unknown,
  buttons: [] as Array<{ label: string; onClick?: () => void }>,
}));
const text = (n: unknown): string => (Array.isArray(n) ? n.map(text).join("") : typeof n === "string" || typeof n === "number" ? String(n) : n && typeof n === "object" && "props" in (n as object) ? text((n as { props: { children?: unknown } }).props.children) : "");
vi.mock("@/lib/trpc", () => ({
  trpc: { connect: { request: { useMutation: () => ({ mutate: (i: unknown) => void m.calls.push(i), isPending: false, data: m.data }) } } },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, asChild }: { children?: React.ReactNode; onClick?: () => void; asChild?: boolean }) => {
    if (!asChild) m.buttons.push({ label: text(children), onClick });
    return React.createElement("button", null, children);
  },
}));
vi.mock("@/components/ui/dialog", () => {
  const box = (tag: string) => ({ children, className }: { children?: React.ReactNode; className?: string }) => React.createElement(tag, { className, "data-slot": tag }, children);
  const noop = () => undefined;
  return { useDialogComposition: () => ({ isComposing: () => false, setComposing: noop, justEndedComposing: () => false, markCompositionEnd: noop }), Dialog: box("div"), DialogContent: box("section"), DialogHeader: box("header"), DialogFooter: box("footer"), DialogTitle: box("h2"), DialogDescription: box("p") };
});

import { REQUEST_DIALOG_CLASS, RequestDialog, requestInput, requestSubmitLabel } from "../client/src/components/connect/ConnectParts";
import { ASSISTED_CONTRACT_COPY } from "../shared/netOffer";

const item = {
  key: "restaurant-net-complete",
  name: "Restaurant Net",
  assisted: {
    monthly: { kind: "monthly", amountCents: 5900, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false },
    available: Array.from({ length: 13 }, (_, i) => `Funcionalidad ${i + 1}`),
    inImplementation: ["Clientes y preferencias", "Escandallos y costes"],
  },
} as never;
const render = () =>
  renderToStaticMarkup(
    React.createElement(Router, { ssrPath: "/admin/ampliar/restaurant-net-complete" }, React.createElement(RequestDialog, { item, kind: "implementation", supportEmail: null, upgradeUrl: null, requestsEnabled: true, planName: "Essential", onClose: () => undefined })),
  );

beforeEach(() => {
  m.calls = [];
  m.data = undefined;
  m.buttons = [];
});

describe("diálogo «Contratar e iniciar implantación»", () => {
  it("la caja tiene altura máxima y desplazamiento propio (el pie nunca queda fuera de la pantalla)", () => {
    expect(REQUEST_DIALOG_CLASS).toContain("max-h-[90dvh]");
    expect(REQUEST_DIALOG_CLASS).toContain("overflow-y-auto");
    expect(render()).toContain(`class="${REQUEST_DIALOG_CLASS}"`);
  });

  it("«Solicitar contratación» envía la solicitud con el tipo implementation (y el mensaje si lo hay)", () => {
    const html = render();
    expect(html).toContain("Restaurant Net");
    expect(html).toContain("59,00");
    expect(html).toContain("Se añade a tu plan actual: Essential.");
    const submit = m.buttons.find((b) => b.label === ASSISTED_CONTRACT_COPY.confirm);
    expect(submit?.onClick).toBeTypeOf("function");
    submit!.onClick!();
    expect(m.calls).toEqual([{ key: "restaurant-net-complete", type: "implementation" }]);
    expect(requestInput({ key: "restaurant-net-complete" }, "implementation", "  Somos dos locales  ")).toEqual({ key: "restaurant-net-complete", type: "implementation", message: "Somos dos locales" });
    expect([requestSubmitLabel("implementation", false), requestSubmitLabel("implementation", true), requestSubmitLabel("info", false)]).toEqual(["Solicitar contratación", "Enviando…", "Enviar solicitud"]);
  });

  it("tras enviar se muestra la confirmación con la referencia (y ya no el botón de envío)", () => {
    m.data = { via: "lead", outcome: "created", reference: "SOL-M6KVW4Y2", email: "ana@cliente.example" };
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain(ASSISTED_CONTRACT_COPY.done);
    expect(html).toContain("Solicitud enviada, referencia SOL-M6KVW4Y2.");
    expect(m.buttons.map((b) => b.label)).not.toContain(ASSISTED_CONTRACT_COPY.confirm);
  });
});
