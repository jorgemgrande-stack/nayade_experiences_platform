/**
 * Tests para la integración con GoHighLevel CRM
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGHLContact, getGHLTagsFromSource } from "./ghl";

describe("getGHLTagsFromSource", () => {
  it("devuelve tags correctos para web_contacto", () => {
    const tags = getGHLTagsFromSource("web_contacto");
    expect(tags).toContain("Lead Web");
    expect(tags).toContain("Formulario Contacto");
  });

  it("devuelve tags correctos para landing_presupuesto", () => {
    const tags = getGHLTagsFromSource("landing_presupuesto");
    expect(tags).toContain("Lead Web");
    expect(tags).toContain("Presupuesto");
  });

  it("devuelve tags por defecto para source desconocido", () => {
    const tags = getGHLTagsFromSource("unknown_source");
    expect(tags).toContain("Lead Web");
  });

  it("devuelve tags para tpv", () => {
    const tags = getGHLTagsFromSource("tpv");
    expect(tags).toContain("Lead TPV");
    expect(tags).toContain("Venta Presencial");
  });
});

describe("createGHLContact", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("retorna null si GHL_API_KEY no está configurado", async () => {
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;

    const result = await createGHLContact({
      name: "Test User",
      email: "test@example.com",
    });

    expect(result).toBeNull();
  });

  it("retorna null si GHL_LOCATION_ID no está configurado", async () => {
    process.env.GHL_API_KEY = "test-api-key";
    delete process.env.GHL_LOCATION_ID;

    const result = await createGHLContact({
      name: "Test User",
      email: "test@example.com",
    });

    expect(result).toBeNull();
  });

  it("llama a la API de GHL con los datos correctos cuando las credenciales están configuradas", async () => {
    process.env.GHL_API_KEY = "test-api-key";
    process.env.GHL_LOCATION_ID = "test-location-id";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contact: { id: "ghl-contact-123" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await createGHLContact({
      name: "Juan García",
      email: "juan@example.com",
      phone: "+34 600 000 000",
      source: "web_contacto",
      tags: ["Lead Web", "Formulario Contacto"],
    });

    expect(result).toBe("ghl-contact-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://services.leadconnectorhq.com/contacts/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer test-api-key",
          "Version": "2021-07-28",
        }),
      })
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.name).toBe("Juan García");
    expect(callBody.email).toBe("juan@example.com");
    expect(callBody.locationId).toBe("test-location-id");
  });

  it("retorna null y no lanza error si la API de GHL falla", async () => {
    process.env.GHL_API_KEY = "test-api-key";
    process.env.GHL_LOCATION_ID = "test-location-id";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await createGHLContact({
      name: "Test User",
      email: "test@example.com",
    });

    expect(result).toBeNull();
  });
});
