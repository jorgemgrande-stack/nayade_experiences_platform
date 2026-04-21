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

/** Log estructurado para operaciones GHL — visible y trazable en producción */
function ghlLog(
  level: "info" | "warn" | "error",
  op: string,
  msg: string,
  ctx?: {
    leadId?: number | string;
    contactId?: string;
    email?: string;
    phone?: string;
    httpStatus?: number;
    errorBody?: string;
    stack?: string;
  }
) {
  const entry = {
    ts: new Date().toISOString(),
    context: "GHL",
    op,
    msg,
    ...(ctx?.leadId    !== undefined && { leadId: ctx.leadId }),
    ...(ctx?.contactId !== undefined && { contactId: ctx.contactId }),
    ...(ctx?.email     !== undefined && { email: ctx.email }),
    ...(ctx?.phone     !== undefined && { phone: ctx.phone }),
    ...(ctx?.httpStatus !== undefined && { httpStatus: ctx.httpStatus }),
    ...(ctx?.errorBody !== undefined && { errorBody: ctx.errorBody?.slice(0, 300) }),
    ...(ctx?.stack     !== undefined && { stack: ctx.stack }),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn")  console.warn(line);
  else                        console.log(line);
}

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
/**
 * Verifica que las credenciales de GHL son válidas haciendo una llamada de prueba.
 * Retorna { ok: true } o { ok: false, error: string }.
 */
export async function testGHLConnection(
  apiKey: string,
  locationId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${GHL_API_URL}/locations/${locationId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: GHL_API_VERSION,
          Accept: "application/json",
        },
      }
    );
    if (response.ok) return { ok: true };
    const text = await response.text();
    return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 120)}` };
  } catch (err: any) {
    ghlLog("error", "test_connection", "Excepción al verificar credenciales GHL", { stack: err?.stack });
    return { ok: false, error: err.message ?? "Error de red" };
  }
}

export async function createGHLContact(
  payload: GHLContactPayload,
  overrideCredentials?: { apiKey: string; locationId: string }
): Promise<string | null> {
  const apiKey = overrideCredentials?.apiKey ?? process.env.GHL_API_KEY;
  const locationId = overrideCredentials?.locationId ?? process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    ghlLog("warn", "create_contact", "Credenciales GHL no configuradas — integración omitida");
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

      // GHL devuelve 400 cuando el location no permite contactos duplicados.
      // La respuesta incluye meta.contactId con el ID del contacto existente —
      // lo tratamos como upsert exitoso para añadir la nota igualmente.
      if (response.status === 400) {
        try {
          const errJson = JSON.parse(errorText) as { meta?: { contactId?: string } };
          const existingId = errJson?.meta?.contactId ?? null;
          if (existingId) {
            ghlLog("info", "create_contact", "Contacto duplicado — reutilizando ID existente", {
              contactId: existingId, email: payload.email,
            });
            if (payload.notes) await addGHLNote(existingId, payload.notes, apiKey);
            return existingId;
          }
        } catch { /* JSON inválido — caer al error genérico */ }
      }

      ghlLog("error", "create_contact", "Error HTTP al crear contacto en GHL", {
        email: payload.email, httpStatus: response.status, errorBody: errorText,
      });
      return null;
    }

    const data = await response.json() as { contact?: { id?: string } };
    const contactId = data?.contact?.id ?? null;

    if (contactId && payload.notes) {
      await addGHLNote(contactId, payload.notes, apiKey);
    }

    ghlLog("info", "create_contact", "Contacto creado/actualizado en GHL", {
      contactId: contactId ?? undefined, email: payload.email,
    });
    return contactId;
  } catch (err: any) {
    ghlLog("error", "create_contact", "Excepción inesperada al crear contacto en GHL", {
      email: payload.email, stack: err?.stack,
    });
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
      ghlLog("warn", "add_note", "No se pudo añadir nota al contacto GHL", {
        contactId, httpStatus: response.status, errorBody: errorText,
      });
    }
  } catch (err: any) {
    ghlLog("warn", "add_note", "Excepción al añadir nota al contacto GHL", {
      contactId, stack: err?.stack,
    });
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
