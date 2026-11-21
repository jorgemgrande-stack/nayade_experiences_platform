/**
 * Web › Redirecciones: conserva los enlaces antiguos cuando cambias la dirección de una página o un producto.
 * Solo rutas de tu propia web (nunca otros dominios). El servidor avisa de bucles, cadenas y rutas que ya existen.
 */
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CornerDownRight, Pencil, Plus, Trash2 } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastError } from "@/components/admin/PanelStates";
import { useStudioText } from "@/components/admin/studio/useStudioText";
import { useI18n } from "@/i18n/I18nProvider";

type Form = { id?: number; fromPath: string; toPath: string; statusCode: 301 | 302; isActive: boolean; note: string };
const EMPTY: Form = { fromPath: "", toPath: "", statusCode: 301, isActive: true, note: "" };

export default function Redirecciones() {
  const tx = useStudioText();
  const { format } = useI18n();
  const utils = trpc.useUtils();
  const list = trpc.redirects.list.useQuery();
  const log = trpc.redirects.log.useQuery({ limit: 30 });
  const [form, setForm] = useState<Form | null>(null);
  const refresh = () => { void utils.redirects.list.invalidate(); void utils.redirects.log.invalidate(); };
  const done = (msg: string) => () => { setForm(null); refresh(); toast.success(msg); };
  const create = trpc.redirects.create.useMutation({ onSuccess: done(tx("Redirección creada.")), onError: (e) => toastError(e) });
  const update = trpc.redirects.update.useMutation({ onSuccess: done(tx("Redirección guardada.")), onError: (e) => toastError(e) });
  const remove = trpc.redirects.delete.useMutation({ onSuccess: () => { refresh(); toast.success(tx("Redirección eliminada.")); }, onError: (e) => toastError(e) });
  const busy = create.isPending || update.isPending;

  const save = () => {
    if (!form) return;
    const body = { fromPath: form.fromPath.trim(), toPath: form.toPath.trim(), statusCode: form.statusCode, isActive: form.isActive, note: form.note.trim() || null };
    if (form.id) update.mutate({ ...body, id: form.id });
    else create.mutate(body);
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold"><CornerDownRight className="h-6 w-6" />{" "}{tx("Redirecciones de tu web")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{tx("Si cambias la dirección de una página o de un producto, añade aquí la antigua y quienes tengan el enlace guardado llegarán a la nueva (y los buscadores la heredan). Solo se redirige dentro de tu web. Cada cambio queda registrado.")}</p>
          </div>
          <Button onClick={() => setForm({ ...EMPTY })}><Plus className="mr-1.5 h-4 w-4" />{" "}{tx("Nueva redirección")}</Button>
        </div>

        {form && (
          <div className="space-y-3 rounded-xl border p-4">
            <h2 className="font-semibold">{form.id ? tx("Modificar redirección") : tx("Nueva redirección")}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="rd-from">{tx("Dirección antigua")}</Label>
                <Input id="rd-from" value={form.fromPath} placeholder="/programa-antiguo" onChange={(e) => setForm({ ...form, fromPath: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="rd-to">{tx("Dirección nueva")}</Label>
                <Input id="rd-to" value={form.toPath} placeholder="/tienda/reconnect" onChange={(e) => setForm({ ...form, toPath: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="rd-note">{tx("Nota (opcional)")}</Label>
                <Input id="rd-note" value={form.note} maxLength={255} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1" />
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.statusCode === 301} onChange={() => setForm({ ...form, statusCode: 301 })} />{" "}{tx("Permanente (301)")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.statusCode === 302} onChange={() => setForm({ ...form, statusCode: 302 })} />{" "}{tx("Temporal (302)")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />{" "}{tx("Activa")}</label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy || !form.fromPath.trim() || !form.toPath.trim()}>{busy ? tx("Guardando…") : tx("Guardar")}</Button>
              <Button variant="outline" onClick={() => setForm(null)}>{tx("Cancelar")}</Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-3">{tx("Antigua")}</th><th className="p-3" /><th className="p-3">{tx("Nueva")}</th><th className="p-3">{tx("Tipo")}</th><th className="p-3">{tx("Usos")}</th><th className="p-3" /></tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{r.fromPath}{r.note && <div className="font-sans text-muted-foreground">{r.note}</div>}</td>
                  <td className="p-3"><ArrowRight className="h-4 w-4 text-muted-foreground" /></td>
                  <td className="p-3 font-mono text-xs">{r.toPath}</td>
                  <td className="p-3"><Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? r.statusCode : tx("{statusCode} · apagada", { statusCode: r.statusCode })}</Badge></td>
                  <td className="p-3">{r.hits}</td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" aria-label={tx("Modificar")} onClick={() => setForm({ id: r.id, fromPath: r.fromPath, toPath: r.toPath, statusCode: r.statusCode === 302 ? 302 : 301, isActive: r.isActive, note: r.note ?? "" })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" aria-label={tx("Eliminar")} onClick={() => { if (window.confirm(tx("¿Eliminar la redirección desde {fromPath}? Los enlaces antiguos dejarán de funcionar.", { fromPath: r.fromPath }))) remove.mutate({ id: r.id }); }}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
              {list.data && list.data.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{tx("Todavía no hay redirecciones.")}</td></tr>}
              {list.isLoading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{tx("Cargando…")}</td></tr>}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className="mb-2 font-semibold">{tx("Últimos cambios")}</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {(log.data ?? []).map((l) => (
              <li key={l.id}>{format.dateTime(l.createdAt, { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })} · {l.actorName ?? "—"} · {l.action === "create" ? tx("creó") : l.action === "update" ? tx("modificó") : tx("eliminó")} <span className="font-mono text-xs">{l.fromPath}{l.toPath ? tx(" → {toPath}", { toPath: l.toPath }) : ""}</span></li>
            ))}
            {log.data && log.data.length === 0 && <li>{tx("Sin cambios todavía.")}</li>}
          </ul>
        </div>
      </div>
    </AdminLayout>
  );
}
