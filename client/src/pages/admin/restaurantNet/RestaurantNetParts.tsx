/**
 * Piezas comunes de Restaurant Net · sala, carta y comandas: elección del restaurante (los que gestiona quien entra),
 * estados vacíos con el siguiente paso, plano de sala escalado (con arrastre en la configuración) y colores de estado
 * por significado (panelTones), válidos en modo claro y oscuro.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { Store, Users, Link2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelEmpty } from "@/components/admin/PanelStates";
import { TONE_SURFACE, TONE_TEXT, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { FLOOR_H, FLOOR_W, RESTAURANT_NET_CAPABILITY, formatEur, type TableState } from "@shared/restaurantNet";

export const SALA_PATH = "/admin/restaurant-net/sala";
export const CARTA_PATH = "/admin/restaurant-net/carta";
export const CONFIG_PATH = "/admin/restaurant-net/salas-mesas";
export const comandaPath = (orderId: number) => `${SALA_PATH}/comanda/${orderId}`;

export const STATE_TONE: Record<TableState, Tone> = { libre: "success", ocupada: "warning", cuenta: "info" };

const STORAGE_KEY = "rnet.restaurantId";

/** Restaurantes que gestiona quien entra y el elegido (recordado en este navegador; `?r=` lo fija). */
export function useRestaurantChoice() {
  const list = trpc.restaurants.myRestaurants.useQuery();
  const [chosen, setChosen] = useState<number | null>(() => {
    const fromUrl = Number(new URLSearchParams(window.location.search).get("r"));
    if (fromUrl > 0) return fromUrl;
    try {
      const v = Number(window.localStorage.getItem(STORAGE_KEY));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const restaurants = list.data ?? [];
  const valid = restaurants.some((r) => r.id === chosen);
  const restaurantId = valid ? chosen : restaurants[0]?.id ?? null;
  const choose = (id: number) => {
    setChosen(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      /* sin almacenamiento: solo en esta visita */
    }
  };
  return { list, restaurants, restaurantId, restaurant: restaurants.find((r) => r.id === restaurantId) ?? null, choose };
}

/** ¿Puede modificar? Licencia activa (no en solo lectura). */
export function useRestaurantNetWrite() {
  const sub = usePanelSubscription();
  const { user } = useAuth();
  return { canWrite: sub.canWrite(RESTAURANT_NET_CAPABILITY), isAdmin: (user as { role?: string } | null)?.role === "admin" };
}

export function RestaurantPicker({ choice }: { choice: ReturnType<typeof useRestaurantChoice> }) {
  if (choice.restaurants.length < 2) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Label htmlFor="rnet-restaurant" className="shrink-0 text-sm text-muted-foreground">
        Restaurante
      </Label>
      <Select value={String(choice.restaurantId ?? "")} onValueChange={(v) => choice.choose(Number(v))}>
        <SelectTrigger id="rnet-restaurant" className="w-full min-w-0 sm:w-64">
          <SelectValue placeholder="Elige el restaurante" />
        </SelectTrigger>
        <SelectContent>
          {choice.restaurants.map((r) => (
            <SelectItem key={r.id} value={String(r.id)}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NoRestaurants({ isAdmin }: { isAdmin: boolean }) {
  return (
    <PanelEmpty
      icon={<Store className="h-5 w-5" />}
      title="Aún no hay ningún restaurante"
      description={
        isAdmin
          ? "Crea primero tu restaurante en «Reservas y mesas»; después configura sus salas, mesas y carta."
          : "No tienes ningún restaurante asignado. Pide a la administración que te asigne el tuyo."
      }
    >
      {isAdmin && (
        <Button asChild>
          <Link href="/admin/restaurantes">Crear el restaurante</Link>
        </Button>
      )}
    </PanelEmpty>
  );
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

export interface PlanTable {
  id: number;
  roomId: number;
  code: string;
  shape: string;
  capacity: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  mergedInto: number | null;
}

export interface PlanBadge {
  state: TableState;
  total?: number | null;
  guests?: number | null;
  /** Platos listos en cocina pendientes de servir. */
  ready?: number;
}

/** Contenido de una mesa (plano y listado). */
function TableFace({ t, badge, codeOf }: { t: PlanTable; badge?: PlanBadge; codeOf: (id: number) => string }) {
  return (
    <>
      <span className="text-sm font-bold leading-none text-foreground">{t.code}</span>
      <span className="mt-1 flex items-center gap-0.5 text-[11px] text-muted-foreground">
        <Users className="h-3 w-3" aria-hidden="true" />
        {badge?.guests ?? t.capacity}
      </span>
      {t.mergedInto != null && (
        <span className="mt-0.5 flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Link2 className="h-3 w-3" aria-hidden="true" />
          {codeOf(t.mergedInto)}
        </span>
      )}
      {badge && badge.state !== "libre" && badge.total != null && t.mergedInto == null && (
        <span className={cn("mt-0.5 text-[11px] font-semibold", TONE_TEXT[STATE_TONE[badge.state]])}>{formatEur(badge.total)}</span>
      )}
      {badge?.ready ? <span className="mt-0.5 rounded-full bg-success/15 px-1.5 text-[10px] font-semibold text-success">{badge.ready === 1 ? "1 lista" : `${badge.ready} listas`}</span> : null}
    </>
  );
}

/**
 * Plano de una sala escalado al ancho disponible (puntos FLOOR_W×FLOOR_H). `onMove`: la configuración arrastra las
 * mesas y guarda la posición al soltar; sin él, pulsar una mesa llama a `onSelect`.
 */
export function FloorPlan({
  tables,
  badges,
  onSelect,
  onMove,
  selectedId,
  label,
}: {
  tables: PlanTable[];
  badges?: Map<number, PlanBadge>;
  onSelect?: (t: PlanTable) => void;
  onMove?: (t: PlanTable, posX: number, posY: number) => void;
  selectedId?: number | null;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ id: number; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setWidth(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = width > 0 ? width / FLOOR_W : 0;
  const codeOf = (id: number) => tables.find((x) => x.id === id)?.code ?? "?";
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

  const toPlan = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const down = (e: ReactPointerEvent<HTMLButtonElement>, t: PlanTable) => {
    if (!onMove || !scale) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPlan(e);
    setDrag({ id: t.id, dx: p.x - t.posX, dy: p.y - t.posY, x: t.posX, y: t.posY, moved: false });
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>, t: PlanTable) => {
    if (!drag || drag.id !== t.id) return;
    const p = toPlan(e);
    const x = clamp(Math.round(p.x - drag.dx), FLOOR_W - t.width);
    const y = clamp(Math.round(p.y - drag.dy), FLOOR_H - t.height);
    setDrag({ ...drag, x, y, moved: drag.moved || Math.abs(x - t.posX) + Math.abs(y - t.posY) > 3 });
  };
  const up = (t: PlanTable) => {
    if (!drag || drag.id !== t.id) return;
    if (drag.moved) onMove?.(t, drag.x, drag.y);
    else onSelect?.(t);
    setDrag(null);
  };

  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      className="relative w-full overflow-hidden rounded-xl border border-border bg-muted/30"
      style={{ height: scale ? FLOOR_H * scale : 320 }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-50 bg-[linear-gradient(0deg,var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-[size:24px_24px]" />
      {scale > 0 &&
        tables.map((t) => {
          const b = badges?.get(t.id);
          const tone = b ? STATE_TONE[b.state] : "neutral";
          const x = drag?.id === t.id ? drag.x : t.posX;
          const y = drag?.id === t.id ? drag.y : t.posY;
          return (
            <button
              key={t.id}
              type="button"
              onClick={onMove ? undefined : () => onSelect?.(t)}
              onPointerDown={(e) => down(e, t)}
              onPointerMove={(e) => move(e, t)}
              onPointerUp={() => up(t)}
              onKeyDown={onMove ? (e) => { if (e.key === "Enter" || e.key === " ") onSelect?.(t); } : undefined}
              aria-label={`Mesa ${t.code}${b ? `, ${b.state === "libre" ? "libre" : b.state === "ocupada" ? "ocupada" : "pide la cuenta"}` : ""}`}
              aria-pressed={selectedId === t.id}
              className={cn(
                "absolute flex flex-col items-center justify-center border-2 text-center transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                t.shape === "round" ? "rounded-full" : "rounded-lg",
                TONE_SURFACE[tone],
                onMove ? "cursor-grab touch-none active:cursor-grabbing" : "hover:ring-2 hover:ring-primary/40",
                selectedId === t.id && "ring-2 ring-primary",
              )}
              style={{ left: x * scale, top: y * scale, width: t.width * scale, height: t.height * scale, fontSize: Math.max(10, 14 * Math.min(1, scale * 1.4)) }}
            >
              <TableFace t={t} badge={b} codeOf={codeOf} />
            </button>
          );
        })}
    </div>
  );
}

/** Listado de mesas (pantallas estrechas o preferencia): tarjetas en rejilla. */
export function TableGrid({ tables, badges, onSelect, selectedId }: { tables: PlanTable[]; badges?: Map<number, PlanBadge>; onSelect: (t: PlanTable) => void; selectedId?: number | null }) {
  const codeOf = (id: number) => tables.find((x) => x.id === id)?.code ?? "?";
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {tables.map((t) => {
        const b = badges?.get(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t)}
            aria-pressed={selectedId === t.id}
            className={cn(
              "flex min-h-[84px] min-w-0 flex-col items-center justify-center rounded-xl border-2 p-2 text-center hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              TONE_SURFACE[b ? STATE_TONE[b.state] : "neutral"],
              selectedId === t.id && "ring-2 ring-primary",
            )}
          >
            <TableFace t={t} badge={b} codeOf={codeOf} />
          </button>
        );
      })}
    </div>
  );
}

/** Leyenda de estados de mesa. */
export function StateLegend() {
  const items: Array<[TableState, string]> = [
    ["libre", "Libre"],
    ["ocupada", "Ocupada"],
    ["cuenta", "Pide la cuenta"],
  ];
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Estados de las mesas">
      {items.map(([s, l]) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={cn("inline-block h-3 w-3 rounded border-2", TONE_SURFACE[STATE_TONE[s]])} aria-hidden="true" />
          {l}
        </li>
      ))}
    </ul>
  );
}
