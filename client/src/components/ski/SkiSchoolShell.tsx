/**
 * Marco común de las pantallas de Ski Net · Escuela: selector de sede (si la empresa tiene varias), estado de la
 * licencia `ski-school` y de la activación en la sede, y estados vacíos con el siguiente paso. La autorización real la
 * aplica el servidor en cada operación (server/skiSchool/service.ts); esto es presentación.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Building2, GraduationCap, Lock, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { errorToastMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";

export interface CodeLabel {
  code: string;
  label: string;
}
export interface SchoolConfigView {
  levels: CodeLabel[];
  modalities: CodeLabel[];
  languages: CodeLabel[];
  dayStart: string;
  dayEnd: string;
  limits: { maxDailySessions: number; maxConsecutiveSessions: number; minTransferMinutes: number };
}
export interface SkiCtx {
  siteId: string;
  config: SchoolConfigView;
  /** Licencia de escritura y escuela activada en la sede. */
  canWrite: boolean;
}

export const SDK_MESSAGES: Record<string, string> = {
  module_not_licensed: "Ski Net · Escuela no está incluido en el plan de esta sede.",
  module_read_only: "La licencia de la escuela está en solo lectura: puedes consultar, pero no hacer cambios.",
  module_not_active: "La escuela no está activada en esta sede.",
  module_not_installed: "La escuela aún no está instalada en la base de datos de tu empresa. Contacta con soporte.",
  site_unknown: "Esa sede no existe o está archivada.",
  license_unverifiable: "No hemos podido comprobar la licencia. Inténtalo de nuevo en unos minutos.",
};

/** Código del SDK (`[module_not_licensed] …`) de un error de tRPC, si lo hay. */
export function sdkCode(err: unknown): string | null {
  const m = /^\[([a-z_]+)\]/.exec(String((err as { message?: string } | null)?.message ?? ""));
  return m ? m[1] : null;
}

/** Mensaje legible de un error del módulo (los del SDK traducidos; los de negocio, tal cual). */
export function skiErrorMessage(err: unknown): string {
  const code = sdkCode(err);
  if (code && SDK_MESSAGES[code]) return SDK_MESSAGES[code];
  return errorToastMessage(err);
}
export const toastSki = (err: unknown) => toast.error(skiErrorMessage(err));

export const labelOf = (list: CodeLabel[], code: string | null | undefined) => (code ? (list.find((x) => x.code === code)?.label ?? code) : null);

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  // Solo la primera letra en mayúscula («Sábado, 7 de noviembre»; la clase capitalize de CSS ponía «De Noviembre»)
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export type ProductKind = "private" | "group" | "kids";
export const KIND_LABEL: Record<ProductKind, string> = { private: "Clase particular", group: "Cursillo / colectiva", kids: "Escuelita" };
export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Botones de selección múltiple sobre una lista configurada (el orden de selección se conserva). */
export function CodeToggles({ options, value, onChange, label }: { options: CodeLabel[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.code);
        return (
          <button
            key={o.code}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.code) : [...value, o.code])}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const SITE_KEY = "ski-school:site";

/** Sedes activas de la empresa y la elegida (recordada en este navegador; la comparten escuela y alquiler). */
export function useSkiSite() {
  const q = trpc.sites.list.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const active = (q.data?.sites ?? []).filter((s) => s.status === "active");
  const primary = q.data?.primarySiteId ?? "";
  const [chosen, setChosen] = useState<string>(() => {
    try {
      return localStorage.getItem(SITE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const siteId = active.some((s) => s.siteId === chosen) ? chosen : primary || active[0]?.siteId || "";
  const choose = (id: string) => {
    setChosen(id);
    try {
      localStorage.setItem(SITE_KEY, id);
    } catch {
      /* sin almacenamiento local: no se recuerda */
    }
  };
  return { q, active, siteId, choose };
}

/** Selector de sede (solo si la empresa tiene varias activas). */
export function SiteSelect({ sites }: { sites: ReturnType<typeof useSkiSite> }) {
  if (sites.active.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>Sede</span>
      <select
        className="h-9 max-w-[14rem] rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={sites.siteId}
        onChange={(e) => sites.choose(e.target.value)}
      >
        {sites.active.map((x) => (
          <option key={x.siteId} value={x.siteId}>
            {x.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SkiSchoolShell({ title, description, actions, children }: { title: string; description: string; actions?: (ctx: SkiCtx) => ReactNode; children: (ctx: SkiCtx) => ReactNode }) {
  const sites = useSkiSite();
  const status = trpc.skiSchool.status.useQuery({ siteId: sites.siteId }, { enabled: !!sites.siteId, retry: false });
  const utils = trpc.useUtils();
  const activate = trpc.skiSchool.activateSite.useMutation({
    onSuccess: () => {
      toast.success("Escuela activada en esta sede");
      utils.skiSchool.invalidate();
    },
    onError: toastSki,
  });
  useEffect(() => {
    document.title = `${title} · Ski Net`;
  }, [title]);

  const s = status.data;
  const ctx: SkiCtx | null = s ? { siteId: s.siteId, config: s.config, canWrite: s.license.write && s.active } : null;

  let body: ReactNode;
  if (sites.q.isLoading || (sites.siteId && status.isLoading)) body = <PanelLoading />;
  else if (sites.q.error) body = <PanelError error={sites.q.error} onRetry={() => sites.q.refetch()} />;
  else if (!sites.siteId) body = <PanelEmpty icon={<Building2 className="h-5 w-5" />} title="Sin sedes activas" description="Tu empresa no tiene ninguna sede activa. Revisa las sedes en Ajustes." />;
  else if (status.error) {
    const code = sdkCode(status.error);
    body =
      code === "module_not_licensed" ? (
        <PanelEmpty icon={<Lock className="h-5 w-5" />} title="No incluido en esta sede" description={SDK_MESSAGES.module_not_licensed} />
      ) : code && SDK_MESSAGES[code] ? (
        <PanelEmpty icon={<PackageOpen className="h-5 w-5" />} title="Escuela no disponible" description={SDK_MESSAGES[code]} />
      ) : (
        <PanelError title="No se ha podido abrir la escuela" error={status.error} onRetry={() => status.refetch()} />
      );
  } else if (s && !s.license.read) {
    body = <PanelEmpty icon={<Lock className="h-5 w-5" />} title="No incluido en esta sede" description={SDK_MESSAGES.module_not_licensed} />;
  } else if (s && !s.active) {
    body = (
      <PanelEmpty
        icon={<GraduationCap className="h-5 w-5" />}
        title="Activa la escuela en esta sede"
        description={s.license.write ? "Al activarla podrás dar de alta profesores, productos docentes y sesiones. Desactivarla después no borra nada." : "La escuela no está activada en esta sede y la licencia está en solo lectura."}
      >
        {s.license.write && (
          <Button onClick={() => activate.mutate({ siteId: s.siteId })} disabled={activate.isPending}>
            Activar la escuela
          </Button>
        )}
      </PanelEmpty>
    );
  } else if (ctx) body = children(ctx);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ski Net · Escuela</p>
            <h1 className="break-words text-2xl font-bold text-foreground">{title}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SiteSelect sites={sites} />
            {ctx && s?.active && actions?.(ctx)}
          </div>
        </header>
        {s && s.active && !s.license.write && (
          <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-foreground">
            {SDK_MESSAGES.module_read_only}
          </p>
        )}
        {body}
      </div>
    </AdminLayout>
  );
}
