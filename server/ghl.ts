/**
 * GoHighLevel CRM Integration Helper
 * Crea/actualiza contactos en GHL cuando se genera un lead en la plataforma.
 *
 * API: POST https://services.leadconnectorhq.com/contacts/
 * Auth: Bearer Token (Private Integration Token de Sub-Account)
 * Docs: https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact
 */

const GHL_API_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export interface GHLContactPayload {
  name: string;
  email?: string;
  phone?: string;
  companyName?: string;
  source?: string;
  tags?: string[];
  /** Mensaje / notas del lead — se guarda como nota en el contacto */
  notes?: string;
}

/**
 * Crea o actualiza un contacto en GoHighLevel.
 * Usa el endpoint POST /contacts/ que hace upsert por email/teléfono.
 *
 * Retorna el contactId de GHL si tiene éxito, o null si falla (sin lanzar error,
 * para no bloquear el flujo principal de la plataforma).
 */
export async function createGHLContact(payload: GHLContactPayload): Promise<string | null> {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.warn("[GHL] GHL_API_KEY o GHL_LOCATION_ID no configurados. Saltando integración CRM.");
    return null;
  }

  try {
    const body: Record<string, unknown> = {
      locationId,
      name: payload.name,
      source: payload.source ?? "Nayade Web",
    };

    if (payload.email) body.email = payload.email;
    if (payload.phone) body.phone = payload.phone;
    if (payload.companyName) body.companyName = payload.companyName;
    if (payload.tags && payload.tags.length > 0) body.tags = payload.tags;

    const response = await fetch(`${GHL_API_URL}/contacts/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Version": GHL_API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GHL] Error al crear contacto (${response.status}): ${errorText}`);
      return null;
    }

    const data = await response.json() as { contact?: { id?: string } };
    const contactId = data?.contact?.id ?? null;

    // Si hay notas/mensaje, añadirlas como nota al contacto
    if (contactId && payload.notes) {
      await addGHLNote(contactId, payload.notes, apiKey);
    }

    console.log(`[GHL] Contacto creado/actualizado: ${contactId} (${payload.email ?? payload.name})`);
    return contactId;
  } catch (err) {
    console.error("[GHL] Error inesperado al crear contacto:", err);
    return null;
  }
}

/**
 * Añade una nota a un contacto existente en GHL.
 */
async function addGHLNote(contactId: string, body: string, apiKey: string): Promise<void> {
  try {
    const response = await fetch(`${GHL_API_URL}/contacts/${contactId}/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Version": GHL_API_VERSION,
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[GHL] No se pudo añadir nota al contacto ${contactId}: ${errorText}`);
    }
  } catch (err) {
    console.warn("[GHL] Error al añadir nota:", err);
  }
}

/**
 * Mapea el source de la plataforma a un tag de GHL y etiqueta el origen.
 */
export function getGHLTagsFromSource(source: string): string[] {
  const tagMap: Record<string, string[]> = {
    web_experiencia: ["Lead Web", "Experiencia"],
    landing_presupuesto: ["Lead Web", "Presupuesto"],
    web_contacto: ["Lead Web", "Formulario Contacto"],
    tpv: ["Lead TPV", "Venta Presencial"],
    reserva_online: ["Lead Web", "Reserva Online"],
    cupon: ["Lead Web", "Cupón"],
  };
  return tagMap[source] ?? ["Lead Web"];
}
