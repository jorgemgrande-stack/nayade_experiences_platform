/**
 * Newsletter · Suscriptores (/admin/newsletter/suscriptores): cifras, listado con filtros, ficha con historial de
 * consentimiento y errores de envío, exportación a Excel/CSV y ajustes de los correos. La autorización real la aplica el
 * servidor (rol de administrador). Nadie «activa» a un suscriptor desde aquí: solo la persona, confirmando su correo.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Mail, Search } from "lucide-react";
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
import { usePanelTag, usePanelText } from "@/i18n/usePanelText";

type Status = "pending" | "active" | "unsubscribed";
type SortKey = "createdAt" | "email" | "confirmedAt" | "status" | "locale" | "source";
type DateField = "createdAt" | "confirmedAt" | "unsubscribedAt";
const LOCALES = ["de", "es", "en"] as const;
const LOCALE_LABEL: Record<string, string> = { de: "Alemán", es: "Español", en: "Inglés" };
const STATUS: Record<Status, { label: string; variant: "default" | "secondary" | "outline" }> = {
  pending: { label: "Pendiente", variant: "secondary" },
  active: { label: "Activo", variant: "default" },
  unsubscribed: { label: "Baja", variant: "outline" },
};
const ACTION: Record<string, string> = {
  requested: "Solicitud",
  confirmed: "Confirmada",
  unsubscribed: "Baja (enlace)",
  admin_unsubscribed: "Baja administrativa",
  resubscribe_requested: "Nueva solicitud tras baja",
  confirmation_resent: "Confirmación reenviada",
  welcome_sent: "Bienvenida enviada",
  updated: "Datos actualizados",
  crm_resync: "Sincronización CRM",
};
const MAIL_KIND: Record<string, string> = { confirm: "Confirmación", welcome: "Bienvenida" };
const MAIL_STATUS: Record<string, string> = { sending: "Enviando", sent: "Enviado", failed: "Fallido" };
function useFmt() {
  const tag = usePanelTag();
  return (ms: number | null | undefined) => (ms ? new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" }).format(new Date(ms)) : "—");
}
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label={px("Suscriptores activos")} value={s?.active ?? "—"} hint={s ? `${s.total} ${px("en total")}` : undefined} />
      <Stat label={px("Altas recientes")} value={s ? s.joined7d : "—"} hint={s ? `${s.joined30d} ${px("en los últimos 30 días")}` : px("Últimos 7 días")} />
      <Stat label={px("Pendientes de confirmar")} value={s?.pending ?? "—"} />
      <Stat label={px("Bajas")} value={s?.unsubscribed ?? "—"} hint={s ? `${s.left30d} ${px("en los últimos 30 días")}` : undefined} />
    </div>
  );
}

function Detail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const px = usePanelText();
  const fmt = useFmt();
  const utils = trpc.useUtils();
  const q = trpc.newsletter.get.useQuery({ id: id ?? 0 }, { enabled: id != null, retry: false });
  const [reason, setReason] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const refresh = () => {
    void utils.newsletter.get.invalidate();
    void utils.newsletter.list.invalidate();
    void utils.newsletter.stats.invalidate();
  };
  const ok = (msg: string) => () => (toast.success(msg), refresh());
  const locale = trpc.newsletter.updateLocale.useMutation({ onSuccess: ok(px("Idioma actualizado")), onError: (e) => toastError(e) });
  const resendC = trpc.newsletter.resendConfirmation.useMutation({ onSuccess: (r) => (r.sent ? toast.success(px("Confirmación reenviada")) : toast.error(px("El correo no salió: revisa el registro de envíos")), refresh()), onError: (e) => toastError(e) });
  const resendW = trpc.newsletter.resendWelcome.useMutation({ onSuccess: (r) => (r.sent ? toast.success(px("Bienvenida enviada")) : toast.error(`${px("No se envió")} (${r.reason ?? px("sin motivo")})`), refresh()), onError: (e) => toastError(e) });
  const crm = trpc.newsletter.retryCrm.useMutation({ onSuccess: ok(px("Enlace con el CRM reintentado")), onError: (e) => toastError(e) });
  const off = trpc.newsletter.unsubscribe.useMutation({ onSuccess: () => (toast.success(px("Baja registrada")), setConfirmOff(false), setReason(""), refresh()), onError: (e) => toastError(e) });
  const d = q.data;
  const sub = d?.subscriber;
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
              {sub.crmSyncError && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">CRM: {sub.crmSyncError}</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">{px("Inscripción")}</dt><dd>{fmt(sub.createdAt)}</dd>
                <dt className="text-muted-foreground">{px("Confirmación")}</dt><dd>{fmt(sub.confirmedAt)}</dd>
                <dt className="text-muted-foreground">{px("Baja")}</dt><dd>{fmt(sub.unsubscribedAt)}</dd>
                <dt className="text-muted-foreground">{px("Bienvenida")}</dt><dd>{fmt(sub.welcomeSentAt)}</dd>
                <dt className="text-muted-foreground">{px("Cliente del CRM")}</dt><dd>{sub.clientId ?? "—"}</dd>
                <dt className="text-muted-foreground">{px("Idioma")}</dt>
                <dd>
                  <select className={selectClass} value={sub.locale} disabled={locale.isPending} onChange={(e) => locale.mutate({ id: sub.id, locale: e.target.value as (typeof LOCALES)[number] })} aria-label={px("Idioma")}>
                    {LOCALES.map((l) => <option key={l} value={l}>{px(LOCALE_LABEL[l])}</option>)}
                  </select>
                </dd>
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

function List() {
  const px = usePanelText();
  const fmt = useFmt();
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
  const exportUrl = (format: "xlsx" | "csv") => {
    const p = new URLSearchParams({ format });
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/api/newsletter/export?${p.toString()}`;
  };
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
  return (
    <div className="space-y-4">
      <Stats />
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder={px("Buscar por email")} value={qText} onChange={(e) => setQText(e.target.value)} aria-label={px("Buscar por email")} />
            </div>
            <select className={selectClass} value={status} onChange={(e) => reset(setStatus)(e.target.value as "" | Status)} aria-label={px("Estado")}>
              <option value="">{px("Todos los estados")}</option>
              <option value="pending">{px("Pendiente")}</option><option value="active">{px("Activo")}</option><option value="unsubscribed">{px("Baja")}</option>
            </select>
            <select className={selectClass} value={locale} onChange={(e) => reset(setLocale)(e.target.value)} aria-label={px("Idioma")}>
              <option value="">{px("Todos los idiomas")}</option>
              {(d?.facets.locales ?? []).map((l) => <option key={l} value={l}>{LOCALE_LABEL[l] ? px(LOCALE_LABEL[l]) : l}</option>)}
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
                  {th("email", "Email")}{th("status", px("Estado"))}{th("locale", px("Idioma"))}{th("source", px("Origen"))}{th("createdAt", px("Inscripción"))}{th("confirmedAt", px("Confirmación"))}
                  <TableHead>{px("Baja")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                    <TableCell className="max-w-[220px] truncate font-medium">{r.email}</TableCell>
                    <TableCell><Badge variant={STATUS[r.status as Status].variant}>{px(STATUS[r.status as Status].label)}</Badge></TableCell>
                    <TableCell>{LOCALE_LABEL[r.locale] ? px(LOCALE_LABEL[r.locale]) : r.locale}</TableCell>
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
      <Detail id={open} onClose={() => setOpen(null)} />
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
  const [loc, setLoc] = useState<(typeof LOCALES)[number]>("de");
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
        {LOCALES.map((l) => <Button key={l} size="sm" variant={loc === l ? "default" : "outline"} onClick={() => setLoc(l)}>{px(LOCALE_LABEL[l])}</Button>)}
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
  const enable = trpc.newsletter.saveConfig.useMutation({ onSuccess: () => (toast.success(px("Módulo activado")), void utils.newsletter.invalidate()), onError: (e) => toastError(e) });
  if (status.isLoading) return <PanelLoading />;
  if (status.error) return <PanelError error={status.error} onRetry={() => status.refetch()} />;
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
          <TabsTrigger value="ajustes">{px("Ajustes")}</TabsTrigger>
        </TabsList>
        <TabsContent value="suscriptores" className="mt-4"><List /></TabsContent>
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
