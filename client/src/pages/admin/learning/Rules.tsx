/**
 * Elephant Learning · Reglas de acceso con nombres comerciales (lotes 3-4): qué producto y modalidad abre qué módulos y durante cuánto.
 * Las reglas nuevas nacen INACTIVAS. Activar una regla hace que un pago confirmado conceda acceso, así que pide confirmación expresa.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { experienceLabel, variantLabel, modulesLabel } from "@shared/learningRules";
import { Pencil, Plus, ShieldCheck } from "lucide-react";

const fmtDate = (ms: number | null) => (ms ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" }).format(new Date(ms)) : "—");

type Rule = { id: number; experienceId: number; variantId: number | null; courseId: number; moduleIds: number[]; durationDays: number | null; startMode: "on_grant" | "fixed_date"; fixedStart: number | null; active: boolean; experienceName: string | null; variantName: string | null; courseTitle: string | null; moduleTitles: string[] };

function RuleForm({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const cat = trpc.learning.admin.catalog.useQuery();
  const [experienceId, setExperienceId] = useState<number | "">(rule?.experienceId ?? "");
  const [variantId, setVariantId] = useState<number | "">(rule?.variantId ?? "");
  const [courseId, setCourseId] = useState<number | "">(rule?.courseId ?? "");
  const [moduleIds, setModuleIds] = useState<number[]>(rule?.moduleIds ?? []);
  const [days, setDays] = useState<string>(rule?.durationDays != null ? String(rule.durationDays) : "");
  const [active, setActive] = useState<boolean>(rule?.active ?? false);
  const save = trpc.learning.admin.saveRule.useMutation({ onSuccess: () => { toast.success(active ? "Regla guardada y ACTIVA." : "Regla guardada (inactiva)."); onSaved(); }, onError: (e) => toastError(e) });
  const exp = cat.data?.experiences.find((e) => e.id === experienceId);
  const course = cat.data?.courses.find((c) => c.id === courseId);
  const valid = experienceId !== "" && courseId !== "" && moduleIds.length > 0 && (days === "" || (Number(days) >= 1 && Number(days) <= 3650));
  const wasActive = rule?.active ?? false;
  function submit() {
    if (active && !wasActive && !confirm("Activar esta regla hará que un pago confirmado de este producto conceda acceso al curso. ¿Activarla?")) return;
    save.mutate({ id: rule?.id, experienceId: Number(experienceId), variantId: variantId === "" ? null : Number(variantId), courseId: Number(courseId), moduleIds, durationDays: days === "" ? null : Number(days), startMode: "on_grant", fixedStart: null, active });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{rule ? "Editar regla de acceso" : "Nueva regla de acceso"}</DialogTitle></DialogHeader>
        {cat.isLoading ? <PanelLoading /> : cat.isError ? <PanelError error={cat.error} onRetry={() => cat.refetch()} /> : (
          <div className="space-y-3 text-sm">
            <label className="block">Producto
              <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={experienceId} onChange={(e) => { setExperienceId(e.target.value ? Number(e.target.value) : ""); setVariantId(""); }}>
                <option value="">Elige un producto…</option>
                {cat.data!.experiences.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </label>
            <label className="block">Modalidad
              <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={variantId} disabled={experienceId === ""} onChange={(e) => setVariantId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Cualquier modalidad</option>
                {(exp?.variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="block">Curso
              <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={courseId} onChange={(e) => { setCourseId(e.target.value ? Number(e.target.value) : ""); setModuleIds([]); }}>
                <option value="">Elige un curso…</option>
                {cat.data!.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            {course && (
              <fieldset className="space-y-1"><legend className="mb-1">Módulos que abre</legend>
                {course.modules.map((m) => (
                  <label key={m.id} className="flex items-center gap-2"><input type="checkbox" checked={moduleIds.includes(m.id)} onChange={(e) => setModuleIds(e.target.checked ? [...moduleIds, m.id] : moduleIds.filter((x) => x !== m.id))} />{m.title}</label>
                ))}
              </fieldset>
            )}
            <label className="block">Duración del acceso en días (vacío = sin límite)<Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} placeholder="Por ejemplo, 365" /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Regla activa (concede acceso con un pago confirmado)</label>
            {!active && <p className="text-xs text-muted-foreground">Inactiva: se guarda sin efecto. Actívala cuando las condiciones comerciales estén confirmadas.</p>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!valid || save.isPending} onClick={submit}>Guardar</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Rules() {
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.rules.useQuery();
  const [editing, setEditing] = useState<Rule | null | "new">(null);
  const rules = useMemo(() => (q.data ?? []) as Rule[], [q.data]);
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Cada regla dice qué módulos abre una modalidad de compra y durante cuánto tiempo. Solo se aplican cuando están activas.</p>
        <Button onClick={() => setEditing("new")}><Plus className="mr-1.5 h-4 w-4" aria-hidden />Nueva regla</Button>
      </div>
      {!rules.length ? <PanelEmpty title="Sin reglas" description="Una regla une una modalidad del catálogo con los módulos que abre y su duración. Sin regla no hay acceso." /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rules.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden /><span className="truncate">{experienceLabel(r)}</span></h3>
                  <p className="text-sm text-muted-foreground">{variantLabel(r)}</p>
                </div>
                <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Activa" : "Inactiva"}</Badge>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Curso</dt><dd>{r.courseTitle ?? "—"}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Abre</dt><dd>{modulesLabel(r)}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Duración</dt><dd>{r.durationDays ? `${r.durationDays} días` : "Sin límite"}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Inicio</dt><dd>{r.startMode === "fixed_date" ? fmtDate(r.fixedStart) : "Al conceder el acceso"}</dd></div>
              </dl>
              <div className="mt-3"><Button size="sm" variant="outline" onClick={() => setEditing(r)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden />Editar</Button></div>
            </li>
          ))}
        </ul>
      )}
      {editing && <RuleForm rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); utils.learning.admin.rules.invalidate(); }} />}
    </div>
  );
}
