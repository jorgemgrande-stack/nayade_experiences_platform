/**
 * Restaurant Net · Salas y mesas (/admin/restaurant-net/salas-mesas): salas de cada restaurante y sus mesas (código,
 * forma, comensales) con su sitio en el plano (se arrastran y se guardan al soltar). Archivar no borra nada. Lo
 * protege la licencia restaurant-net; el servidor comprueba el restaurante en cada operación.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Archive, LayoutGrid, Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { ROOM_KINDS, ROOM_KIND_LABELS, TABLE_SHAPES, TABLE_SHAPE_LABELS, type RoomKind, type TableShape } from "@shared/restaurantNet";
import { FloorPlan, NoRestaurants, PageHeader, RestaurantPicker, SALA_PATH, useRestaurantChoice, useRestaurantNetWrite, type PlanTable } from "./RestaurantNetParts";

type RoomForm = { id?: number; name: string; kind: RoomKind };
type TableForm = { id?: number; roomId: number; code: string; shape: TableShape; capacity: string };

export default function SalasMesas() {
  const choice = useRestaurantChoice();
  const { canWrite, isAdmin } = useRestaurantNetWrite();
  const restaurantId = choice.restaurantId;
  const utils = trpc.useUtils();
  const rooms = trpc.restaurantNet.listRooms.useQuery({ restaurantId: restaurantId!, includeArchived: true }, { enabled: restaurantId != null });
  const tables = trpc.restaurantNet.listTables.useQuery({ restaurantId: restaurantId!, includeArchived: true }, { enabled: restaurantId != null });
  const [roomTab, setRoomTab] = useState<number | null>(null);
  const [roomForm, setRoomForm] = useState<RoomForm | null>(null);
  const [tableForm, setTableForm] = useState<TableForm | null>(null);

  const activeRooms = (rooms.data ?? []).filter((r) => r.isActive);
  const archivedRooms = (rooms.data ?? []).filter((r) => !r.isActive);
  useEffect(() => {
    if (activeRooms.length && (roomTab == null || !activeRooms.some((r) => r.id === roomTab))) setRoomTab(activeRooms[0].id);
  }, [rooms.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    utils.restaurantNet.listRooms.invalidate();
    utils.restaurantNet.listTables.invalidate();
    utils.restaurantNet.getFloor.invalidate();
  };
  const createRoom = trpc.restaurantNet.createRoom.useMutation({ onSuccess: (r) => { toast.success("Sala creada"); setRoomForm(null); setRoomTab(r.id); refresh(); }, onError: (e) => toastError(e) });
  const updateRoom = trpc.restaurantNet.updateRoom.useMutation({ onSuccess: () => { setRoomForm(null); refresh(); }, onError: (e) => toastError(e) });
  const createTable = trpc.restaurantNet.createTable.useMutation({ onSuccess: () => { toast.success("Mesa creada"); setTableForm(null); refresh(); }, onError: (e) => toastError(e) });
  const updateTable = trpc.restaurantNet.updateTable.useMutation({ onSuccess: () => { setTableForm(null); refresh(); }, onError: (e) => { toastError(e); refresh(); } });

  const roomTables = (tables.data ?? []).filter((t) => t.roomId === roomTab);
  const liveTables = roomTables.filter((t) => t.isActive);
  const archivedTables = roomTables.filter((t) => !t.isActive);
  const currentRoom = activeRooms.find((r) => r.id === roomTab) ?? null;

  const saveRoom = () => {
    if (!roomForm || !restaurantId) return;
    if (!roomForm.name.trim()) return toast.error("Indica el nombre de la sala");
    if (roomForm.id) updateRoom.mutate({ id: roomForm.id, name: roomForm.name, kind: roomForm.kind }, { onSuccess: () => toast.success("Sala guardada") });
    else createRoom.mutate({ restaurantId, name: roomForm.name, kind: roomForm.kind, sortOrder: activeRooms.length });
  };
  const saveTable = () => {
    if (!tableForm) return;
    const capacity = Number(tableForm.capacity);
    if (!tableForm.code.trim()) return toast.error("Indica el nombre o número de la mesa");
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) return toast.error("Los comensales deben ser un número entre 1 y 50");
    if (tableForm.id) updateTable.mutate({ id: tableForm.id, code: tableForm.code, shape: tableForm.shape, capacity, roomId: tableForm.roomId }, { onSuccess: () => toast.success("Mesa guardada") });
    else createTable.mutate({ roomId: tableForm.roomId, code: tableForm.code, shape: tableForm.shape, capacity });
  };
  const move = (t: PlanTable, posX: number, posY: number) => {
    utils.restaurantNet.listTables.setData({ restaurantId: restaurantId!, includeArchived: true }, (old) => old?.map((x) => (x.id === t.id ? { ...x, posX, posY } : x)));
    updateTable.mutate({ id: t.id, posX, posY });
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeader
          title="Salas y mesas"
          description="Crea las salas del restaurante (salón, terraza, barra…) y sus mesas. Arrastra las mesas en el plano para colocarlas como están en el local."
          actions={
            <>
              <RestaurantPicker choice={choice} />
              {liveTables.length > 0 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={SALA_PATH}>Ir a la sala</Link>
                </Button>
              )}
            </>
          }
        />

        {choice.list.isLoading ? (
          <PanelLoading label="Cargando los restaurantes…" />
        ) : choice.list.isError ? (
          <PanelError error={choice.list.error} onRetry={() => choice.list.refetch()} />
        ) : restaurantId == null ? (
          <NoRestaurants isAdmin={isAdmin} />
        ) : rooms.isLoading || tables.isLoading ? (
          <PanelLoading label="Cargando las salas…" />
        ) : rooms.isError ? (
          <PanelError error={rooms.error} onRetry={() => rooms.refetch()} />
        ) : activeRooms.length === 0 ? (
          <PanelEmpty
            icon={<LayoutGrid className="h-5 w-5" />}
            title="Crea tu primera sala"
            description="Empieza por la sala principal (por ejemplo, «Salón» o «Terraza»); después añade sus mesas."
          >
            {canWrite && <Button onClick={() => setRoomForm({ name: "Salón", kind: "salon" })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva sala</Button>}
          </PanelEmpty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Salas">
              {activeRooms.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={roomTab === r.id}
                  onClick={() => setRoomTab(r.id)}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm", roomTab === r.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted")}
                >
                  {r.name}
                </button>
              ))}
              {canWrite && (
                <Button variant="outline" size="sm" onClick={() => setRoomForm({ name: "", kind: "salon" })}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />Sala
                </Button>
              )}
            </div>

            {currentRoom && (
              <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="rnet-room-title">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 id="rnet-room-title" className="break-words text-lg font-bold text-foreground">{currentRoom.name}</h2>
                    <Badge variant="outline">{ROOM_KIND_LABELS[currentRoom.kind] ?? currentRoom.kind}</Badge>
                    <span className="text-sm text-muted-foreground">{liveTables.length} {liveTables.length === 1 ? "mesa" : "mesas"} · {liveTables.reduce((s, t) => s + t.capacity, 0)} comensales</span>
                  </div>
                  {canWrite && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setTableForm({ roomId: currentRoom.id, code: String(nextCode(tables.data ?? [])), shape: "square", capacity: "4" })}>
                        <Plus className="mr-1 h-4 w-4" aria-hidden="true" />Mesa
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRoomForm({ id: currentRoom.id, name: currentRoom.name, kind: currentRoom.kind })}>
                        <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />Sala
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => updateRoom.mutate({ id: currentRoom.id, isActive: false }, { onSuccess: () => toast.success("Sala archivada") })}>
                        <Archive className="mr-1 h-4 w-4" aria-hidden="true" />Archivar
                      </Button>
                    </div>
                  )}
                </div>

                {liveTables.length === 0 ? (
                  <PanelEmpty icon={<LayoutGrid className="h-5 w-5" />} title="Esta sala no tiene mesas" description="Añade las mesas con su número y comensales; luego colócalas en el plano.">
                    {canWrite && <Button onClick={() => setTableForm({ roomId: currentRoom.id, code: String(nextCode(tables.data ?? [])), shape: "square", capacity: "4" })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva mesa</Button>}
                  </PanelEmpty>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">{canWrite ? "Arrastra una mesa para moverla; púlsala para editarla." : "Vista del plano (solo lectura)."}</p>
                    <FloorPlan
                      label={`Plano de ${currentRoom.name}`}
                      tables={liveTables}
                      onMove={canWrite ? move : undefined}
                      onSelect={(t) => canWrite && setTableForm({ id: t.id, roomId: t.roomId, code: t.code, shape: t.shape as TableShape, capacity: String(t.capacity) })}
                    />
                    <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Mesas de la sala">
                      {liveTables.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <span className="min-w-0 break-words text-sm text-foreground">
                            Mesa <strong>{t.code}</strong> · {TABLE_SHAPE_LABELS[t.shape as TableShape] ?? t.shape} · {t.capacity} comensales
                            {t.mergedInto != null && <span className="text-muted-foreground"> · unida</span>}
                          </span>
                          {canWrite && (
                            <span className="flex gap-1">
                              <Button size="sm" variant="ghost" aria-label={`Editar la mesa ${t.code}`} onClick={() => setTableForm({ id: t.id, roomId: t.roomId, code: t.code, shape: t.shape as TableShape, capacity: String(t.capacity) })}>
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={`Archivar la mesa ${t.code}`} onClick={() => updateTable.mutate({ id: t.id, isActive: false }, { onSuccess: () => toast.success(`Mesa ${t.code} archivada`) })}>
                                <Archive className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {archivedTables.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Mesas archivadas ({archivedTables.length})</summary>
                    <ul className="mt-2 space-y-1">
                      {archivedTables.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Mesa {t.code}</span>
                          {canWrite && <Button size="sm" variant="ghost" onClick={() => updateTable.mutate({ id: t.id, isActive: true })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Recuperar</Button>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}

            {archivedRooms.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Salas archivadas ({archivedRooms.length})</summary>
                <ul className="mt-2 space-y-1">
                  {archivedRooms.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{r.name}</span>
                      {canWrite && <Button size="sm" variant="ghost" onClick={() => updateRoom.mutate({ id: r.id, isActive: true })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Recuperar</Button>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <Dialog open={roomForm != null} onOpenChange={(o) => !o && setRoomForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{roomForm?.id ? "Editar sala" : "Nueva sala"}</DialogTitle>
            <DialogDescription>El nombre que verá el equipo en el plano de la sala.</DialogDescription>
          </DialogHeader>
          {roomForm && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rnet-room-name">Nombre</Label>
                <Input id="rnet-room-name" value={roomForm.name} maxLength={120} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rnet-room-kind">Tipo</Label>
                <Select value={roomForm.kind} onValueChange={(v) => setRoomForm({ ...roomForm, kind: v as RoomKind })}>
                  <SelectTrigger id="rnet-room-kind" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROOM_KINDS.map((k) => <SelectItem key={k} value={k}>{ROOM_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoomForm(null)}>Cancelar</Button>
            <Button onClick={saveRoom} disabled={createRoom.isPending || updateRoom.isPending}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tableForm != null} onOpenChange={(o) => !o && setTableForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tableForm?.id ? `Editar la mesa ${tableForm.code}` : "Nueva mesa"}</DialogTitle>
            <DialogDescription>El número o nombre de la mesa es único en el restaurante.</DialogDescription>
          </DialogHeader>
          {tableForm && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="rnet-table-code">Mesa</Label>
                <Input id="rnet-table-code" value={tableForm.code} maxLength={40} onChange={(e) => setTableForm({ ...tableForm, code: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="rnet-table-cap">Comensales</Label>
                <Input id="rnet-table-cap" type="number" inputMode="numeric" min={1} max={50} value={tableForm.capacity} onChange={(e) => setTableForm({ ...tableForm, capacity: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="rnet-table-shape">Forma</Label>
                <Select value={tableForm.shape} onValueChange={(v) => setTableForm({ ...tableForm, shape: v as TableShape })}>
                  <SelectTrigger id="rnet-table-shape" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>{TABLE_SHAPES.map((s) => <SelectItem key={s} value={s}>{TABLE_SHAPE_LABELS[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="rnet-table-room">Sala</Label>
                <Select value={String(tableForm.roomId)} onValueChange={(v) => setTableForm({ ...tableForm, roomId: Number(v) })}>
                  <SelectTrigger id="rnet-table-room" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>{activeRooms.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTableForm(null)}>Cancelar</Button>
            <Button onClick={saveTable} disabled={createTable.isPending || updateTable.isPending}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

/** Siguiente número de mesa libre (las mesas suelen numerarse). */
function nextCode(tables: Array<{ code: string }>): number {
  const nums = tables.map((t) => Number(t.code)).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length ? Math.max(...nums) + 1 : 1;
}
