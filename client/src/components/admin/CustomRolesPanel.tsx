/**
 * Roles personalizados (capacidad Business `roles-custom`) dentro de «Usuarios». Solo se monta con la capacidad
 * contratada; el servidor lo vuelve a comprobar en cada operación.
 *
 * Un rol propio parte de un rol base y permite quitar o añadir permisos de la lista; se asigna a usuarios con ese mismo
 * rol base. Sin rol propio, cada usuario sigue exactamente con los permisos de su rol.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { Pencil, Plus, ShieldPlus, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS } from "@shared/roleLabels";
import { useI18n } from "@/i18n/I18nProvider";
import {
  CUSTOM_ROLE_BASES, CUSTOM_ROLE_NAME_MAX, CUSTOM_ROLE_PERMISSIONS, basePermissions, normalizeCustomRoleName,
} from "@shared/customRoles";

type PanelUser = { id: number; name: string | null; email: string | null; role: string };
type Editing = { id: number | null; name: string; baseRole: string; permissions: string[] };

const GROUPS = Array.from(new Set(CUSTOM_ROLE_PERMISSIONS.map((d) => d.group)));
const GROUP_KEYS: Record<string, string> = {
  "Ventas": "sales", "TPV y caja": "tpv", "Operaciones": "operations", "Contabilidad": "accounting", "Personas": "people",
};

export default function CustomRolesPanel({ users, canWrite }: { users: PanelUser[]; canWrite: boolean }) {
  const { t } = useI18n();
  const rl = (r: string) => (r in ROLE_LABELS ? t(`roles.${r}`) : r);
  const utils = trpc.useUtils();
  const list = trpc.customRoles.list.useQuery();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [assignTo, setAssignTo] = useState<Record<number, string>>({});

  const done = (msg: string) => () => {
    void utils.customRoles.list.invalidate();
    toast.success(msg);
  };
  const fail = (e: { message: string }) => toast.error(t("customRoles.saveFailed"), { description: e.message });
  const create = trpc.customRoles.create.useMutation({ onSuccess: () => { done(t("customRoles.created"))(); setEditing(null); }, onError: fail });
  const update = trpc.customRoles.update.useMutation({ onSuccess: () => { done(t("customRoles.updated"))(); setEditing(null); }, onError: fail });
  const remove = trpc.customRoles.remove.useMutation({ onSuccess: done(t("customRoles.deleted")), onError: fail });
  const assign = trpc.customRoles.assign.useMutation({ onSuccess: done(t("customRoles.assignmentUpdated")), onError: fail });

  const roles = list.data?.roles ?? [];
  const assignedIds = useMemo(() => new Set(roles.flatMap((r) => r.users.map((u) => u.id))), [roles]);
  const nameCheck = editing ? normalizeCustomRoleName(editing.name) : null;

  if (list.isLoading) return <PanelLoading />;
  if (list.isError) return <PanelError error={list.error} onRetry={() => void list.refetch()} />;

  function save() {
    if (!editing || !nameCheck?.ok) return;
    if (editing.id === null) create.mutate({ name: editing.name, baseRole: editing.baseRole, permissions: editing.permissions });
    else update.mutate({ id: editing.id, name: editing.name, permissions: editing.permissions });
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4" aria-labelledby="roles-propios">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="roles-propios" className="text-base font-semibold text-gray-900">{t("customRoles.title")}</h3>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            {t("customRoles.intro")}
          </p>
        </div>
        {canWrite && (
          <Button className="gap-2" onClick={() => setEditing({ id: null, name: "", baseRole: "agente", permissions: basePermissions("agente") })}>
            <Plus className="w-4 h-4" aria-hidden="true" /> {t("customRoles.newRole")}
          </Button>
        )}
      </div>

      {roles.length === 0 ? (
        <p className="text-sm text-gray-500">{t("customRoles.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {roles.map((r) => {
            const candidates = users.filter((u) => u.role === r.baseRole && !assignedIds.has(u.id));
            return (
              <li key={r.id} className="rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-500">{t("customRoles.basedOn", { role: rl(r.baseRole) })}</p>
                  </div>
                  {canWrite && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditing({ id: r.id, name: r.name, baseRole: r.baseRole, permissions: r.permissions })}>
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> {t("customRoles.edit")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-danger"
                        disabled={r.users.length > 0 || remove.isPending}
                        title={r.users.length > 0 ? t("customRoles.deleteBlocked") : undefined}
                        onClick={() => remove.mutate({ id: r.id })}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> {t("customRoles.delete")}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {r.grants.map((k) => (
                    <span key={k} className="rounded-full bg-success/10 text-success border border-success/40 px-2 py-0.5">+ {labelOf(k, t)}</span>
                  ))}
                  {r.revokes.map((k) => (
                    <span key={k} className="rounded-full bg-warning/10 text-warning border border-warning/40 px-2 py-0.5">− {labelOf(k, t)}</span>
                  ))}
                  {r.grants.length === 0 && r.revokes.length === 0 && <span className="text-gray-500">{t("customRoles.samePermissions", { role: rl(r.baseRole) })}</span>}
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-gray-600">{t("customRoles.users")}</p>
                  {r.users.length === 0 && <p className="text-xs text-gray-500">{t("customRoles.noUsers")}</p>}
                  {r.users.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        {u.name || u.email}
                        {!u.applies && <span className="ml-2 text-xs text-warning">{t("customRoles.notApplied", { role: rl(r.baseRole) })}</span>}
                      </span>
                      {canWrite && (
                        <Button variant="ghost" size="sm" className="gap-1" disabled={assign.isPending} onClick={() => assign.mutate({ userId: u.id, roleId: null })}>
                          <UserMinus className="w-3.5 h-3.5" aria-hidden="true" /> {t("customRoles.remove")}
                        </Button>
                      )}
                    </div>
                  ))}
                  {canWrite && candidates.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <Select value={assignTo[r.id] ?? ""} onValueChange={(v) => setAssignTo((s) => ({ ...s, [r.id]: v }))}>
                        <SelectTrigger className="h-8 w-64 text-sm" aria-label={t("customRoles.assignAria", { name: r.name })}>
                          <SelectValue placeholder={t("customRoles.pickUser")} />
                        </SelectTrigger>
                        <SelectContent>
                          {candidates.map((u) => (
                            <SelectItem key={u.id} value={String(u.id)}>{u.name || u.email}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={!assignTo[r.id] || assign.isPending}
                        onClick={() => { assign.mutate({ userId: Number(assignTo[r.id]), roleId: r.id }); setAssignTo((s) => ({ ...s, [r.id]: "" })); }}
                      >
                        <ShieldPlus className="w-3.5 h-3.5" aria-hidden="true" /> {t("customRoles.assign")}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id === null ? t("customRoles.dialogNew") : t("customRoles.dialogEdit")}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rol-nombre">{t("customRoles.name")}</Label>
                <Input id="rol-nombre" maxLength={CUSTOM_ROLE_NAME_MAX} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                {editing.name !== "" && nameCheck && !nameCheck.ok && <p className="text-xs text-danger">{editing.name.trim() === "" ? t("customRoles.nameEmpty") : t("customRoles.nameTooLong", { max: CUSTOM_ROLE_NAME_MAX })}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{t("customRoles.baseRole")}</Label>
                {editing.id === null ? (
                  <Select value={editing.baseRole} onValueChange={(v) => setEditing({ ...editing, baseRole: v, permissions: basePermissions(v) })}>
                    <SelectTrigger aria-label={t("customRoles.baseRole")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CUSTOM_ROLE_BASES.map((b) => <SelectItem key={b} value={b}>{rl(b)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-gray-700">{t("customRoles.baseLocked", { role: rl(editing.baseRole) })}</p>
                )}
                <p className="text-xs text-gray-500">{t("customRoles.baseHint")}{editing.baseRole === "readonly" ? t("customRoles.baseReadonly") : ""}</p>
              </div>
              <div className="space-y-3">
                {GROUPS.map((g) => (
                  <fieldset key={g} className="space-y-1.5">
                    <legend className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{GROUP_KEYS[g] ? t(`customRoles.group.${GROUP_KEYS[g]}`) : g}</legend>
                    {CUSTOM_ROLE_PERMISSIONS.filter((d) => d.group === g).map((d) => {
                      const checked = editing.permissions.includes(d.key);
                      const inBase = d.defaultRoles.includes(editing.baseRole);
                      return (
                        <label key={d.key} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setEditing({ ...editing, permissions: v ? [...editing.permissions, d.key] : editing.permissions.filter((k) => k !== d.key) })
                            }
                          />
                          <span>{t(`customRoles.perm.${d.key.replace(/\./g, "_")}`)}</span>
                          {checked !== inBase && <span className="text-xs text-info">{checked ? t("customRoles.added") : t("customRoles.removed")}</span>}
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("customRoles.cancel")}</Button>
            <Button onClick={save} disabled={!nameCheck?.ok || create.isPending || update.isPending}>{t("customRoles.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function labelOf(key: string, t: (k: string) => string): string {
  return CUSTOM_ROLE_PERMISSIONS.some((d) => d.key === key) ? t(`customRoles.perm.${key.replace(/\./g, "_")}`) : key;
}
