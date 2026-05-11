/**
 * Meta Conversions API — endpoint Express + helper reutilizable.
 *
 * El endpoint POST /api/meta-capi recibe eventos del cliente (browser).
 * sendCapiEvent() se importa también desde redsysRoutes para enviar
 * Purchase server-side con deduplicación por event_id.
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import crypto from 'node:crypto';

const PIXEL_ID = process.env.VITE_META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const API_VERSION = process.env.META_API_VERSION || 'v21.0';
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_EVENT_CODE;

// ─── Helpers de hashing PII ───────────────────────────────────────────────────

function hashPII(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function hashPhone(phone: string | undefined | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return undefined;
  return crypto.createHash('sha256').update(digits).digest('hex');
}

function hashCountry(country: string | undefined | null): string | undefined {
  if (!country) return undefined;
  const code = country.trim().toLowerCase().substring(0, 2);
  return crypto.createHash('sha256').update(code).digest('hex');
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CapiUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  fbp?: string;
  fbc?: string;
}

interface CapiEventArgs {
  event_name: string;
  event_id: string;
  event_source_url?: string;
  custom_data?: Record<string, unknown>;
  user_data?: CapiUserData;
  client_ip?: string;
  client_user_agent?: string;
}

interface CAPIRequestBody {
  event_name: string;
  event_id: string;
  event_source_url?: string;
  custom_data?: Record<string, unknown>;
  user_data?: CapiUserData;
}

// ─── Helper reutilizable ──────────────────────────────────────────────────────

/**
 * Envía un evento a Meta Conversions API.
 * Reutilizable: usado desde el endpoint público /api/meta-capi (cliente)
 * y desde el webhook de Redsys (server-side Purchase).
 */
export async function sendCapiEvent(args: CapiEventArgs): Promise<{ ok: boolean; result: unknown }> {
  if (!ACCESS_TOKEN || !PIXEL_ID) {
    console.warn('[Meta CAPI] Variables de entorno no configuradas (PIXEL_ID o ACCESS_TOKEN)');
    return { ok: false, result: 'missing_config' };
  }

  const u = args.user_data ?? {};

  const hashedUserData: Record<string, unknown> = {
    em: u.email ? [hashPII(u.email)] : undefined,
    ph: u.phone ? [hashPhone(u.phone)] : undefined,
    fn: u.firstName ? [hashPII(u.firstName)] : undefined,
    ln: u.lastName ? [hashPII(u.lastName)] : undefined,
    ct: u.city ? [hashPII(u.city)] : undefined,
    zp: u.postalCode ? [hashPII(u.postalCode)] : undefined,
    country: u.country ? [hashCountry(u.country)] : undefined,
    client_ip_address: args.client_ip,
    client_user_agent: args.client_user_agent,
    fbp: u.fbp,
    fbc: u.fbc,
  };

  // Eliminar claves undefined
  for (const k of Object.keys(hashedUserData)) {
    if (hashedUserData[k] === undefined) delete hashedUserData[k];
  }

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: args.event_name,
        event_id: args.event_id,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: args.event_source_url,
        user_data: hashedUserData,
        custom_data: args.custom_data ?? {},
      },
    ],
  };

  if (TEST_EVENT_CODE) {
    payload.test_event_code = TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('[Meta CAPI] Error from Meta API:', result);
    return { ok: false, result };
  }

  return { ok: true, result };
}

// ─── Router Express ───────────────────────────────────────────────────────────

export const metaCapiRouter = Router();

metaCapiRouter.post('/api/meta-capi', async (req: Request, res: Response) => {
  try {
    const body = req.body as CAPIRequestBody;

    if (!body?.event_name || !body?.event_id) {
      return res.status(400).json({ error: 'event_name and event_id are required' });
    }

    const clientIp =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ||
      (req.headers['x-real-ip'] as string | undefined) ||
      req.socket.remoteAddress ||
      undefined;
    const userAgent = req.headers['user-agent'] || undefined;

    const result = await sendCapiEvent({
      event_name: body.event_name,
      event_id: body.event_id,
      event_source_url: body.event_source_url,
      custom_data: body.custom_data,
      user_data: body.user_data,
      client_ip: clientIp,
      client_user_agent: userAgent,
    });

    if (!result.ok) {
      return res.status(502).json({ error: result.result });
    }
    return res.json({ success: true, result: result.result });
  } catch (error: unknown) {
    console.error('[Meta CAPI] Route error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});
