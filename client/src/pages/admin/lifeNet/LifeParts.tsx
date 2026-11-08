/**
 * Life Net · piezas comunes: cabecera, acceso de quien entra (administración del hogar o miembro con acceso), chips de
 * miembro con su color, selector de miembros y formatos de fecha. Vocabulario personal: hogar y miembros.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Checkbox } from "@/components/ui/checkbox";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { TONE_BADGE, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { LIFE_NET_CAPABILITY, LIFE_PATHS, TASK_STATE_LABELS, type LifeColor, type TaskState } from "@shared/lifeNet";

export { LIFE_PATHS };

export const COLOR_DOT: Record<LifeColor, string> = {
  rojo: "bg-red-500",
  azul: "bg-blue-500",
  verde: "bg-emerald-500",
  ambar: "bg-amber-500",
  violeta: "bg-violet-500",
  rosa: "bg-pink-500",
  gris: "bg-slate-500",
};
export const COLOR_LABELS: Record<LifeColor, string> = { rojo: "Rojo", azul: "Azul", verde: "Verde", ambar: "Ámbar", violeta: "Violeta", rosa: "Rosa", gris: "Gris" };

const STATE_TONE: Record<TaskState, Tone> = { pending: "info", overdue: "danger", done: "success" };

export interface MemberLite {
  id: number;
  displayName: string;
  color: LifeColor;
  hasAccess: boolean;
  isHolder: boolean;
}

/** Acceso de quien entra y si la licencia permite escribir. */
export function useLife() {
  const sub = usePanelSubscription();
  const access = trpc.lifeNet.access.useQuery(undefined, { retry: false });
  const members = trpc.lifeNet.members.useQuery(undefined, { enabled: access.isSuccess, retry: false });
  const canWrite = sub.canWrite(LIFE_NET_CAPABILITY) && !!access.data?.canWrite;
  return { access, members, canWrite, isAdmin: !!access.data?.isAdmin, memberId: access.data?.memberId ?? null };
}

/** Estados de carga y de acceso comunes a todas las pantallas. */
export function LifeGate({ q, children }: { q: { isLoading: boolean; isError: boolean; error?: unknown; refetch: () => unknown }; children: ReactNode }) {
  if (q.isLoading) return <PanelLoading label="Cargando tu hogar…" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} title="No se ha podido abrir Life Net" />;
  return <>{children}</>;
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-foreground">{title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MemberChip({ m }: { m: Pick<MemberLite, "displayName" | "color"> }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground">
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", COLOR_DOT[m.color])} />
      <span className="min-w-0 break-words">{m.displayName}</span>
    </span>
  );
}

export function MemberChips({ ids, members }: { ids: number[]; members: MemberLite[] }) {
  const byId = new Map(members.map((m) => [m.id, m] as const));
  const list = ids.map((i) => byId.get(i)).filter((m): m is MemberLite => !!m);
  if (!list.length) return <span className="text-xs text-muted-foreground">Sin asignar</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((m) => (
        <MemberChip key={m.id} m={m} />
      ))}
    </span>
  );
}

export function TaskStateBadge({ state }: { state: TaskState }) {
  return <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", TONE_BADGE[STATE_TONE[state]])}>{TASK_STATE_LABELS[state]}</span>;
}

/** Casillas de miembros (participantes o responsables). */
export function MemberPicker({ legend, members, value, onChange }: { legend: string; members: MemberLite[]; value: number[]; onChange: (ids: number[]) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {members.map((m) => (
          <label key={m.id} className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <Checkbox checked={value.includes(m.id)} onCheckedChange={(v) => onChange(v ? [...value, m.id] : value.filter((x) => x !== m.id))} />
            <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", COLOR_DOT[m.color])} />
            <span className="min-w-0 break-words">{m.displayName}</span>
          </label>
        ))}
      </div>
      {members.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Aún no hay miembros en el hogar. <Link href={LIFE_PATHS.members} className="underline">Añade los miembros</Link>.
        </p>
      )}
    </fieldset>
  );
}

/** Día AAAA-MM-DD como «sáb, 8 nov». */
export const fmtDay = (d: string, long = false) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", long ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const fmtStamp = (s: string | null) => (s ? `${fmtDay(s.slice(0, 10))}, ${s.slice(11, 16)}` : null);
export const fmtMs = (v: number | null) => (v ? new Date(v).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) : "—");

/** Fecha de hoy en el navegador (AAAA-MM-DD). */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
