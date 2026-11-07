/**
 * Marco común de las pantallas de Ski Net · Alquiler v1: selector de sede, estado de la licencia `ski-rental` y de la
 * activación en la sede (la de la v0.1), ajustes de la sede (tipos de material) y estados vacíos con el siguiente
 * paso. La autorización real la aplica el servidor (server/skiRental/unitService.ts); esto es presentación.
 */
import { useEffect, type ReactNode } from "react";
import { Building2, Lock, PackageOpen, Snowflake } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { errorToastMessage } from "@/lib/errorMessage";
import { SiteSelect, sdkCode, useSkiSite, type CodeLabel } from "@/components/ski/SkiSchoolShell";

export interface RentalCtx {
  siteId: string;
  canWrite: boolean;
  assetTypes: CodeLabel[];
}

const MESSAGES: Record<string, string> = {
  module_not_licensed: "Ski Net · Alquiler no está incluido en el plan de esta sede.",
  module_read_only: "La licencia del alquiler está en solo lectura: puedes consultar, pero no hacer cambios.",
  module_not_active: "El alquiler no está activado en esta sede.",
  module_not_installed: "El alquiler por unidades aún no está instalado en la base de datos de tu empresa. Contacta con soporte.",
  site_unknown: "Esa sede no existe o está archivada.",
  license_unverifiable: "No hemos podido comprobar la licencia. Inténtalo de nuevo en unos minutos.",
};

export function rentalErrorMessage(err: unknown): string {
  const code = sdkCode(err);
  return code && MESSAGES[code] ? MESSAGES[code] : errorToastMessage(err);
}
export const toastRental = (err: unknown) => toast.error(rentalErrorMessage(err));

export const UNIT_STATUS_LABEL: Record<string, string> = { available: "Disponible", rented: "Alquilada", workshop: "En taller", incident: "Incidencia", retired: "Retirada" };
export const unitStatusVariant = (s: string) => (s === "available" ? "default" : s === "rented" ? "secondary" : s === "retired" ? "outline" : "destructive") as "default" | "secondary" | "outline" | "destructive";
export const typeLabel = (types: CodeLabel[], code: string) => types.find((t) => t.code === code)?.label ?? code;
export const euros = (cents: number | null | undefined) => (cents == null ? "—" : (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" }));

export function SkiRentalShell({ title, description, actions, children }: { title: string; description: string; actions?: (ctx: RentalCtx) => ReactNode; children: (ctx: RentalCtx) => ReactNode }) {
  const sites = useSkiSite();
  const enabled = !!sites.siteId;
  const status = trpc.skiRental.status.useQuery({ siteId: sites.siteId }, { enabled, retry: false });
  const settings = trpc.skiRental.settings.useQuery({ siteId: sites.siteId }, { enabled: enabled && !!status.data?.license.read, retry: false });
  const utils = trpc.useUtils();
  const activate = trpc.skiRental.activateSite.useMutation({
    onSuccess: () => {
      toast.success("Alquiler activado en esta sede");
      utils.skiRental.invalidate();
    },
    onError: toastRental,
  });
  useEffect(() => {
    document.title = `${title} · Ski Net`;
  }, [title]);

  const s = status.data;
  const ctx: RentalCtx | null = s && settings.data ? { siteId: s.siteId, canWrite: s.license.write && s.active, assetTypes: settings.data.assetTypes } : null;

  let body: ReactNode;
  const err = status.error ?? settings.error;
  if (sites.q.isLoading || (enabled && (status.isLoading || (s?.license.read && settings.isLoading)))) body = <PanelLoading />;
  else if (sites.q.error) body = <PanelError error={sites.q.error} onRetry={() => sites.q.refetch()} />;
  else if (!sites.siteId) body = <PanelEmpty icon={<Building2 className="h-5 w-5" />} title="Sin sedes activas" description="Tu empresa no tiene ninguna sede activa. Revisa las sedes en Ajustes." />;
  else if (err) {
    const code = sdkCode(err);
    body =
      code && MESSAGES[code] ? (
        <PanelEmpty icon={code === "module_not_licensed" ? <Lock className="h-5 w-5" /> : <PackageOpen className="h-5 w-5" />} title={code === "module_not_licensed" ? "No incluido en esta sede" : "Alquiler no disponible"} description={MESSAGES[code]} />
      ) : (
        <PanelError title="No se ha podido abrir el alquiler" error={err} onRetry={() => (status.refetch(), settings.refetch())} />
      );
  } else if (s && !s.license.read) body = <PanelEmpty icon={<Lock className="h-5 w-5" />} title="No incluido en esta sede" description={MESSAGES.module_not_licensed} />;
  else if (s && !s.active)
    body = (
      <PanelEmpty
        icon={<Snowflake className="h-5 w-5" />}
        title="Activa el alquiler en esta sede"
        description={s.license.write ? "Al activarlo podrás dar de alta tiendas, material por unidades y hacer entregas con contrato. Desactivarlo después no borra nada." : "El alquiler no está activado en esta sede y la licencia está en solo lectura."}
      >
        {s.license.write && (
          <Button onClick={() => activate.mutate({ siteId: s.siteId })} disabled={activate.isPending}>
            Activar el alquiler
          </Button>
        )}
      </PanelEmpty>
    );
  else if (ctx) body = children(ctx);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ski Net · Alquiler</p>
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
            {MESSAGES.module_read_only}
          </p>
        )}
        {body}
      </div>
    </AdminLayout>
  );
}
