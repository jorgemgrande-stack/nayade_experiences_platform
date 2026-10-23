/**
 * «Ubicaciones» genérica: mapas a partir de los datos de cada empresa y ninguna ubicación, mapa o contacto fijo de otra.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { mapEmbedUrl, mapLinkUrl } from "../shared/locationMap";

describe("mapa de cada lugar de servicio", () => {
  it("por coordenadas, si son válidas", () => {
    expect(mapEmbedUrl({ latitude: "41.38", longitude: "2.17" })).toBe("https://maps.google.com/maps?q=41.38%2C2.17&z=15&output=embed");
    expect(mapLinkUrl({ latitude: 41.38, longitude: 2.17 })).toBe("https://www.google.com/maps/search/?api=1&query=41.38%2C2.17");
  });

  it("por dirección si no hay coordenadas válidas", () => {
    for (const bad of [{}, { latitude: "x", longitude: "1" }, { latitude: "95", longitude: "1" }, { latitude: "0", longitude: "0" }, { latitude: "", longitude: "" }]) {
      expect(mapEmbedUrl({ ...bad, address: "Calle Mayor 1, Valencia" })).toContain("q=Calle%20Mayor%201%2C%20Valencia");
    }
  });

  it("sin coordenadas ni dirección, sin mapa (nunca uno fijo)", () => {
    expect(mapEmbedUrl({})).toBeNull();
    expect(mapLinkUrl({ address: "   " })).toBeNull();
  });

  it("la dirección no puede inyectar parámetros en la URL", () => {
    expect(mapEmbedUrl({ address: "a&output=x#y" })).toBe("https://maps.google.com/maps?q=a%26output%3Dx%23y&z=15&output=embed");
  });
});

describe("página genérica de ubicaciones", () => {
  const src = fs.readFileSync(new URL("../client/src/pages/TenantLocations.tsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

  it("solo datos de la propia empresa: sin mapas, direcciones, correos ni imágenes fijas", () => {
    expect(src).not.toMatch(/n[aá]yade|skicenter|segovia|san rafael|cloudfront|maps\/embed\?pb=/i);
    expect(src).not.toMatch(/mailto:[a-z]/i);
    expect(src).toContain("trpc.public.getLocations");
    expect(src).toContain('getTenantPage.useQuery({ slug: "ubicaciones" }');
  });

  it("la web de cada empresa usa la versión genérica; la instalación original conserva la suya", () => {
    expect(app).toContain('<SingleOnlyPage Single={Locations} slug="ubicaciones" Tenant={TenantLocations} />');
    expect(app.match(/Tenant=\{TenantLocations\}/g)).toHaveLength(2);
  });
});
