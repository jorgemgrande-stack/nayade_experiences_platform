/**
 * Alta de los DOMINIOS PROPIOS de las empresas en el proveedor (Railway), donde terminan los certificados TLS.
 *
 * La verificación DNS (CNAME + TXT) ya prueba la titularidad (tenantRegistry/domainVerification.ts); este módulo da de
 * alta el dominio en el servicio `core-gateway` (puerto 8080, como el comodín de la plataforma) y consulta el estado del
 * certificado. Es idempotente: si el dominio ya existe en Railway no se vuelve a crear.
 *
 * Configuración: `CP_RAILWAY_DOMAIN_TOKEN`, un token de PROYECTO de Railway del entorno (production o live). Sin él el
 * proveedor es «manual»: la activación sigue funcionando y el estado indica que el alta en Railway está pendiente.
 * Nunca se imprime el token.
 */

export type CertificateState = "issued" | "pending" | "failed" | "unknown";

export interface ProviderDomainStatus {
  provider: "railway" | "manual";
  /** ¿Existe el dominio en el proveedor? */
  registered: boolean;
  certificate: CertificateState;
  /** Explicación para el CRM (sin secretos). */
  detail: string;
}

export interface DomainProvider {
  readonly name: "railway" | "manual";
  /** Da de alta el dominio si no existe (idempotente) y devuelve su estado. */
  ensure(domain: string): Promise<ProviderDomainStatus>;
  status(domain: string): Promise<ProviderDomainStatus>;
}

export const manualDomainProvider: DomainProvider = {
  name: "manual",
  async ensure(domain) {
    return this.status(domain);
  },
  async status() {
    return { provider: "manual", registered: false, certificate: "unknown", detail: "Alta en Railway pendiente: sin CP_RAILWAY_DOMAIN_TOKEN, el dominio se añade a mano en core-gateway → Settings → Domains" };
  },
};

const API = "https://backboard.railway.app/graphql/v2";
const GATEWAY_SERVICE = "core-gateway";
const GATEWAY_PORT = 8080;

/** Estado del certificado de Railway → estado propio. */
export function certificateState(raw: unknown): CertificateState {
  const s = String(raw ?? "").toUpperCase();
  // Primero lo fallido y lo pendiente: «VALIDATING» contiene «VALID»
  if (/FAIL|ERROR|INVALID/.test(s)) return "failed";
  if (/PEND|ISSUING|VALIDATING|CREATING/.test(s)) return "pending";
  if (/ISSUED|ACTIVE|(^|_)VALID$/.test(s)) return "issued";
  return "unknown";
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ json(): Promise<unknown>; status: number }>;

export function railwayDomainProvider(o: { token: string; fetch?: Fetch }): DomainProvider {
  const doFetch: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const api = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const r = await doFetch(API, { method: "POST", headers: { "content-type": "application/json", "Project-Access-Token": o.token }, body: JSON.stringify({ query, variables }) });
    const j = (await r.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message?: string }> };
    if (j.errors || !j.data) throw new Error(`Railway: ${(j.errors?.[0]?.message ?? `HTTP ${r.status}`).slice(0, 160)}`);
    return j.data;
  };
  let scope: Promise<{ projectId: string; environmentId: string; serviceId: string }> | null = null;
  const getScope = () =>
    (scope ??= (async () => {
      const t = await api<{ projectToken: { projectId: string; environmentId: string } }>("query { projectToken { projectId environmentId } }");
      const p = await api<{ project: { services: { edges: Array<{ node: { id: string; name: string } }> } } }>("query($id:String!){ project(id:$id){ services { edges { node { id name } } } } }", { id: t.projectToken.projectId });
      const gw = p.project.services.edges.find((e) => e.node.name === GATEWAY_SERVICE);
      if (!gw) throw new Error(`Railway: no existe el servicio ${GATEWAY_SERVICE}`);
      return { projectId: t.projectToken.projectId, environmentId: t.projectToken.environmentId, serviceId: gw.node.id };
    })().catch((e) => {
      scope = null;
      throw e;
    }));
  const find = async (domain: string) => {
    const s = await getScope();
    const d = await api<{ domains: { customDomains: Array<{ id: string; domain: string; status?: { certificateStatus?: string } | null }> } }>(
      "query($p:String!,$e:String!,$s:String!){ domains(projectId:$p, environmentId:$e, serviceId:$s){ customDomains { id domain status { certificateStatus } } } }",
      { p: s.projectId, e: s.environmentId, s: s.serviceId },
    );
    return { s, found: d.domains.customDomains.find((x) => x.domain.toLowerCase() === domain.toLowerCase()) ?? null };
  };
  const view = (found: { status?: { certificateStatus?: string } | null } | null): ProviderDomainStatus => {
    if (!found) return { provider: "railway", registered: false, certificate: "unknown", detail: "El dominio aún no está dado de alta en Railway" };
    const certificate = certificateState(found.status?.certificateStatus);
    const detail = certificate === "issued" ? "Certificado emitido" : certificate === "failed" ? "Railway no pudo emitir el certificado: revisa el CNAME" : "Certificado en emisión (puede tardar unos minutos tras propagarse el DNS)";
    return { provider: "railway", registered: true, certificate, detail };
  };
  return {
    name: "railway",
    async status(domain) {
      return view((await find(domain)).found);
    },
    async ensure(domain) {
      const { s, found } = await find(domain);
      if (found) return view(found);
      await api("mutation($i:CustomDomainCreateInput!){ customDomainCreate(input:$i){ id } }", {
        i: { domain: domain.toLowerCase(), environmentId: s.environmentId, projectId: s.projectId, serviceId: s.serviceId, targetPort: GATEWAY_PORT },
      });
      return view((await find(domain)).found);
    },
  };
}

/** Proveedor según el entorno: Railway con `CP_RAILWAY_DOMAIN_TOKEN`; si no, manual. */
export function domainProviderFromEnv(env: Record<string, string | undefined> = process.env): DomainProvider {
  const token = (env.CP_RAILWAY_DOMAIN_TOKEN ?? "").trim();
  return token ? railwayDomainProvider({ token }) : manualDomainProvider;
}
