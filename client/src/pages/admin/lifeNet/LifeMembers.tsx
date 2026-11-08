/**
 * Life Net · Miembros y hogar (/admin/life/miembros, solo la administración del hogar): datos del hogar y de la persona
 * titular (nombre y apellidos, NIF opcional, nombre del hogar editable) y miembros, con o sin acceso propio. Un miembro
 * con acceso es un usuario del panel (se invita desde «Usuarios y permisos»); uno sin acceso es un perfil, por ejemplo
 * un menor. El cupo lo fija el plan (5 incluidos por defecto). Archivar no borra nada.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Archive, Home, Pencil, Plus, RotateCcw, UserPlus } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { LIFE_COLORS, LIFE_RELATIONSHIPS, RELATIONSHIP_LABELS, defaultHouseholdName, householdProblem, type LifeColor, type LifeRelationship } from "@shared/lifeNet";
import { COLOR_LABELS, LifeGate, MemberChip, PageHeader, useLife } from "./LifeParts";

interface MemberForm {
  id?: number;
  displayName: string;
  relationship: LifeRelationship;
  color: LifeColor;
  userId: string;
  isHolder: boolean;
}
const NO_ACCESS = "none";

export default function LifeMembers() {
  const { access, canWrite, isAdmin } = useLife();
  const utils = trpc.useUtils();
  const enabled = access.isSuccess && isAdmin;
  const household = trpc.lifeNet.household.useQuery(undefined, { enabled, retry: false });
  const all = trpc.lifeNet.members.useQuery({ includeArchived: true }, { enabled, retry: false });
  const users = trpc.lifeNet.linkableUsers.useQuery(undefined, { enabled, retry: false });
  const [h, setH] = useState({ householdName: "", holderFirstName: "", holderLastName: "", holderTaxId: "" });
  const [form, setForm] = useState<MemberForm | null>(null);

  useEffect(() => {
    const d = household.data;
    if (d) setH({ householdName: d.configured ? d.householdName : "", holderFirstName: d.holderFirstName, holderLastName: d.holderLastName, holderTaxId: d.holderTaxId ?? "" });
  }, [household.data]);

  const refresh = () => {
    void utils.lifeNet.household.invalidate();
    void utils.lifeNet.members.invalidate();
    void utils.lifeNet.linkableUsers.invalidate();
    void utils.lifeNet.overview.invalidate();
    void utils.lifeNet.access.invalidate();
  };
  const saveHousehold = trpc.lifeNet.saveHousehold.useMutation({ onSuccess: () => { toast.success("Datos del hogar guardados"); refresh(); }, onError: (e) => toastError(e) });
  const upsert = trpc.lifeNet.upsertMember.useMutation({ onSuccess: () => { toast.success("Miembro guardado"); setForm(null); refresh(); }, onError: (e) => toastError(e) });
  const setActive = trpc.lifeNet.setMemberActive.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });

  const d = household.data;
  const members = all.data ?? [];
  const active = members.filter((m) => m.isActive);
  const archived = members.filter((m) => !m.isActive);
  const full = d ? d.memberLimit !== null && d.activeMembers >= d.memberLimit : false;

  const submitHousehold = () => {
    const p = householdProblem({ firstName: h.holderFirstName, lastName: h.holderLastName, taxId: h.holderTaxId, householdName: h.householdName });
    if (p) return toast.error(p);
    saveHousehold.mutate({ householdName: h.householdName || null, holderFirstName: h.holderFirstName, holderLastName: h.holderLastName, holderTaxId: h.holderTaxId || null });
  };
  const submitMember = () => {
    if (!form) return;
    if (!form.displayName.trim()) return toast.error("Indica el nombre del miembro.");
    upsert.mutate({ id: form.id, displayName: form.displayName, relationship: form.isHolder ? "otro" : form.relationship, color: form.color, userId: form.userId === NO_ACCESS ? null : Number(form.userId) });
  };

  if (access.isSuccess && !isAdmin) {
    return (
      <AdminLayout>
        <div className="mx-auto max-w-3xl">
          <PageHeader title="Miembros y hogar" description="Solo la persona titular o la administración del hogar gestiona los miembros y los datos del hogar." />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <LifeGate q={access}>
          <PageHeader title="Miembros y hogar" description="Quién forma parte de tu hogar, quién tiene acceso propio y los datos de la persona titular." />
          {household.isLoading || all.isLoading ? (
            <PanelLoading label="Cargando el hogar…" />
          ) : household.isError ? (
            <PanelError error={household.error} onRetry={() => household.refetch()} />
          ) : (
            d && (
              <>
                <section aria-labelledby="life-hogar" className="rounded-2xl border border-border bg-card p-5">
                  <h2 id="life-hogar" className="flex items-center gap-2 font-semibold text-foreground"><Home className="h-4 w-4" aria-hidden="true" />Datos del hogar</h2>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="life-h-first">Nombre del titular</Label>
                      <Input id="life-h-first" maxLength={100} autoComplete="given-name" value={h.holderFirstName} onChange={(e) => setH({ ...h, holderFirstName: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="life-h-last">Apellidos</Label>
                      <Input id="life-h-last" maxLength={160} autoComplete="family-name" value={h.holderLastName} onChange={(e) => setH({ ...h, holderLastName: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="life-h-nif">NIF (opcional)</Label>
                      <Input id="life-h-nif" maxLength={20} value={h.holderTaxId} onChange={(e) => setH({ ...h, holderTaxId: e.target.value })} />
                      <p className="text-xs text-muted-foreground">Solo si lo necesitas para tus facturas.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="life-h-name">Nombre del hogar</Label>
                      <Input id="life-h-name" maxLength={160} placeholder={defaultHouseholdName({ firstName: h.holderFirstName, lastName: h.holderLastName })} value={h.householdName} onChange={(e) => setH({ ...h, householdName: e.target.value })} />
                      <p className="text-xs text-muted-foreground">Si lo dejas vacío: «{defaultHouseholdName({ firstName: h.holderFirstName, lastName: h.holderLastName })}».</p>
                    </div>
                  </div>
                  {canWrite && <Button className="mt-3" disabled={saveHousehold.isPending} onClick={submitHousehold}>Guardar</Button>}
                </section>

                <section aria-labelledby="life-miembros" className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 id="life-miembros" className="font-semibold text-foreground">Miembros</h2>
                      <p className="text-sm text-muted-foreground">{d.activeMembers} {d.memberLimit !== null ? `de ${d.memberLimit} incluidos` : "miembros"}</p>
                    </div>
                    {canWrite && (
                      <Button disabled={full || !d.configured} onClick={() => setForm({ displayName: "", relationship: "hijo", color: "azul", userId: NO_ACCESS, isHolder: false })}>
                        <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Añadir miembro
                      </Button>
                    )}
                  </div>
                  {!d.configured && <p className="text-sm text-muted-foreground">Guarda primero los datos del hogar: la persona titular será el primer miembro.</p>}
                  {full && <p className="text-sm text-muted-foreground">Has llegado al número de miembros incluidos. Archiva a uno que ya no uses para añadir a otro.</p>}
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {active.map((m) => (
                      <li key={m.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <MemberChip m={m} />
                          <span className="text-xs text-muted-foreground">{RELATIONSHIP_LABELS[m.relationship]}</span>
                        </div>
                        <p className="break-words text-xs text-muted-foreground">
                          {m.hasAccess ? `Con acceso: ${m.userName ?? ""}${m.userEmail ? ` (${m.userEmail})` : ""}` : m.userId ? "Su usuario está desactivado: sin acceso" : "Sin acceso propio"}
                        </p>
                        {canWrite && (
                          <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => setForm({ id: m.id, displayName: m.displayName, relationship: m.relationship, color: m.color, userId: m.userId ? String(m.userId) : NO_ACCESS, isHolder: m.isHolder })}>
                              <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />Editar
                            </Button>
                            {!m.isHolder && <Button size="sm" variant="ghost" onClick={() => setActive.mutate({ id: m.id, active: false })}><Archive className="mr-1 h-4 w-4" aria-hidden="true" />Archivar</Button>}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {archived.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">Miembros archivados ({archived.length})</summary>
                      <ul className="mt-2 space-y-1">
                        {archived.map((m) => (
                          <li key={m.id} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 break-words text-muted-foreground">{m.displayName}</span>
                            {canWrite && <Button size="sm" variant="ghost" disabled={full} onClick={() => setActive.mutate({ id: m.id, active: true })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Recuperar</Button>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Para dar acceso propio a un miembro, invítale desde <Link href="/admin/usuarios" className="underline">Usuarios y permisos</Link> y después vincúlale aquí.
                  </p>
                </section>
              </>
            )
          )}
        </LifeGate>
      </div>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar miembro" : "Añadir miembro"}</DialogTitle>
            <DialogDescription>Un miembro sin acceso propio (por ejemplo, un menor) aparece en la agenda y en las tareas, pero no entra en el panel.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="life-m-name">Nombre</Label>
                <Input id="life-m-name" maxLength={120} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {!form.isHolder && (
                  <div className="space-y-1.5">
                    <Label htmlFor="life-m-rel">Relación</Label>
                    <Select value={form.relationship} onValueChange={(v) => setForm({ ...form, relationship: v as LifeRelationship })}>
                      <SelectTrigger id="life-m-rel"><SelectValue /></SelectTrigger>
                      <SelectContent>{LIFE_RELATIONSHIPS.filter((r) => r !== "titular").map((r) => <SelectItem key={r} value={r}>{RELATIONSHIP_LABELS[r]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="life-m-color">Color en la agenda</Label>
                  <Select value={form.color} onValueChange={(v) => setForm({ ...form, color: v as LifeColor })}>
                    <SelectTrigger id="life-m-color"><SelectValue /></SelectTrigger>
                    <SelectContent>{LIFE_COLORS.map((c) => <SelectItem key={c} value={c}>{COLOR_LABELS[c]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="life-m-user">Acceso</Label>
                <Select value={form.userId} onValueChange={(userId) => setForm({ ...form, userId })}>
                  <SelectTrigger id="life-m-user"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ACCESS}>Sin acceso propio</SelectItem>
                    {(users.data ?? [])
                      .filter((u) => u.memberId === null || u.memberId === form.id)
                      .map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name || u.email || `Usuario ${u.id}`}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Solo aparecen las personas que ya tienen acceso al panel y no están vinculadas a otro miembro.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button disabled={upsert.isPending} onClick={submitMember}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
