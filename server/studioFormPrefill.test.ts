import { describe, expect, it } from "vitest";
import { fieldParam, formPrefill, hashQuery } from "../shared/studio/formPrefill";
import { hashTarget } from "../client/src/lib/scrollToHash";

const fields = [
  { kind: "text", label: "Nombre", options: "" },
  { kind: "select", label: "Experiencia", options: "Viaje del Alma\nRetiro Naturaleza & Outdoor\nRetiro de Año Nuevo" },
  { kind: "radio", label: "Modalidad", options: "Individual\n2 o más personas" },
];

describe("formulario rellenado desde el enlace", () => {
  it("el nombre del parámetro sale de la pregunta, sin tildes ni mayúsculas", () => {
    expect(fieldParam("Experiencia")).toBe("experiencia");
    expect(fieldParam("Tipo de viaje")).toBe("tipo-de-viaje");
    expect(fieldParam("¿Cuántas personas?")).toBe("cuantas-personas");
  });
  it("lee lo que va tras la interrogación del ancla", () => {
    expect(hashQuery("#solicitud?experiencia=X")).toBe("experiencia=X");
    expect(hashQuery("#solicitud")).toBe("");
  });
  it("elige la opción que coincide (sin tildes ni mayúsculas) en selectores y botones de opción", () => {
    expect(formPrefill(fields, "experiencia=viaje%20del%20alma&modalidad=2 o mas personas")).toEqual({ f1: "Viaje del Alma", f2: "2 o más personas" });
    expect(formPrefill(fields, "experiencia=Retiro de Ano Nuevo")).toEqual({ f1: "Retiro de Año Nuevo" });
  });
  it("no escribe en campos de texto ni acepta valores que no son una opción", () => {
    expect(formPrefill(fields, "nombre=Ana&experiencia=Otra cosa&modalidad=")).toEqual({});
    expect(formPrefill(fields, "")).toEqual({});
  });
  it("el ancla para desplazarse ignora lo que va tras la interrogación", () => {
    expect(hashTarget("#solicitud?experiencia=Viaje%20del%20Alma")).toBe("solicitud");
    expect(hashTarget("#contacto")).toBe("contacto");
    expect(hashTarget("#?x=1")).toBeNull();
  });
});

import { normalizeBlocks } from "./_core/pageBlocks";

describe("tarjeta comercial (precio, datos clave, segundo botón, encuadre)", () => {
  const card = { id: "bcard00001", type: "cards", data: { title: "Viajes", intro: "", layout: "grid", columns: "3", items: [
    { imageUrl: "/files/abc/foto.jpg", imageAlt: "Foto", title: "Viaje del Alma", text: "Resumen", buttonLabel: "Ver experiencia", buttonUrl: "/viaje-del-alma",
      imageFocus: "upper", badge: "Individual", meta: "6 días\nTodo el año", priceLabel: "Desde", price: "1.190 €", priceNote: "por persona", button2Label: "Solicitar información", button2Url: "#solicitud?experiencia=Viaje del Alma" },
    { imageUrl: "", imageAlt: "", title: "Antigua", text: "Sin extras", buttonLabel: "", buttonUrl: "" },
  ] } };
  it("conserva los campos nuevos y la tarjeta antigua sigue siendo válida", () => {
    const [b] = normalizeBlocks([card]) as any[];
    expect(b.data.items[0]).toMatchObject({ imageFocus: "upper", badge: "Individual", meta: "6 días\nTodo el año", priceLabel: "Desde", price: "1.190 €", priceNote: "por persona", button2Label: "Solicitar información", button2Url: "#solicitud?experiencia=Viaje del Alma".replace(/\s+/g, "") });
    expect(b.data.items[1]).toMatchObject({ title: "Antigua", price: "", button2Label: "" });
  });
  it("un encuadre desconocido vuelve al centro", () => {
    const bad = JSON.parse(JSON.stringify(card));
    bad.data.items[0].imageFocus = "diagonal";
    const [b] = normalizeBlocks([bad]) as any[];
    expect(b.data.items[0].imageFocus).toBe("center");
  });
});
