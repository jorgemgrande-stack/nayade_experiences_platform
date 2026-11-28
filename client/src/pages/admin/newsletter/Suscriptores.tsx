/**
 * Newsletter · Suscriptores (/admin/newsletter/suscriptores): cifras, listas por idioma (una por idioma público de la web),
 * listado con filtros, ficha con historial de consentimiento y errores de envío, exportación a Excel/CSV (total o por lista),
 * importación de contactos históricos (sin enviar correos) y ajustes de los correos. La autorización real la aplica el
 * servidor (rol de administrador). Nadie «activa» a un suscriptor desde aquí: solo la persona, confirmando su correo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Languages, Mail, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { toastError } from "@/lib/errorMessage";
import { usePanelLocale, usePanelTag, usePanelText } from "@/i18n/usePanelText";

type Status = "pending" | "active" | "unsubscribed" | "imported";
type SortKey = "createdAt" | "email" | "confirmedAt" | "status" | "locale" | "source";
type DateField = "createdAt" | "confirmedAt" | "unsubscribedAt";
/** Idiomas con plantilla de correo editable (los idiomas de las listas son los públicos de la empresa). */
const TEMPLATE_LOCALES = ["de", "es", "en"] as const;
const LOCALE_LABEL: Record<string, string> = { de: "Alemán", es: "Español", en: "Inglés" };
const STATUS: Record<Status, { label: string; variant: "default" | "secondary" | "outline" }> = {
  pending: { label: "Pendiente", variant: "secondary" },
  active: { label: "Activo", variant: "default" },
  unsubscribed: { label: "Baja", variant: "outline" },
  imported: { label: "Histórico (sin consentimiento)", variant: "outline" },
};
const ACTION: Record<string, string> = {
  requested: "Solicitud",
  confirmed: "Confirmada",
  unsubscribed: "Baja (enlace)",
  admin_unsubscribed: "Baja administrativa",
  resubscribe_requested: "Nueva solicitud tras baja",
  resignup_ignored: "Petición ignorada (ya activo)",
  confirmation_resent: "Confirmación reenviada",
  welcome_sent: "Bienvenida enviada",
  updated: "Datos actualizados",
  crm_resync: "Sincronización CRM",
  imported: "Importado (histórico)",
};
const LOCALE_SOURCE: Record<string, string> = {
  web: "web (idioma de la web de alta)",
  subscriber: "la propia persona (nueva petición pendiente)",
  admin: "panel (cambiado por el equipo)",
  import: "importación histórica",
};
const IMPORT_ACTION: Record<string, string> = {
  create: "Nuevo (histórico)",
  match_active: "Ya activo",
  match_pending: "Ya pendiente",
  match_unsubscribed: "Baja previa",
  match_imported: "Ya importado",
  reject: "Rechazado",
};
const MAIL_KIND: Record<string, string> = { confirm: "Confirmación", welcome: "Bienvenida" };
const MAIL_STATUS: Record<string, string> = { sending: "Enviando", sent: "Enviado", failed: "Fallido" };
const MAX_FILE_BYTES = 5 * 1024 * 1024;
function useFmt() {
  const tag = usePanelTag();
  return (ms: number | null | undefined) => (ms ? new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" }).format(new Date(ms)) : "—");
}
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type ListInfo = { id: string; locale: string; label: string; labelDe: string; isPublic: boolean; isDefault: boolean; active: number; pending: number; unsubscribed: number; imported: number; total: number };
/** Nombre de una lista en el idioma del panel. */
function useListName() {
  const ui = usePanelLocale();
  return (l: ListInfo | undefined, locale?: string) => (l ? (ui === "de" ? l.labelDe : l.label) : locale ?? "");
}
function useLocaleName() {
  const ui = usePanelLocale();
  const px = usePanelText();
  return (locale: string) => {
    if (LOCALE_LABEL[locale]) return px(LOCALE_LABEL[locale]);
    try {
      const n = new Intl.DisplayNames([ui], { type: "language" }).of(locale);
      return n ? n.charAt(0).toUpperCase() + n.slice(1) : locale;
    } catch {
      return locale;
    }
  };
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Stats() {
  const px = usePanelText();
  const q = trpc.newsletter.stats.useQuery(undefined, { retry: false });
  const s = q.data;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat label={px("Suscriptores activos")} value={s?.active ?? "—"} hint={s ? `${s.total} ${px("en total")}` : undefined} />
      <Stat label={px("Altas recientes")} value={s ? s.joined7d : "—"} hint={s ? `${s.joined30d} ${px("en los últimos 30 días")}` : px("Últimos 7 días")} />
      <Stat label={px("Pendientes de confirmar")} value={s?.pending ?? "—"} />
      <Stat label={px("Bajas")} value={s?.unsubscribed ?? "—"} hint={s ? `${s.left30d} ${px("en los últimos 30 días")}` : undefined} />
      <Stat label={px("Histórico")} value={s?.imported ?? "—"} hint={px("Sin consentimiento")} />
    </div>
  );
}

const exportHref = (format: "xlsx" | "csv", params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams({ format });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  return `/api/newsletter/export?${p.toString()}`;
};

/** Una tarjeta por lista (idioma) con recuentos, «Ver» (aplica el filtro) y exportación por lista. */
function Lists({ onView }: { onView: (locale: string) => void }) {
  const px = usePanelText();
  const name = useListName();
  const q = trpc.newsletter.lists.useQuery(undefined, { retry: false });
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="flex items-center gap-2 font-medium text-foreground"><Languages className="h-4 w-4" />{px("Listas por idioma")}</h3>
          <p className="text-xs text-muted-foreground">{px("Una lista por idioma público de la web. Cada persona está en una sola lista: la del idioma de la web desde la que se inscribió (nunca por país ni IP).")}</p>
        </div>
        {q.isLoading && <PanelLoading />}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(q.data ?? []).map((l) => (
            <div key={l.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{name(l)}</p>
                  <p className="text-xs text-muted-foreground">{l.id}{l.isDefault ? ` · ${px("Idioma principal")}` : ""}</p>
                </div>
                <span className="text-2xl font-semibold tabular-nums text-foreground">{l.active}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {l.active} {px("activos")} · {l.pending} {px("pendientes")} · {l.unsubscribed} {px("bajas")} · {l.imported} {px("históricos")}
              </p>
              {!l.isPublic && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{px("Sin página pública en este idioma")}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => onView(l.locale)}>{px("Ver")}</Button>
                <Button asChild size="sm" variant="ghost"><a href={exportHref("csv", { list: l.id })} download><Download className="mr-1 h-3.5 w-3.5" />{px("Exportar CSV")}</a></Button>
                <Button asChild size="sm" variant="ghost"><a href={exportHref("xlsx", { list: l.id })} download><Download className="mr-1 h-3.5 w-3.5" />{px("Exportar Excel")}</a></Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({ id, lists, onClose }: { id: number | null; lists: ListInfo[]; onClose: () => void }) {
  const px = usePanelText();
  const fmt = useFmt();
  const name = useListName();
  const utils = trpc.useUtils();
  const q = trpc.newsletter.get.useQuery({ id: id ?? 0 }, { enabled: id != null, retry: false });
  const [reason, setReason] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const refresh = () => {
    void utils.newsletter.get.invalidate();
    void utils.newsletter.list.invalidate();
    void utils.newsletter.stats.invalidate();
    void utils.newsletter.lists.invalidate();
  };
  const ok = (msg: string) => () => (toast.success(msg), refresh());
  const locale = trpc.newsletter.updateLocale.useMutation({ onSuccess: ok(px("Idioma actualizado")), onError: (e) => toastError(e) });
  const resendC = trpc.newsletter.resendConfirmation.useMutation({ onSuccess: (r) => (r.sent ? toast.success(px("Confirmación reenviada")) : toast.error(px("El correo no salió: revisa el registro de envíos")), refresh()), onError: (e) => toastError(e) });
  const resendW = trpc.newsletter.resendWelcome.useMutation({ onSuccess: (r) => (r.sent ? toast.success(px("Bienvenida enviada")) : toast.error(`${px("No se envió")} (${r.reason ?? px("sin motivo")})`), refresh()), onError: (e) => toastError(e) });
  const crm = trpc.newsletter.retryCrm.useMutation({ onSuccess: ok(px("Enlace con el CRM reintentado")), onError: (e) => toastError(e) });
  const off = trpc.newsletter.unsubscribe.useMutation({ onSuccess: () => (toast.success(px("Baja registrada")), setConfirmOff(false), setReason(""), refresh()), onError: (e) => toastError(e) });
  const d = q.data;
  const sub = d?.subscriber;
  const options = useMemo(() => {
    const ids = lists.map((l) => l.locale);
    return sub && !ids.includes(sub.locale) ? [...ids, sub.locale] : ids;
  }, [lists, sub]);
  const listOf = (l: string) => lists.find((x) => x.locale === l);
  return (
    <>
      <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="break-all">{sub?.email ?? px("Suscriptor")}</SheetTitle>
            <SheetDescription>{px("Ficha, historial de consentimiento y registro de envíos.")}</SheetDescription>
          </SheetHeader>
          {q.isLoading && <PanelLoading />}
          {q.error && <PanelError error={q.error} onRetry={() => q.refetch()} />}
          {d && sub && (
            <div className="space-y-5 px-4 pb-6 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS[sub.status as Status].variant}>{px(STATUS[sub.status as Status].label)}</Badge>
                <span className="text-muted-foreground">{px("Origen")}: {sub.source}{sub.page ? ` · ${sub.page}` : ""}</span>
              </div>
              {sub.status === "imported" && <p className="rounded-md border border-amber-400/50 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{px("Contacto histórico sin consentimiento acreditado: no recibe correos hasta que se inscriba desde la web y confirme.")}</p>}
              {sub.crmSyncError && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">CRM: {sub.crmSyncError}</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {sub.name && (<><dt className="text-muted-foreground">{px("Nombre")}</dt><dd>{sub.name}</dd></>)}
                <dt className="text-muted-foreground">{px("Inscripción")}</dt><dd>{fmt(sub.createdAt)}</dd>
                <dt className="text-muted-foreground">{px("Confirmación")}</dt><dd>{fmt(sub.confirmedAt)}</dd>
                <dt className="text-muted-foreground">{px("Baja")}</dt><dd>{fmt(sub.unsubscribedAt)}</dd>
                <dt className="text-muted-foreground">{px("Bienvenida")}</dt><dd>{fmt(sub.welcomeSentAt)}</dd>
                <dt className="text-muted-foreground">{px("Cliente del CRM")}</dt><dd>{sub.clientId ?? "—"}</dd>
                <dt className="text-muted-foreground">{px("Idioma")}</dt>
                <dd>
                  <select className={selectClass} value={sub.locale} disabled={locale.isPending} onChange={(e) => locale.mutate({ id: sub.id, locale: e.target.value })} aria-label={px("Idioma")}>
                    {options.map((l) => <option key={l} value={l}>{name(listOf(l), l)}</option>)}
                  </select>
                </dd>
                <dt className="text-muted-foreground">{px("Idioma de alta")}</dt><dd>{sub.signupLocale ? name(listOf(sub.signupLocale), sub.signupLocale) : "—"}</dd>
                <dt className="text-muted-foreground">{px("Origen del idioma")}</dt><dd>{LOCALE_SOURCE[sub.localeSource] ? px(LOCALE_SOURCE[sub.localeSource]) : sub.localeSource}</dd>
                {sub.importId != null && (<><dt className="text-muted-foreground">{px("Lote de importación")}</dt><dd>#{sub.importId}{sub.importedAt ? ` · ${px("Importado el")} ${fmt(sub.importedAt)}` : ""}</dd></>)}
              </dl>
              <section>
                <h3 className="mb-1 font-medium text-foreground">{px("Consentimiento aceptado")} {sub.consentVersion ? `(${px("versión")} ${sub.consentVersion})` : ""}</h3>
                <p className="rounded-md bg-muted p-3 text-muted-foreground">{sub.consentText ?? "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{px("Aceptado el")} {fmt(sub.consentAt)}</p>
              </section>
              <div className="flex flex-wrap gap-2">
                {sub.status === "pending" && <Button size="sm" variant="outline" disabled={resendC.isPending} onClick={() => resendC.mutate({ id: sub.id })}>{px("Reenviar confirmación")}</Button>}
                {sub.status === "active" && !sub.welcomeSentAt && <Button size="sm" variant="outline" disabled={resendW.isPending} onClick={() => resendW.mutate({ id: sub.id })}>{px("Reenviar bienvenida")}</Button>}
                {sub.status === "active" && sub.crmSyncError && <Button size="sm" variant="outline" disabled={crm.isPending} onClick={() => crm.mutate({ id: sub.id })}>{px("Reintentar enlace con CRM")}</Button>}
                {sub.status !== "unsubscribed" && <Button size="sm" variant="destructive" onClick={() => setConfirmOff(true)}>{px("Dar de baja")}</Button>}
              </div>
              <section>
                <h3 className="mb-2 font-medium text-foreground">{px("Historial de consentimiento")}</h3>
                <ul className="space-y-2">
                  {d.events.map((e) => (
                    <li key={e.id} className="rounded-md border border-border p-2">
                      <div className="flex justify-between gap-2"><span className="font-medium">{ACTION[e.action] ? px(ACTION[e.action]) : e.action}</span><span className="text-xs text-muted-foreground">{fmt(e.at)}</span></div>
                      <p className="text-xs text-muted-foreground">{e.actor}{e.detail ? ` · ${e.detail}` : ""}</p>
                    </li>
                  ))}
                  {!d.events.length && <li className="text-muted-foreground">{px("Sin eventos.")}</li>}
                </ul>
              </section>
              <section>
                <h3 className="mb-2 font-medium text-foreground">{px("Registro de correos y errores de envío")}</h3>
                <ul className="space-y-2">
                  {d.mails.map((m) => (
                    <li key={m.id} className="rounded-md border border-border p-2">
                      <div className="flex justify-between gap-2"><span>{MAIL_KIND[m.kind] ? px(MAIL_KIND[m.kind]) : m.kind} · {MAIL_STATUS[m.status] ? px(MAIL_STATUS[m.status]) : m.status}</span><span className="text-xs text-muted-foreground">{fmt(m.at)}</span></div>
                      {m.error && <p className="text-xs text-destructive">{m.error}</p>}
                    </li>
                  ))}
                  {!d.mails.length && <li className="text-muted-foreground">{px("Aún no se ha enviado ningún correo.")}</li>}
                </ul>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{px("Dar de baja a")} {sub?.email}</DialogTitle>
            <DialogDescription>{px("Dejará de recibir la newsletter y se retirará su consentimiento de marketing en el CRM. Indica el motivo: queda registrado.")}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={px("Motivo de la baja (mínimo 3 caracteres)")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOff(false)}>{px("Cancelar")}</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || off.isPending} onClick={() => sub && off.mutate({ id: sub.id, reason: reason.trim() })}>{px("Confirmar baja")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Lee un fichero del navegador: CSV como texto, Excel como base64. */
function readFile(file: File): Promise<{ format: "csv" | "xlsx"; content: string }> {
  const xlsx = /\.xlsx?$/i.test(file.name) || /spreadsheetml|ms-excel/.test(file.type);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("read"));
    r.onload = () => {
      const v = String(r.result ?? "");
      resolve(xlsx ? { format: "xlsx", content: v.replace(/^data:[^,]*,/, "") } : { format: "csv", content: v });
    };
    if (xlsx) r.readAsDataURL(file);
    else r.readAsText(file);
  });
}

function ImportDialog({ open, lists, onClose }: { open: boolean; lists: ListInfo[]; onClose: () => void }) {
  const px = usePanelText();
  const name = useListName();
  const utils = trpc.useUtils();
  const [label, setLabel] = useState("");
  const [def, setDef] = useState(lists.find((l) => l.isDefault)?.locale ?? lists[0]?.locale ?? "de");
  const [file, setFile] = useState<{ fileName: string; format: "csv" | "xlsx"; content: string } | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!lists.length) return;
    setDef((d) => (lists.some((l) => l.locale === d) ? d : (lists.find((l) => l.isDefault)?.locale ?? lists[0].locale)));
  }, [lists]);
  const preview = trpc.newsletter.importPreview.useMutation({ onError: (e) => toastError(e) });
  const apply = trpc.newsletter.importApply.useMutation({
    onSuccess: (r) => {
      toast.success(`${px("Importación registrada")}: ${r.created} ${px("creados")}, ${r.matched} ${px("coincidencias")}, ${r.rejected} ${px("rechazados")}`);
      void utils.newsletter.invalidate();
      reset();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  const reset = () => {
    setFile(null);
    setLabel("");
    preview.reset();
  };
  const canPreview = !!file && label.trim().length >= 2 && !!def;
  useEffect(() => {
    // La vista previa se recalcula al cambiar fichero, etiqueta o idioma (y la huella con ella)
    if (!canPreview || !file) return;
    const t = setTimeout(() => preview.mutate({ format: file.format, fileName: file.fileName, content: file.content, label: label.trim(), defaultLocale: def }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, label, def]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return void toast.error(px("El fichero supera los 5 MB."));
    setReading(true);
    try {
      const r = await readFile(f);
      setFile({ fileName: f.name, ...r });
    } finally {
      setReading(false);
    }
  };
  const p = preview.data;
  const counts = p?.plan.counts;
  const actions = ["create", "match_active", "match_pending", "match_unsubscribed", "match_imported", "reject"] as const;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (reset(), onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{px("Importar contactos históricos")}</DialogTitle>
          <DialogDescription>{px("Sube un CSV o Excel con una columna de correo (y, si quieres, nombre e idioma). Los contactos entran como «Histórico (sin consentimiento)»: no se les envía nada y no entran en ninguna campaña hasta que se inscriban desde la web y confirmen. Un correo que ya existe no se toca; una baja previa prevalece.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm"><span className="text-muted-foreground">{px("Etiqueta del lote")}</span><Input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="2024-newsletter-de" /></label>
          <label className="block space-y-1 text-sm"><span className="text-muted-foreground">{px("Lista por defecto (idioma)")}</span>
            <select className={selectClass} value={def} onChange={(e) => setDef(e.target.value)}>
              {lists.filter((l) => l.isPublic).map((l) => <option key={l.locale} value={l.locale}>{name(l)}</option>)}
            </select>
          </label>
          <div className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">{px("Fichero")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={reading} onClick={() => inputRef.current?.click()}><Upload className="mr-1 h-4 w-4" />{reading ? px("Leyendo el fichero…") : px("Elegir fichero (CSV o Excel)")}</Button>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
              {file && <span className="text-foreground">{file.fileName}</span>}
            </div>
          </div>
        </div>
        {preview.isPending && <PanelLoading />}
        {p && counts && (
          <div className="space-y-3 text-sm">
            <h3 className="font-medium text-foreground">{px("Vista previa")} · {px("Filas leídas")}: {counts.total}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label={px("Nuevos (históricos)")} value={counts.create} />
              <Stat label={px("Ya activos")} value={counts.match_active} />
              <Stat label={px("Ya pendientes")} value={counts.match_pending} />
              <Stat label={px("Bajas previas")} value={counts.match_unsubscribed} />
              <Stat label={px("Ya importados")} value={counts.match_imported} />
              <Stat label={px("Rechazados")} value={counts.reject} />
            </div>
            <p className="text-xs text-muted-foreground">{px("Columnas reconocidas")}: {p.plan.columns.join(", ") || "—"}{p.plan.ignored.length ? ` · ${px("Columnas ignoradas")}: ${p.plan.ignored.join(", ")}` : ""}</p>
            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader><TableRow><TableHead>{px("Fila")}</TableHead><TableHead>Email</TableHead><TableHead>{px("Nombre")}</TableHead><TableHead>{px("Idioma")}</TableHead><TableHead>{px("Acción")}</TableHead><TableHead>{px("Motivo")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {actions.flatMap((a) => p.sample[a].map((r) => (
                    <TableRow key={`${a}-${r.line}`}>
                      <TableCell>{r.line}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{r.email ?? "—"}</TableCell>
                      <TableCell className="max-w-[160px] truncate">{r.name ?? ""}</TableCell>
                      <TableCell>{r.locale ?? ""}</TableCell>
                      <TableCell><Badge variant={a === "create" ? "default" : a === "reject" ? "destructive" : "outline"}>{px(IMPORT_ACTION[a])}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.reason ?? ""}</TableCell>
                    </TableRow>
                  )))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">{px("Primeras 50 filas por acción.")} {px("En esta fase no se envía ningún correo a los contactos importados.")}</p>
          </div>
        )}
        {!p && !preview.isPending && <p className="text-xs text-muted-foreground">{px("Elige un fichero y espera la vista previa antes de importar.")}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => (reset(), onClose())}>{px("Cerrar")}</Button>
          <Button disabled={!p || !file || apply.isPending || preview.isPending} onClick={() => p && file && apply.mutate({ format: file.format, fileName: file.fileName, content: file.content, label: label.trim(), defaultLocale: def, fingerprint: p.fingerprint })}>
            {apply.isPending ? px("Importando…") : px("Importar sin enviar correos")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Imports({ lists }: { lists: ListInfo[] }) {
  const px = usePanelText();
  const fmt = useFmt();
  const [open, setOpen] = useState(false);
  const q = trpc.newsletter.imports.useQuery(undefined, { retry: false });
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h3 className="font-medium text-foreground">{px("Importar contactos históricos")}</h3>
            <p className="text-xs text-muted-foreground">{px("En esta fase no se envía ningún correo a los contactos importados.")}</p>
          </div>
          <Button onClick={() => setOpen(true)}><Upload className="mr-1 h-4 w-4" />{px("Importar")}</Button>
        </CardContent>
      </Card>
      {q.isLoading ? <PanelLoading /> : q.error ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <PanelEmpty icon={<Upload className="h-5 w-5" />} title={px("Lotes importados")} description={px("Aún no se ha importado ningún lote.")} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>{px("Etiqueta del lote")}</TableHead><TableHead>{px("Fichero")}</TableHead><TableHead>{px("Idioma por defecto")}</TableHead><TableHead>{px("Filas leídas")}</TableHead><TableHead>{px("Nuevos (históricos)")}</TableHead><TableHead>{px("Coincidencia")}</TableHead><TableHead>{px("Rechazados")}</TableHead><TableHead>{px("Importado el")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {q.data.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.id}</TableCell><TableCell>{b.label}</TableCell><TableCell className="max-w-[200px] truncate">{b.fileName}</TableCell><TableCell>{b.defaultLocale}</TableCell>
                    <TableCell>{b.rowCount}</TableCell><TableCell>{b.createdCount}</TableCell><TableCell>{b.matchedCount}</TableCell><TableCell>{b.rejectedCount}</TableCell><TableCell className="whitespace-nowrap">{fmt(b.createdAt)} · {b.actor}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <ImportDialog open={open} lists={lists} onClose={() => setOpen(false)} />
    </div>
  );
}

function List({ lists }: { lists: ListInfo[] }) {
  const px = usePanelText();
  const fmt = useFmt();
  const name = useListName();
  const localeName = useLocaleName();
  const [qText, setQText] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | Status>("");
  const [locale, setLocale] = useState("");
  const [source, setSource] = useState("");
  const [dateField, setDateField] = useState<DateField>("createdAt");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => (setQ(qText.trim()), setPage(1)), 350);
    return () => clearTimeout(t);
  }, [qText]);
  const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
  const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;
  const filters = useMemo(() => ({ q: q || undefined, status: status || undefined, locale: locale || undefined, source: source || undefined, dateField, from: fromMs, to: toMs }), [q, status, locale, source, dateField, fromMs, toMs]);
  const list = trpc.newsletter.list.useQuery({ ...filters, sort, dir, page, pageSize }, { retry: false, placeholderData: (p) => p });
  const d = list.data;
  const exportUrl = (format: "xlsx" | "csv") => exportHref(format, { ...filters, list: locale ? `newsletter-${locale}` : undefined });
  const th = (key: SortKey, label: string) => (
    <TableHead>
      <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => (sort === key ? setDir(dir === "asc" ? "desc" : "asc") : (setSort(key), setDir("asc")), setPage(1))}>
        {label}
        {sort === key ? (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  );
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));
  const total = d?.total ?? 0;
  const a = total ? (page - 1) * pageSize + 1 : 0;
  const b = Math.min(total, page * pageSize);
  const localeOptions = useMemo(() => {
    const out = lists.map((l) => l.locale);
    for (const l of d?.facets.locales ?? []) if (!out.includes(l)) out.push(l);
    return out;
  }, [lists, d?.facets.locales]);
  const listOf = (l: string) => lists.find((x) => x.locale === l);
  const localeLabel = (l: string) => (listOf(l) ? name(listOf(l)) : localeName(l));
  return (
    <div className="space-y-4">
      <Stats />
      <Lists onView={(l) => (setLocale(l), setStatus(""), setPage(1))} />
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder={px("Buscar por email o nombre")} value={qText} onChange={(e) => setQText(e.target.value)} aria-label={px("Buscar por email o nombre")} />
            </div>
            <select className={selectClass} value={status} onChange={(e) => reset(setStatus)(e.target.value as "" | Status)} aria-label={px("Estado")}>
              <option value="">{px("Todos los estados")}</option>
              <option value="pending">{px("Pendiente")}</option><option value="active">{px("Activo")}</option><option value="unsubscribed">{px("Baja")}</option><option value="imported">{px("Histórico (sin consentimiento)")}</option>
            </select>
            <select className={selectClass} value={locale} onChange={(e) => reset(setLocale)(e.target.value)} aria-label={px("Idioma")}>
              <option value="">{px("Todas las listas")}</option>
              {localeOptions.map((l) => <option key={l} value={l}>{localeLabel(l)}</option>)}
            </select>
            <select className={selectClass} value={source} onChange={(e) => reset(setSource)(e.target.value)} aria-label={px("Origen")}>
              <option value="">{px("Todos los orígenes")}</option>
              {(d?.facets.sources ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={selectClass} value={dateField} onChange={(e) => reset(setDateField)(e.target.value as DateField)} aria-label={px("Campo de fecha")}>
              <option value="createdAt">{px("Fecha de inscripción")}</option><option value="confirmedAt">{px("Fecha de confirmación")}</option><option value="unsubscribedAt">{px("Fecha de baja")}</option>
            </select>
            <Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} aria-label={px("Desde")} />
            <Input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} aria-label={px("Hasta")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm"><a href={exportUrl("xlsx")} download><Download className="mr-1 h-4 w-4" />{px("Exportar Excel (.xlsx)")}</a></Button>
            <Button asChild variant="outline" size="sm"><a href={exportUrl("csv")} download><Download className="mr-1 h-4 w-4" />{px("Exportar CSV (.csv)")}</a></Button>
            <span className="text-xs text-muted-foreground">{px("Exporta todos los registros del filtro, no solo la página visible.")}</span>
          </div>
        </CardContent>
      </Card>
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : !d?.rows.length ? (
        <PanelEmpty icon={<Mail className="h-5 w-5" />} title={px("Sin suscriptores")} description={px("Cuando alguien se inscriba desde el formulario de la web y confirme su correo, aparecerá aquí.")} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {th("email", "Email")}<TableHead>{px("Nombre")}</TableHead>{th("status", px("Estado"))}{th("locale", px("Idioma"))}<TableHead>{px("Idioma de alta")}</TableHead>{th("source", px("Origen"))}{th("createdAt", px("Inscripción"))}{th("confirmedAt", px("Confirmación"))}
                  <TableHead>{px("Baja")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                    <TableCell className="max-w-[220px] truncate font-medium">{r.email}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{r.name ?? ""}</TableCell>
                    <TableCell><Badge variant={STATUS[r.status as Status].variant}>{px(STATUS[r.status as Status].label)}</Badge></TableCell>
                    <TableCell>{localeLabel(r.locale)}</TableCell>
                    <TableCell>{r.signupLocale ? localeLabel(r.signupLocale) : "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{r.source}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(r.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(r.confirmedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(r.unsubscribedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-sm">
              <span className="text-muted-foreground">{px("Mostrando")} {a}–{b} {px("de")} {total}</span>
              <div className="flex items-center gap-2">
                <select className={`${selectClass} w-auto`} value={pageSize} onChange={(e) => (setPageSize(Number(e.target.value)), setPage(1))} aria-label={px("Filas por página")}>
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{n} {px("por página")}</option>)}
                </select>
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{px("Anterior")}</Button>
                <Button size="sm" variant="outline" disabled={b >= total} onClick={() => setPage(page + 1)}>{px("Siguiente")}</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <Detail id={open} lists={lists} onClose={() => setOpen(null)} />
    </div>
  );
}

type Tpl = { subject: string; body: string };
function Settings() {
  const px = usePanelText();
  const utils = trpc.useUtils();
  const q = trpc.newsletter.getConfig.useQuery(undefined, { retry: false });
  const [enabled, setEnabled] = useState(false);
  const [pub, setPub] = useState(true);
  const [welcome, setWelcome] = useState<Record<string, Tpl>>({});
  const [confirm, setConfirm] = useState<Record<string, Tpl>>({});
  const [loc, setLoc] = useState<(typeof TEMPLATE_LOCALES)[number]>("de");
  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled);
    setPub(q.data.publicEnabled);
    setWelcome(q.data.welcome as Record<string, Tpl>);
    setConfirm(q.data.confirm as Record<string, Tpl>);
  }, [q.data]);
  const save = trpc.newsletter.saveConfig.useMutation({ onSuccess: () => (toast.success(px("Ajustes guardados")), void utils.newsletter.invalidate()), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const editor = (title: string, state: Record<string, Tpl>, set: (v: Record<string, Tpl>) => void) => {
    const t = state[loc] ?? { subject: "", body: "" };
    const upd = (p: Partial<Tpl>) => set({ ...state, [loc]: { ...t, ...p } });
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="font-medium text-foreground">{title}</h3>
          <Input value={t.subject} maxLength={200} onChange={(e) => upd({ subject: e.target.value })} aria-label={`${px("Asunto")} (${title})`} placeholder={px("Asunto")} />
          <Textarea value={t.body} rows={10} maxLength={6000} onChange={(e) => upd({ body: e.target.value })} aria-label={`${px("Cuerpo")} (${title})`} />
        </CardContent>
      </Card>
    );
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <label className="flex items-center justify-between gap-3"><span><span className="font-medium text-foreground">{px("Módulo activo")}</span><span className="block text-sm text-muted-foreground">{px("Muestra la sección Newsletter en el menú.")}</span></span><Switch checked={enabled} onCheckedChange={setEnabled} /></label>
          <label className="flex items-center justify-between gap-3"><span><span className="font-medium text-foreground">{px("Inscripción pública")}</span><span className="block text-sm text-muted-foreground">{px("Permite que el formulario de la web acepte inscripciones.")}</span></span><Switch checked={pub} onCheckedChange={setPub} /></label>
          <p className="text-sm text-muted-foreground">{px("El remitente es el autorizado de la empresa (Ajustes › Correo).")}</p>
        </CardContent>
      </Card>
      <div className="flex gap-2">
        {TEMPLATE_LOCALES.map((l) => <Button key={l} size="sm" variant={loc === l ? "default" : "outline"} onClick={() => setLoc(l)}>{px(LOCALE_LABEL[l])}</Button>)}
      </div>
      {editor(px("Correo de bienvenida"), welcome, setWelcome)}
      {editor(px("Correo de confirmación"), confirm, setConfirm)}
      <p className="text-sm text-muted-foreground">{px("Texto sin formato: separa los párrafos con una línea en blanco. El pie con el enlace de baja y los datos de identificación se añade solo.")}{q.data?.identity.legalLine ? ` ${px("Datos de identificación:")} ${q.data.identity.legalLine}` : ""}</p>
      <Button disabled={save.isPending} onClick={() => save.mutate({ enabled, publicEnabled: pub, welcome: welcome as never, confirm: confirm as never })}>{px("Guardar ajustes")}</Button>
    </div>
  );
}

function Body() {
  const px = usePanelText();
  const utils = trpc.useUtils();
  const status = trpc.newsletter.status.useQuery(undefined, { retry: false });
  const lists = trpc.newsletter.lists.useQuery(undefined, { retry: false, enabled: !!status.data?.enabled });
  const enable = trpc.newsletter.saveConfig.useMutation({ onSuccess: () => (toast.success(px("Módulo activado")), void utils.newsletter.invalidate()), onError: (e) => toastError(e) });
  if (status.isLoading) return <PanelLoading />;
  if (status.error) return <PanelError error={status.error} onRetry={() => status.refetch()} />;
  const listRows = lists.data ?? [];
  return (
    <div className="space-y-4">
      {!status.data?.enabled && (
        <PanelEmpty icon={<Mail className="h-5 w-5" />} title={px("Módulo no activado")} description={px("La newsletter no está activada en esta empresa. Al activarla, el formulario público de la web podrá recibir inscripciones.")}>
          <Button disabled={enable.isPending} onClick={() => enable.mutate({ enabled: true })}>{px("Activar la newsletter")}</Button>
        </PanelEmpty>
      )}
      <Tabs defaultValue="suscriptores">
        <TabsList>
          <TabsTrigger value="suscriptores">{px("Suscriptores")}</TabsTrigger>
          <TabsTrigger value="importacion">{px("Importar")}</TabsTrigger>
          <TabsTrigger value="ajustes">{px("Ajustes")}</TabsTrigger>
        </TabsList>
        <TabsContent value="suscriptores" className="mt-4"><List lists={listRows} /></TabsContent>
        <TabsContent value="importacion" className="mt-4"><Imports lists={listRows} /></TabsContent>
        <TabsContent value="ajustes" className="mt-4"><Settings /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function NewsletterSuscriptores() {
  const px = usePanelText();
  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <PanelPageHeader icon={<Mail />} title={px("Newsletter · Suscriptores")} description={px("Personas que han pedido recibir tu newsletter, con su consentimiento demostrable. Solo reciben correos quienes confirmaron su inscripción.")} />
        <Body />
      </div>
    </AdminLayout>
  );
}
