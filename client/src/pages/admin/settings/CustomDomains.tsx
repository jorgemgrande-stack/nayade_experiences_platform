/**
 * Dominio propio (/admin/configuracion/dominios): la empresa conecta su dominio en cinco pasos — dominio, titularidad
 * (TXT), registros DNS que pide la plataforma, certificado HTTPS y activación tras comprobar que la web responde.
 *
 * Todo lo decide el plano de control por el canal del Core (domains.*): qué permite el plan, los registros exactos (los
 * de Railway para ese dominio, nunca inventados) y cuándo queda activo. La dirección de la plataforma sigue siempre
 * disponible como respaldo.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Check, CheckCircle2, Circle, Copy, ExternalLink, Globe, Loader2, RefreshCw, ShieldCheck, Star, Unplug } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { DOMAIN_STAGE_LABELS, type CustomDomainView, type DomainRecordView, type DomainStage } from "@shared/customDomains";

const STEPS = ["Dominio", "Titularidad", "Registros DNS", "Certificado", "Activo"] as const;

/** Paso del asistente en el que está cada etapa (0-4). */
function stepOf(stage: DomainStage): number {
  switch (stage) {
    case "pending_verification":
      return 1;
    case "pending_dns":
      return 2;
    case "pending_certificate":
      return 3;
    case "checking":
    case "error":
      return 3;
    case "active":
      return 4;
    default:
      return 0;
  }
}

const STAGE_TONE: Record<DomainStage, string> = {
  pending_verification: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  pending_dns: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  pending_certificate: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  checking: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  active: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  error: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300",
  disconnected: "bg-muted text-muted-foreground",
};

/** Etapas en las que el asistente vuelve a comprobar solo mientras la página está abierta. */
const AUTO_CHECK: ReadonlySet<DomainStage> = new Set<DomainStage>(["pending_verification", "pending_dns", "pending_certificate", "checking", "error"]);

function StageBadge({ stage }: { stage: DomainStage }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STAGE_TONE[stage])}>{DOMAIN_STAGE_LABELS[stage]}</span>;
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{value}</code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label={`Copiar ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function RecordsTable({ records }: { records: DomainRecordView[] }) {
  if (records.length === 0) return null;
  return (
    <div className="space-y-3">
      {records.map((r) => (
        <div key={`${r.type}-${r.fqdn}-${r.value}`} className="rounded-lg border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">{r.type}</Badge>
            <span className="text-xs text-muted-foreground">
              {r.purpose === "ownership" ? "Demuestra que el dominio es tuyo" : r.purpose === "traffic" ? "Lleva las visitas a tu web" : "Necesario para el certificado HTTPS"}
            </span>
            <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-medium", r.ok ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
              {r.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {r.ok ? "Detectado" : "Aún no detectado"}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center">
            <span className="text-xs font-medium text-muted-foreground">Nombre / host</span>
            <CopyValue value={r.name} label="nombre" />
            <span className="text-xs font-medium text-muted-foreground">Valor / destino</span>
            <CopyValue value={r.value} label="valor" />
          </div>
          {r.name !== r.fqdn && <p className="mt-2 text-xs text-muted-foreground">Nombre completo: <span className="font-mono">{r.fqdn}</span></p>}
        </div>
      ))}
    </div>
  );
}

function Stepper({ current, done }: { current: number; done: boolean }) {
  return (
    <ol className="grid grid-cols-5 gap-1 sm:gap-2" aria-label="Pasos de la conexión">
      {STEPS.map((label, i) => {
        const complete = i < current || (done && i === current);
        const active = i === current && !done;
        return (
          <li key={label} className="flex flex-col items-center gap-1 text-center" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold",
                complete && "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500",
                active && "border-primary bg-primary text-primary-foreground",
                !complete && !active && "text-muted-foreground",
              )}
            >
              {complete ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cn("text-[11px] leading-tight sm:text-xs", active ? "font-semibold" : "text-muted-foreground")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DomainWizard({ d, busy, onCheck, onPrimary, onDisconnect }: { d: CustomDomainView; busy: boolean; onCheck: () => void; onPrimary: () => void; onDisconnect: () => void }) {
  const step = stepOf(d.stage);
  const traffic = d.records.filter((r) => r.purpose !== "ownership");
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="break-all text-lg">{d.domain}</CardTitle>
          <StageBadge stage={d.stage} />
          {d.primary && (
            <Badge variant="outline" className="gap-1">
              <Star className="h-3 w-3" /> Principal
            </Badge>
          )}
        </div>
        {d.stage !== "disconnected" && <Stepper current={step} done={d.stage === "active"} />}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={cn("text-sm", d.stage === "error" ? "text-red-700 dark:text-red-400" : "text-muted-foreground")} role="status">
          {d.message}
        </p>

        {d.stage === "pending_verification" && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Paso 2 · Crea este registro TXT en tu proveedor de dominio</h3>
            <p className="text-sm text-muted-foreground">
              Entra en el panel DNS de tu dominio (donde lo registraste: Dinahosting, IONOS, GoDaddy…) y añade un registro nuevo. No toques los registros de correo (MX, SPF, DKIM, DMARC): no hace falta cambiar nada más.
            </p>
            <RecordsTable records={d.records} />
          </div>
        )}

        {(d.stage === "pending_dns" || ((d.stage === "pending_certificate" || d.stage === "checking" || d.stage === "error") && traffic.length > 0)) && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Paso 3 · Registros DNS que pide la plataforma para {d.domain}</h3>
            {traffic.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Crea {traffic.length === 1 ? "este registro" : "estos registros"} exactamente como aparecen. Si ya existe un registro con el mismo nombre (por ejemplo, un CNAME o un A antiguo de {d.domain}), sustitúyelo. No cambies los servidores de nombres.
                </p>
                <RecordsTable records={traffic} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Estamos preparando tu dominio en la plataforma. Los registros aparecerán aquí en cuanto estén listos.</p>
            )}
            {d.apex && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                {d.domain} es un dominio raíz. Muchos proveedores no admiten CNAME en la raíz: si el tuyo no tiene la opción ALIAS, ANAME o «CNAME flattening», conecta mejor www.{d.domain}.
              </p>
            )}
          </div>
        )}

        {(d.stage === "pending_certificate" || d.stage === "checking") && (
          <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Paso 4 · El certificado HTTPS se emite solo en cuanto el DNS es correcto. No tienes que hacer nada: lo comprobamos automáticamente.</span>
          </div>
        )}

        {d.stage === "active" && (
          <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Paso 5 · Tu web ya se sirve en https://{d.domain}
            </p>
            {d.https && <p className="text-xs">Última comprobación: {d.https.detail} ({new Date(d.https.checkedAt).toLocaleString("es-ES")}).</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {d.stage !== "disconnected" && d.stage !== "active" && (
            <Button onClick={onCheck} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {d.stage === "pending_verification" ? "Ya lo he creado: comprobar" : "Comprobar ahora"}
            </Button>
          )}
          {d.stage === "active" && (
            <>
              <Button variant="outline" asChild>
                <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> Abrir mi web
                </a>
              </Button>
              {!d.primary && (
                <Button onClick={onPrimary} disabled={busy}>
                  <Star className="mr-2 h-4 w-4" /> Usar como dominio principal
                </Button>
              )}
              <Button variant="outline" onClick={onCheck} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Comprobar
              </Button>
            </>
          )}
          {d.stage !== "disconnected" && (
            <Button variant="ghost" className="text-red-700 hover:text-red-800 dark:text-red-400" onClick={onDisconnect} disabled={busy}>
              <Unplug className="mr-2 h-4 w-4" /> {d.stage === "active" ? "Desconectar" : "Cancelar conexión"}
            </Button>
          )}
        </div>
        {d.lastCheckedAt && <p className="text-xs text-muted-foreground">Comprobado por última vez: {new Date(d.lastCheckedAt).toLocaleString("es-ES")}</p>}
      </CardContent>
    </Card>
  );
}

export default function CustomDomains() {
  const utils = trpc.useUtils();
  const status = trpc.domains.status.useQuery(undefined, { refetchOnWindowFocus: true, retry: 1 });
  const [domain, setDomain] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = () => void utils.domains.status.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);
  const add = trpc.domains.add.useMutation({
    onSuccess: (d) => {
      setDomain("");
      setSelected(d.domain);
      refresh();
    },
    onError,
  });
  const check = trpc.domains.check.useMutation({
    onSuccess: (d) => {
      if (d.stage === "active") toast.success(`${d.domain} ya está activo`);
      refresh();
    },
    onError,
  });
  const primary = trpc.domains.setPrimary.useMutation({ onSuccess: () => (toast.success("Dominio principal actualizado"), refresh()), onError });
  const disconnect = trpc.domains.disconnect.useMutation({ onSuccess: () => (toast.success("Dominio desconectado"), refresh()), onError });

  const overview = status.data?.available ? status.data.overview : null;
  const visible = useMemo(() => (overview?.domains ?? []).filter((d) => d.stage !== "disconnected"), [overview]);
  const disconnected = useMemo(() => (overview?.domains ?? []).filter((d) => d.stage === "disconnected"), [overview]);
  const current = visible.find((d) => d.domain === selected) ?? visible[0] ?? null;
  const busy = check.isPending || primary.isPending || disconnect.isPending;

  // Mientras la página está abierta y el dominio en curso no está activo, se vuelve a comprobar cada 30 s
  useEffect(() => {
    if (!current || !AUTO_CHECK.has(current.stage)) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !check.isPending) check.mutate({ domain: current.domain });
    }, 30_000);
    return () => clearInterval(t);
  }, [current?.domain, current?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dominio propio</h1>
          <p className="text-sm text-muted-foreground">Conecta el dominio de tu empresa (por ejemplo, www.tuempresa.es) para que tu web se sirva en él con HTTPS. Tu dirección de la plataforma sigue funcionando siempre.</p>
        </div>

        {status.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {status.error && <p className="text-sm text-red-700 dark:text-red-400">{status.error.message}</p>}
        {status.data && !status.data.available && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">{status.data.reason}</CardContent>
          </Card>
        )}

        {overview && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4" /> Tus direcciones
                </CardTitle>
                <CardDescription>El dominio principal es el que se usa en los enlaces, los correos y el mapa del sitio.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {overview.fallback && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                    <span className="break-all font-mono text-sm">{overview.fallback}</span>
                    <Badge variant="secondary">Dirección de la plataforma · siempre disponible</Badge>
                    {overview.primary === overview.fallback ? (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3" /> Principal
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => primary.mutate({ domain: overview.fallback! })}>
                        Usar como principal
                      </Button>
                    )}
                  </div>
                )}
                {visible.map((d) => (
                  <button
                    key={d.domain}
                    type="button"
                    onClick={() => setSelected(d.domain)}
                    className={cn("flex w-full flex-wrap items-center gap-2 rounded-md border p-3 text-left transition-colors hover:bg-muted/60", current?.domain === d.domain && "border-primary ring-1 ring-primary")}
                  >
                    <span className="break-all font-mono text-sm">{d.domain}</span>
                    <StageBadge stage={d.stage} />
                    {d.primary && (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3" /> Principal
                      </Badge>
                    )}
                  </button>
                ))}
              </CardContent>
            </Card>

            {current && (
              <DomainWizard
                d={current}
                busy={busy}
                onCheck={() => check.mutate({ domain: current.domain })}
                onPrimary={() => primary.mutate({ domain: current.domain })}
                onDisconnect={() => setConfirm(current.domain)}
              />
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{visible.length === 0 ? "Paso 1 · Escribe tu dominio" : "Conectar otro dominio"}</CardTitle>
                <CardDescription>
                  Recomendamos un subdominio como <span className="font-mono">www.tuempresa.es</span>: funciona con cualquier proveedor. Necesitas acceso al panel DNS de tu dominio.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {overview.allowance.allowed ? (
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (domain.trim()) add.mutate({ domain: domain.trim() });
                    }}
                  >
                    <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.tuempresa.es" aria-label="Dominio" autoComplete="off" spellCheck={false} inputMode="url" className="sm:flex-1" />
                    <Button type="submit" disabled={add.isPending || !domain.trim()}>
                      {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Continuar
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p className="text-muted-foreground">{overview.allowance.reason}</p>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/admin/suscripcion">Ver mi plan</Link>
                    </Button>
                  </div>
                )}
                {overview.allowance.max !== null && overview.allowance.max > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    En uso: {overview.allowance.used} de {overview.allowance.max}.
                  </p>
                )}
              </CardContent>
            </Card>

            {disconnected.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Desconectados: {disconnected.map((d) => d.domain).join(", ")}. Para volver a conectar uno, escríbelo arriba: te pediremos de nuevo el registro TXT.
              </p>
            )}
          </>
        )}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar {confirm}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tu web dejará de servirse en este dominio. Si era el principal, la dirección de la plataforma pasa a serlo. Tus registros DNS no se tocan: puedes borrarlos tú en tu proveedor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (confirm) disconnect.mutate({ domain: confirm });
                setConfirm(null);
              }}
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
