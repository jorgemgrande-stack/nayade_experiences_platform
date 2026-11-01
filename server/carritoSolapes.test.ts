/**
 * Carrito abierto: ni el botón flotante de WhatsApp ni el aviso de cookies tapan su pie ni «Finalizar compra»
 * (antes los dos lo pisaban a 1280 px y a 390 px).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { whatsappHidden } from "../shared/whatsappButton";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("carrito abierto y botón de WhatsApp", () => {
  // Botón a 1280 px y «Finalizar compra» del carrito (medidos en la prueba integral)
  const button = { left: 1200, top: 744, right: 1256, bottom: 800 };
  it("con el carrito abierto se oculta a cualquier anchura", () => {
    expect(whatsappHidden(button, [], 1280, true)).toBe(true);
    expect(whatsappHidden(button, [], 390, true)).toBe(true);
  });
  it("con el carrito cerrado, como hasta ahora (en ordenador, visible)", () => {
    expect(whatsappHidden(button, [], 1280, false)).toBe(false);
    expect(whatsappHidden(button, [], 1280)).toBe(false);
  });
  it("el botón lee si el carrito está abierto", () => {
    const src = read("client/src/components/WhatsAppFloatingButton.tsx");
    expect(src).toContain("useCart()");
    expect(src).toContain("window.innerWidth, cartOpen)");
  });
});

describe("carrito abierto y aviso de cookies", () => {
  it("el aviso pasa por debajo del fondo y del carrito mientras está abierto, y vuelve delante al cerrarlo", async () => {
    const { cookieBannerLayer } = await import("../client/src/components/CookieBanner");
    expect(cookieBannerLayer(true)).toBe("z-30");
    expect(cookieBannerLayer(false)).toBe("z-[9999]");
    const drawer = read("client/src/components/CartDrawer.tsx");
    // Fondo z-40 y carrito z-50: por encima de z-30
    expect(drawer).toContain("fixed inset-0 z-40");
    expect(drawer).toContain("fixed top-0 right-0 z-50");
    expect(read("client/src/components/CookieBanner.tsx")).toContain("cookieBannerLayer(cartOpen)");
  });
});
