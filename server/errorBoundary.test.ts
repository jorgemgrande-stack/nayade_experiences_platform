/**
 * Pantalla de error de la aplicación: en producción no muestra la traza de la excepción (rutas internas,
 * nombres de módulos) y habla en español; en desarrollo sí la muestra. Adaptado de Skicenter (2a9d2248).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorBoundary from "../client/src/components/ErrorBoundary";

// La configuración de pruebas compila JSX en modo clásico (React.createElement)
(globalThis as { React?: unknown }).React = React;

function renderWithError(): string {
  const eb = new ErrorBoundary({ children: null });
  const error = new Error("fallo interno");
  error.stack = "Error: fallo interno\n    at Componente (/app/client/src/pages/Secreta.tsx:12:3)";
  eb.state = ErrorBoundary.getDerivedStateFromError(error);
  return renderToStaticMarkup(eb.render() as ReturnType<typeof createElement>);
}

describe("ErrorBoundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("en producción no muestra la traza y ofrece «Recargar» en español", () => {
    vi.stubEnv("DEV", false);
    const html = renderWithError();
    expect(html).not.toContain("Secreta.tsx");
    expect(html).not.toContain("fallo interno");
    expect(html).toContain("Algo no ha ido bien");
    expect(html).toContain("Recargar");
    expect(html).not.toMatch(/unexpected|Reload/i);
  });

  it("en desarrollo muestra la traza para depurar", () => {
    vi.stubEnv("DEV", true);
    expect(renderWithError()).toContain("Secreta.tsx");
  });

  it("sin error muestra el contenido", () => {
    expect(renderToStaticMarkup(createElement(ErrorBoundary, null, createElement("p", null, "contenido")))).toBe("<p>contenido</p>");
  });
});
