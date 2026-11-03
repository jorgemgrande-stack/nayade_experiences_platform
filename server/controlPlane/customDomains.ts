/**
 * Autoservicio de dominios propios (panel de la empresa → canal del Core → plano de control).
 *
 * Orden de conexión (corrige el círculo anterior, que exigía el CNAME de la plataforma antes del alta en Railway, que es
 * quien da el CNAME de cada dominio):
 *  1. Alta: `pending_verification` con un token propio (límites del plan y estado comercial antes de crear nada).
 *  2. Titularidad: TXT `_elephant-verify.<dominio>`. Al verlo → `verified` y alta en el proveedor (Railway).
 *  3. DNS: los registros que devuelve el proveedor para ESE dominio (nunca un destino inventado).
 *  4. Certificado: emitido por el proveedor.
 *  5. HTTPS: `https://<dominio>/.well-known/elephant-domain-check` responde el valor de esta empresa (DNS → borde →
 *     pasarela → Core → registro). Solo entonces → `active` (y la pasarela lo sirve sin su contraseña).
 *
 * La empresa sale siempre del canal (sesión del Core), y cada operación comprueba que el dominio es suyo. Un dominio de
 * otra empresa responde igual que uno inexistente para la comprobación de propiedad («no es tuyo»), sin datos de nadie.
 * Las comprobaciones automáticas (`runScheduled`) siguen el mismo camino con el actor del sistema.
 */
import { RegistryError, type TenantDomain } from "../_core/tenantRegistry/contract";
import { normalizeHost } from "../_core/tenantRegistry/host";
import { DOMAIN_CHECK_PATH, domainCheckValue } from "../_core/tenantRegistry/domainCheck";
import { expectedTxtValue, systemDns, verifyDomainTxt, VERIFY_LABEL, type DnsLookup } from "../_core/tenantRegistry/domainVerification";
import type { Actor, TenantRegistryService } from "../_core/tenantRegistry/service";
import type { TenantRegistryReader } from "../_core/tenantRegistry/store";
import { isApexDomain, registrableDomain, relativeName, type CustomDomainView, type DomainRecordView, type DomainsOverview, type DomainStage } from "../../shared/customDomains";
import type { DomainProvider, ProviderDomainStatus } from "./domainProvider";

export class CustomDomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CustomDomainError";
  }
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

export type DomainProbe = (domain: string, expected: string) => Promise<ProbeResult>;

/** Comprobación HTTPS real: certificado válido (lo exige fetch), sin seguir redirecciones y con el valor esperado. */
export const httpsProbe: DomainProbe = async (domain, expected) => {
  try {
    const r = await fetch(`https://${domain}${DOMAIN_CHECK_PATH}`, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "elephant-domain-check" } });
    if (r.status === 401) return { ok: false, detail: "La pasarela aún no reconoce el dominio" };
    if (r.status !== 200) return { ok: false, detail: `El dominio responde, pero no con la web de la empresa (HTTP ${r.status})` };
    const text = (await r.text()).trim().slice(0, 200);
    return text === expected ? { ok: true, detail: "La web responde por HTTPS con certificado válido" } : { ok: false, detail: "El dominio apunta a otro servidor" };
  } catch (e) {
    const code = String((e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name ?? "");
    if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(code)) return { ok: false, detail: "El certificado HTTPS aún no es válido" };
    if (/ENOTFOUND|EAI_AGAIN|ENODATA/.test(code)) return { ok: false, detail: "El dominio aún no resuelve en el DNS público" };
    if (/Timeout|Abort/i.test(code)) return { ok: false, detail: "El dominio no responde (tiempo agotado)" };
    return { ok: false, detail: "No se ha podido conectar por HTTPS" };
  }
};

export interface Allowance {
  allowed: boolean;
  reason: string | null;
  max: number | null;
}

export interface CustomDomainDeps {
  reader: Pick<TenantRegistryReader, "resolveDomain" | "listDomains" | "listTenants" | "getTenant">;
  registry: Pick<TenantRegistryService, "addDomain" | "recordDomainVerification" | "activateDomain" | "disableDomain" | "setPrimaryDomain" | "restartDomainVerification">;
  provider: DomainProvider;
  /** Reglas comerciales y del plan (las mismas que el alta del operador). `used`: dominios propios ya conectados o en curso. */
  allowance: (tenantId: string, used: number) => Promise<Allowance>;
  /** Dominios de plataforma (`<empresa>.<dominio>`): nunca se aceptan como dominio propio. */
  platformDomains?: readonly string[];
  dns?: DnsLookup;
  probe?: DomainProbe;
  /** Aviso a la empresa cuando el dominio queda activo (idempotente en quien lo envía). */
  onActivated?: (tenantId: string, domain: string) => void;
  now?: () => number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

/** Sufijos que nunca pueden ser un dominio propio de una empresa (Big Elephant y el proveedor). */
const RESERVED_SUFFIXES = ["bigelephant.es", "railway.app", "up.railway.app", "railway.internal", "localhost"];

const PROVIDER_TTL_MS = 30_000;
const HEALTH_TTL_MS = 5 * 60_000;
/** Un dominio sin verificar se deja de comprobar solo pasados 30 días (la empresa puede seguir comprobándolo). */
const PENDING_SCHEDULE_MAX_AGE_MS = 30 * 24 * 3600_000;

interface Memo {
  provider?: { at: number; value: ProviderDomainStatus };
  https?: { at: number; value: ProbeResult };
  txt?: boolean;
  dnsOk?: boolean;
  lastCheckedAt?: number;
}

export class CustomDomainService {
  private memo = new Map<string, Memo>();
  private readonly now: () => number;
  private readonly dns: DnsLookup;
  private readonly probe: DomainProbe;

  constructor(private d: CustomDomainDeps) {
    this.now = d.now ?? Date.now;
    this.dns = d.dns ?? systemDns;
    this.probe = d.probe ?? httpsProbe;
  }

  private actorFor(tenantId: string, who?: string): Actor {
    return { type: "crm", id: `panel:${tenantId}${who ? `:${who}`.slice(0, 60) : ""}` };
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  async overview(tenantId: string): Promise<DomainsOverview> {
    const all = await this.d.reader.listDomains(tenantId);
    const custom = all.filter((x) => x.kind === "custom" && x.status !== "removed");
    const used = custom.filter((x) => x.status !== "disabled").length;
    const fallback = all.find((x) => x.kind === "platform_subdomain" && x.status === "active") ?? all.find((x) => x.kind === "platform_subdomain" && x.status !== "removed") ?? null;
    const primary = all.find((x) => x.isPrimary && x.status === "active") ?? null;
    const allowance = await this.d.allowance(tenantId, used).catch(() => ({ allowed: false, reason: "No se han podido comprobar las condiciones de tu plan. Inténtalo más tarde.", max: null }));
    const domains: CustomDomainView[] = [];
    for (const dom of custom.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) domains.push(await this.view(tenantId, dom, { refresh: false }));
    return {
      fallback: fallback?.domain ?? null,
      primary: primary?.domain ?? fallback?.domain ?? null,
      domains,
      allowance: { allowed: allowance.allowed, reason: allowance.allowed ? null : allowance.reason, max: allowance.max, used },
      automatic: this.d.provider.name !== "manual",
    };
  }

  // ── Alta ───────────────────────────────────────────────────────────────────

  async add(tenantId: string, rawDomain: string, who?: string): Promise<CustomDomainView> {
    const domain = this.validDomain(rawDomain);
    const existing = await this.d.reader.resolveDomain(domain);
    if (existing) {
      if (existing.tenant.id !== tenantId) throw new CustomDomainError(409, "domain_taken", "Este dominio ya está conectado a otra cuenta de Big Elephant. Si es tuyo, escríbenos desde Soporte y lo revisamos.");
      if (existing.domain.kind !== "custom") throw new CustomDomainError(409, "domain_taken", "Ese dominio ya es tu dirección de la plataforma");
      if (existing.domain.status !== "disabled") return this.view(tenantId, existing.domain, { refresh: false });
      // Reconexión de un dominio propio desconectado: cuenta para el límite como uno nuevo
      await this.assertAllowed(tenantId);
      const restarted = await this.d.registry.restartDomainVerification(tenantId, domain, this.actorFor(tenantId, who));
      this.memo.delete(domain);
      return this.view(tenantId, restarted, { refresh: false });
    }
    await this.assertAllowed(tenantId);
    try {
      const dom = await this.d.registry.addDomain(tenantId, domain, "custom", this.actorFor(tenantId, who));
      this.d.log?.("domain_added", { tenantId, domain });
      return this.view(tenantId, dom, { refresh: false });
    } catch (e) {
      if (e instanceof RegistryError && e.code === "conflict") throw new CustomDomainError(409, "domain_taken", "Este dominio ya está conectado a otra cuenta de Big Elephant. Si es tuyo, escríbenos desde Soporte y lo revisamos.");
      throw e;
    }
  }

  private async assertAllowed(tenantId: string) {
    const used = (await this.d.reader.listDomains(tenantId)).filter((x) => x.kind === "custom" && x.status !== "removed" && x.status !== "disabled").length;
    const a = await this.d.allowance(tenantId, used);
    if (!a.allowed) throw new CustomDomainError(403, "not_allowed", a.reason ?? "Tu plan no permite conectar más dominios propios");
  }

  /** Normaliza y rechaza lo que nunca puede ser un dominio propio (IP, plataforma, Big Elephant, proveedor). */
  validDomain(raw: string): string {
    const cleaned = String(raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const domain = normalizeHost(cleaned);
    if (!domain || cleaned.includes(":") ||!/\.([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(domain)) throw new CustomDomainError(400, "invalid_domain", "Escribe un dominio válido, por ejemplo www.tuempresa.es");
    const reserved = [...RESERVED_SUFFIXES, ...(this.d.platformDomains ?? [])];
    if (reserved.some((s) => domain === s || domain.endsWith(`.${s}`))) throw new CustomDomainError(400, "invalid_domain", "Ese dominio pertenece a la plataforma: escribe un dominio de tu empresa");
    return domain;
  }

  // ── Comprobación (manual o automática) ────────────────────────────────────

  /** Avanza lo que se pueda (TXT → alta → DNS → certificado → HTTPS → activo) y devuelve la vista. */
  async check(tenantId: string, rawDomain: string, who?: string): Promise<CustomDomainView> {
    const dom = await this.own(tenantId, rawDomain);
    return this.advance(tenantId, dom, this.actorFor(tenantId, who));
  }

  private async advance(tenantId: string, dom: TenantDomain, actor: Actor): Promise<CustomDomainView> {
    const memo = this.memoOf(dom.domain);
    memo.lastCheckedAt = this.now();
    let cur = dom;
    if (cur.status === "pending_verification" && cur.verificationToken) {
      const txt = await verifyDomainTxt({ domain: cur.domain, token: cur.verificationToken }, this.dns);
      memo.txt = txt;
      cur = await this.d.registry.recordDomainVerification(cur.domain, { ok: txt, pending: txt ? [] : ["txt"] }, actor);
    }
    if (cur.status === "verified" || cur.status === "active") {
      const prov = await this.providerStatus(cur.domain, { ensure: true });
      const dnsOk = await this.dnsReady(prov);
      memo.dnsOk = dnsOk;
      const certOk = prov.certificate === "issued" || (this.d.provider.name === "manual" && prov.certificate === "unknown");
      if (cur.status === "verified" && dnsOk && certOk) {
        const https = await this.httpsOf(tenantId, cur.domain, { fresh: true });
        if (https.ok) {
          cur = await this.d.registry.activateDomain(cur.domain, actor);
          this.d.log?.("domain_activated", { tenantId, domain: cur.domain });
          this.d.onActivated?.(tenantId, cur.domain);
        }
      } else if (cur.status === "active") {
        await this.httpsOf(tenantId, cur.domain, { fresh: true });
      }
    }
    return this.view(tenantId, cur, { refresh: false });
  }

  /** Comprobaciones automáticas: pendientes recientes, verificados y salud de los activos. Errores por dominio, aislados. */
  async runScheduled(): Promise<{ checked: number; activated: number }> {
    let checked = 0;
    let activated = 0;
    for (const t of await this.d.reader.listTenants()) {
      if (t.status === "deleted" || t.status === "deleting") continue;
      for (const dom of await this.d.reader.listDomains(t.id)) {
        if (dom.kind !== "custom") continue;
        const due = dom.status === "verified" || dom.status === "active" || (dom.status === "pending_verification" && this.now() - dom.createdAt.getTime() < PENDING_SCHEDULE_MAX_AGE_MS);
        if (!due) continue;
        try {
          const before = dom.status;
          const v = await this.advance(t.id, dom, { type: "system", id: "domain-checks" });
          checked++;
          if (before !== "active" && v.stage === "active") activated++;
        } catch (e) {
          this.d.log?.("domain_check_failed", { tenantId: t.id, domain: dom.domain, error: e instanceof Error ? e.name : "error" });
        }
      }
    }
    return { checked, activated };
  }

  // ── Principal y desconexión ───────────────────────────────────────────────

  async setPrimary(tenantId: string, rawDomain: string, who?: string): Promise<DomainsOverview> {
    const domain = normalizeHost(rawDomain);
    const r = domain ? await this.d.reader.resolveDomain(domain) : null;
    if (!r || r.tenant.id !== tenantId) throw new CustomDomainError(404, "not_found", "Ese dominio no está en tu cuenta");
    if (r.domain.status !== "active") throw new CustomDomainError(409, "not_active", "Solo un dominio activo puede ser el principal");
    await this.d.registry.setPrimaryDomain(tenantId, r.domain.domain, this.actorFor(tenantId, who));
    return this.overview(tenantId);
  }

  async disconnect(tenantId: string, rawDomain: string, who?: string): Promise<DomainsOverview> {
    const dom = await this.own(tenantId, rawDomain);
    const actor = this.actorFor(tenantId, who);
    if (dom.status === "disabled") return this.overview(tenantId);
    // Si era el principal, la dirección de la plataforma vuelve a serlo antes de retirarlo (nunca queda sin principal)
    if (dom.isPrimary) {
      const fallback = (await this.d.reader.listDomains(tenantId)).find((x) => x.kind === "platform_subdomain" && x.status === "active");
      if (fallback) await this.d.registry.setPrimaryDomain(tenantId, fallback.domain, actor);
    }
    await this.d.registry.disableDomain(dom.domain, actor, "Desconectado desde el panel de la empresa");
    this.memo.delete(dom.domain);
    // El certificado deja de emitirse: se retira del proveedor (un fallo no deshace la desconexión: ya no se sirve)
    await this.d.provider.remove?.(dom.domain).catch((e: Error) => this.d.log?.("domain_provider_remove_failed", { tenantId, domain: dom.domain, error: e.name }));
    this.d.log?.("domain_disconnected", { tenantId, domain: dom.domain });
    return this.overview(tenantId);
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async own(tenantId: string, rawDomain: string): Promise<TenantDomain> {
    const domain = normalizeHost(rawDomain);
    const r = domain ? await this.d.reader.resolveDomain(domain) : null;
    if (!r || r.tenant.id !== tenantId || r.domain.kind !== "custom" || r.domain.status === "removed") throw new CustomDomainError(404, "not_found", "Ese dominio no está en tu cuenta");
    return r.domain;
  }

  private memoOf(domain: string): Memo {
    let m = this.memo.get(domain);
    if (!m) this.memo.set(domain, (m = {}));
    return m;
  }

  private async providerStatus(domain: string, o: { ensure: boolean }): Promise<ProviderDomainStatus> {
    const memo = this.memoOf(domain);
    if (!o.ensure && memo.provider && this.now() - memo.provider.at < PROVIDER_TTL_MS) return memo.provider.value;
    const value = await (o.ensure ? this.d.provider.ensure(domain) : this.d.provider.status(domain)).catch(
      (e: Error): ProviderDomainStatus => ({ provider: this.d.provider.name, registered: false, certificate: "unknown", detail: `Proveedor no disponible: ${e.message.slice(0, 120)}`, records: [] }),
    );
    memo.provider = { at: this.now(), value };
    return value;
  }

  /** ¿Están los registros de tráfico del proveedor? Vale lo que diga el proveedor o lo que vea nuestro DNS. */
  private async dnsReady(prov: ProviderDomainStatus): Promise<boolean> {
    if (this.d.provider.name === "manual") return true; // sin registros conocidos: decide la comprobación HTTPS
    const needed = (prov.records ?? []).filter((r) => r.purpose === "traffic");
    if (!prov.registered || needed.length === 0) return false;
    for (const r of needed) if (!r.propagated && !(await this.seen(r.type, r.fqdn, r.value))) return false;
    return true;
  }

  private async seen(type: string, fqdn: string, value: string): Promise<boolean> {
    const want = value.replace(/\.$/, "").toLowerCase();
    try {
      if (type === "CNAME") return (await this.dns.resolveCname(fqdn)).some((x) => x.replace(/\.$/, "").toLowerCase() === want);
      if (type === "TXT") return (await this.dns.resolveTxt(fqdn)).some((c) => c.join("") === value);
    } catch {
      return false;
    }
    return false;
  }

  private async httpsOf(tenantId: string, domain: string, o: { fresh: boolean }): Promise<ProbeResult> {
    const memo = this.memoOf(domain);
    if (!o.fresh && memo.https && this.now() - memo.https.at < HEALTH_TTL_MS) return memo.https.value;
    const value = await this.probe(domain, domainCheckValue(tenantId, domain)).catch(() => ({ ok: false, detail: "No se ha podido conectar por HTTPS" }));
    memo.https = { at: this.now(), value };
    return value;
  }

  private async view(tenantId: string, dom: TenantDomain, _o: { refresh: boolean }): Promise<CustomDomainView> {
    const memo = this.memoOf(dom.domain);
    const zone = registrableDomain(dom.domain);
    const apex = isApexDomain(dom.domain);
    const records: DomainRecordView[] = [];
    let stage: DomainStage;
    let message: string;
    let certificate: CustomDomainView["certificate"] = null;
    const https = memo.https ? { ok: memo.https.value.ok, detail: memo.https.value.detail, checkedAt: new Date(memo.https.at).toISOString() } : null;

    if (dom.status === "disabled") {
      stage = "disconnected";
      message = "Desconectado: tu web ya no se sirve en este dominio. Puedes volver a conectarlo cuando quieras.";
    } else if (dom.status === "pending_verification") {
      stage = "pending_verification";
      const fqdn = `${VERIFY_LABEL}.${dom.domain}`;
      records.push({ type: "TXT", name: relativeName(fqdn, zone), fqdn, value: expectedTxtValue(dom.verificationToken ?? ""), purpose: "ownership", ok: memo.txt === true });
      message = memo.txt === false ? "Aún no vemos el registro TXT. Si acabas de crearlo, la propagación puede tardar desde unos minutos hasta unas horas." : "Crea el registro TXT en el panel DNS de tu dominio para demostrar que es tuyo.";
    } else {
      const prov = await this.providerStatus(dom.domain, { ensure: false });
      certificate = prov.certificate;
      for (const r of prov.records ?? []) {
        records.push({ type: r.type, name: relativeName(r.fqdn || r.hostlabel, zone), fqdn: r.fqdn, value: r.value, purpose: r.purpose, ok: r.propagated || (memo.dnsOk === true && r.purpose === "traffic") });
      }
      if (prov.ownership) {
        const fqdn = prov.ownership.host.includes(".") && prov.ownership.host.endsWith(zone) ? prov.ownership.host : `${prov.ownership.host}.${zone}`;
        records.push({ type: "TXT", name: relativeName(fqdn, zone), fqdn, value: prov.ownership.value, purpose: "certificate", ok: false });
      }
      const dnsOk = memo.dnsOk ?? (this.d.provider.name === "manual" || (records.some((r) => r.purpose === "traffic") && records.filter((r) => r.purpose === "traffic").every((r) => r.ok)));
      if (dom.status === "active") {
        stage = https && !https.ok ? "error" : "active";
        message = stage === "active" ? "Tu web se sirve en este dominio con HTTPS." : `Tu dominio está conectado, pero la última comprobación ha fallado: ${https!.detail}. Revisa que los registros DNS siguen como se indican.`;
      } else if (this.d.provider.name === "manual") {
        stage = https ? "checking" : "pending_dns";
        message = https && !https.ok
          ? `Titularidad verificada. Estamos terminando de preparar tu dominio en la plataforma (${https.detail.toLowerCase()}). Te avisaremos al quedar activo.`
          : "Titularidad verificada. Estamos preparando tu dominio en la plataforma; en cuanto esté listo te mostraremos los registros DNS.";
      } else if (!prov.registered) {
        stage = "pending_dns";
        message = "Titularidad verificada. Estamos dando de alta tu dominio en la plataforma; vuelve a comprobar en unos segundos.";
      } else if (!dnsOk) {
        stage = "pending_dns";
        message = apex
          ? `Crea el registro indicado. Es un dominio raíz: si tu proveedor no admite CNAME en la raíz, usa su opción ALIAS/ANAME o conecta www.${zone} en su lugar.`
          : "Crea el registro indicado en el panel DNS de tu dominio. La propagación puede tardar desde unos minutos hasta unas horas.";
      } else if (prov.certificate === "failed") {
        stage = "error";
        message = `No se ha podido emitir el certificado HTTPS${prov.certificateError ? ` (${prov.certificateError})` : ""}. Revisa los registros DNS y vuelve a comprobar.`;
      } else if (prov.certificate !== "issued") {
        stage = "pending_certificate";
        message = "DNS correcto. Estamos emitiendo el certificado HTTPS; suele tardar unos minutos.";
      } else {
        stage = "checking";
        message = https && !https.ok ? `Certificado emitido. Última comprobación HTTPS: ${https.detail}. Volvemos a comprobarlo automáticamente.` : "Certificado emitido. Comprobando que tu web responde por HTTPS…";
      }
    }
    return {
      domain: dom.domain,
      stage,
      primary: dom.isPrimary,
      apex,
      zone,
      records,
      certificate,
      https,
      message,
      createdAt: dom.createdAt.toISOString(),
      activatedAt: dom.activatedAt ? dom.activatedAt.toISOString() : null,
      lastCheckedAt: memo.lastCheckedAt ? new Date(memo.lastCheckedAt).toISOString() : null,
    };
  }
}
