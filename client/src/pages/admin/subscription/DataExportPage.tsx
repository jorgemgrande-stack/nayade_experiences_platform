/**
 * Exportación de los datos de la empresa (dataExport.*): solicitar, seguir y descargar el ZIP (CSV, JSON y ficheros).
 * Solo la persona propietaria; disponible en prueba, activa, suspendida y solo lectura. La autorización real está
 * en el servidor: aquí solo se presenta. La descarga usa un enlace firmado que se pide en el momento (nunca se guarda).
 */
import { Link } from "wouter";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Download, FileArchive, Info, Lock, XCircle } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { trpc } from "@/lib/trpc";

const fmtDateTime = (ms: number) => new Date(ms).toLocaleString("es-ES", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024)).toLocaleString("es-ES")} KB`);
const fmtNum = (n: number | null) => (n ?? 0).toLocaleString("es-ES");

/** Aviso según el estado de la cuenta: la exportación sigue disponible en solo lectura y suspendida. */
function AccountNotice() {
  const sub = usePanelSubscription();
  const d = sub.data;
  if (!d || d.licensing !== "capabilities") return null;
  const readOnlyUntil = d.capabilities.filter((c) => (c.status === "read_only" || c.status === "expired") && c.validUntil).map((c) => c.validUntil as number);
  const until = readOnlyUntil.length ? Math.min(...readOnlyUntil) : null;
  let text: string | null = null;
  if (d.state === "trial") text = "Estás en la prueba gratuita: puedes exportar tus datos cuando quieras.";
  else if (d.state === "trial_expired") text = "Tu prueba ha terminado y la cuenta está en solo lectura: puedes seguir exportando tus datos.";
  else if (d.state === "read_only") text = until ? `Tu cuenta está en solo lectura hasta el ${fmtDate(until)}: hasta entonces puedes consultar y exportar tus datos.` : "Tu cuenta está en solo lectura: puedes consultar y exportar tus datos.";
  else if (d.state === "suspended") text = "Tu suscripción está suspendida: el panel sigue disponible para consultar y exportar tus datos.";
  else if (d.state === "cancelled" || d.state === "none")
    text = "El periodo de solo lectura ha terminado. Puedes seguir exportando tus datos mientras la cuenta no se archive: te recomendamos descargarlos cuanto antes.";
  if (!text) return null;
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 p-4 flex gap-3" role="status">
      <Info className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-sm text-amber-900 dark:text-amber-100">{text}</p>
    </div>
  );
}

function Contents({ maxMb, linkHours, dailyLimit }: { maxMb: number; linkHours: number; dailyLimit: number }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4" aria-labelledby="exp-contents">
      <h2 id="exp-contents" className="font-semibold text-foreground">Qué incluye y qué no</h2>
      <div className="grid gap-5 md:grid-cols-2 text-sm">
        <div>
          <h3 className="font-medium text-foreground mb-2">Incluye</h3>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Todas las tablas de la base de datos de tu empresa (clientes, reservas, ventas, facturas, productos, ajustes…), cada una en CSV y en JSON.</li>
            <li>Los ficheros guardados en la plataforma: facturas, documentos, imágenes y adjuntos.</li>
            <li>Un índice (<code>manifest.json</code>) con cada tabla, sus filas, las columnas omitidas y cada fichero, y un <code>LEEME.txt</code>.</li>
          </ul>
        </div>
        <div>
          <h3 className="font-medium text-foreground mb-2">No incluye</h3>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Contraseñas, tokens, claves y credenciales de integraciones, ni las sesiones (por seguridad). En los ajustes, los valores sensibles aparecen como omitidos.</li>
            <li>La cola técnica de envío de correos y los registros técnicos de webhooks.</li>
            <li>Ficheros alojados fuera de la plataforma: solo su dirección, tal como está en tus datos.</li>
            <li>La documentación de tu relación con Elephant Source (ver abajo): se entrega aparte, a petición.</li>
          </ul>
        </div>
      </div>
      <ul className="text-xs text-muted-foreground space-y-1">
        <li>Se genera en segundo plano con una copia coherente de tus datos en ese momento. Puedes solicitar hasta {dailyLimit} al día.</li>
        <li>Tamaño máximo: {maxMb.toLocaleString("es-ES")} MB sin comprimir. Si tus datos lo superan, la exportación no se genera y te lo indicamos: pídela a soporte y la prepararemos por el procedimiento de exportaciones grandes.</li>
        <li>El enlace de descarga caduca {linkHours} horas después de generarse; el archivo se retira a los 7 días (tus datos no se tocan). Después, solicita una nueva. Cada descarga queda registrada.</li>
        <li>Los documentos fiscales se exportan como copia: el original legal es el emitido por el sistema de facturación.</li>
      </ul>
    </section>
  );
}

/** Documentación de la relación con Elephant Source: fuera del ZIP, a petición y con procedimiento verificable. */
function Relationship() {
  const contact = trpc.subscription.supportContact.useQuery(undefined, { retry: false, staleTime: 300_000 });
  const email = contact.data?.email ?? null;
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="exp-rel">
      <h2 id="exp-rel" className="font-semibold text-foreground">Documentación de tu relación con Elephant Source</h2>
      <p className="text-sm text-muted-foreground">
        No forma parte de la exportación anterior porque no está en los datos de tu empresa, sino en nuestros sistemas. La entregamos a petición de la persona propietaria:
      </p>
      <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
        <li>Contrato, pedidos y plan contratado.</li>
        <li>Facturas de la suscripción (las emitidas a través de Stripe; también te llegan por correo al cobrarse).</li>
        <li>Tickets de soporte con los mensajes que intercambiamos contigo.</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Escribe desde el correo de la persona propietaria a{" "}
        {email ? <strong className="text-foreground select-all">{email}</strong> : "tu contacto de soporte"} con el asunto «Documentación contractual». Comprobaremos que la petición viene de la persona propietaria y te la enviaremos en un plazo máximo de 5 días hábiles, dejando constancia de la entrega.
      </p>
    </section>
  );
}

type ExportRow = {
  id: number;
  status: "pending" | "ready" | "failed";
  sizeBytes: number | null;
  tableCount: number | null;
  rowCount: number | null;
  fileCount: number | null;
  error: string | null;
  warning: string | null;
  requestedAt: number;
  completedAt: number | null;
  expiresAt: number | null;
  downloadCount: number;
  startedAt?: number | null;
  attempts?: number;
  purgedAt?: number | null;
};

function StatusBadge({ row, now }: { row: ExportRow; now: number }) {
  if (row.status === "pending") return <Badge variant="outline" className="gap-1"><Clock className="w-3.5 h-3.5" aria-hidden="true" />{row.startedAt ? (row.attempts && row.attempts > 1 ? "Generando (reintento)…" : "Generando…") : "En cola"}</Badge>;
  if (row.status === "failed") return <Badge variant="outline" className="gap-1 text-red-800 dark:text-red-300"><XCircle className="w-3.5 h-3.5" aria-hidden="true" />Fallida</Badge>;
  if (row.purgedAt) return <Badge variant="outline">Archivo retirado</Badge>;
  if (row.expiresAt && row.expiresAt <= now) return <Badge variant="outline">Enlace caducado</Badge>;
  if (row.warning) return <Badge variant="outline" className="gap-1 text-amber-800 dark:text-amber-300"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />Lista, incompleta</Badge>;
  return <Badge variant="outline" className="gap-1 text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />Lista</Badge>;
}

function History({ rows }: { rows: ExportRow[] }) {
  const utils = trpc.useUtils();
  const now = Date.now();
  const link = trpc.dataExport.link.useMutation({
    onSuccess: (r) => {
      utils.dataExport.list.invalidate();
      window.location.assign(r.url);
    },
    onError: (e) => toast.error(e.message),
  });
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Todavía no has solicitado ninguna exportación.</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const downloadable = r.status === "ready" && !!r.expiresAt && r.expiresAt > now;
        return (
          <li key={r.id} className="py-4 flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">Solicitada el {fmtDateTime(r.requestedAt)}</span>
                <StatusBadge row={r} now={now} />
              </div>
              {r.status === "ready" && (
                <p className="text-sm text-muted-foreground">
                  {fmtNum(r.tableCount)} tablas ({fmtNum(r.rowCount)} filas) y {fmtNum(r.fileCount)} ficheros{r.sizeBytes ? ` · ${fmtSize(r.sizeBytes)}` : ""}
                  {r.expiresAt && (r.expiresAt > now ? ` · descargable hasta el ${fmtDateTime(r.expiresAt)}` : " · solicita una nueva para descargarla")}
                  {r.downloadCount > 0 && ` · descargada ${r.downloadCount} ${r.downloadCount === 1 ? "vez" : "veces"}`}
                </p>
              )}
              {r.warning && <p className="text-sm text-amber-800 dark:text-amber-300">{r.warning}</p>}
              {r.status === "failed" && r.error && <p className="text-sm text-red-800 dark:text-red-300">{r.error}</p>}
            </div>
            {downloadable && (
              <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={link.isPending} onClick={() => link.mutate({ id: r.id })}>
                <Download className="w-4 h-4 mr-1.5" aria-hidden="true" />
                Descargar ZIP
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function OwnerArea({ maxMb, linkHours, dailyLimit }: { maxMb: number; linkHours: number; dailyLimit: number }) {
  const utils = trpc.useUtils();
  const list = trpc.dataExport.list.useQuery(undefined, {
    // Mientras se genera, se consulta cada pocos segundos
    refetchInterval: (q) => ((q.state.data as ExportRow[] | undefined)?.some((r) => r.status === "pending") ? 4000 : false),
    refetchOnWindowFocus: true,
  });
  const request = trpc.dataExport.request.useMutation({
    onSuccess: () => {
      toast.success("Exportación solicitada. Te avisaremos por correo cuando esté lista.");
      utils.dataExport.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = (list.data ?? []) as ExportRow[];
  const pending = rows.some((r) => r.status === "pending");
  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4" aria-labelledby="exp-request">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 id="exp-request" className="font-semibold text-foreground">Nueva exportación</h2>
            <p className="text-sm text-muted-foreground">
              Se genera en segundo plano con los datos de este momento. Recibirás un correo cuando esté lista (o si falla); el correo no incluye el enlace de descarga: se descarga desde aquí.
            </p>
          </div>
          <Button type="button" disabled={pending || request.isPending || list.isLoading} onClick={() => request.mutate()} className="shrink-0">
            <FileArchive className="w-4 h-4 mr-1.5" aria-hidden="true" />
            {pending ? "En curso…" : "Solicitar exportación"}
          </Button>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby="exp-history">
        <h2 id="exp-history" className="font-semibold text-foreground mb-2">Tus exportaciones</h2>
        {list.isLoading && <PanelLoading label="Cargando tus exportaciones…" />}
        {list.isError && <PanelError error={list.error} onRetry={() => list.refetch()} title={list.error.message || "No se han podido cargar tus exportaciones"} />}
        {list.data && <History rows={rows} />}
      </section>
      <Contents maxMb={maxMb} linkHours={linkHours} dailyLimit={dailyLimit} />
      <Relationship />
    </>
  );
}

export default function DataExportPage() {
  const status = trpc.dataExport.status.useQuery(undefined, { retry: 1, refetchOnWindowFocus: false });
  const s = status.data;
  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <Link href="/admin/suscripcion" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Suscripción
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Exportar los datos de tu empresa</h1>
          <p className="text-sm text-muted-foreground">Una copia de tus datos y ficheros en un ZIP con CSV (para hojas de cálculo) y JSON (para otros sistemas).</p>
        </div>

        <AccountNotice />

        {status.isLoading && <PanelLoading label="Comprobando tu acceso…" />}
        {status.isError && <PanelError error={status.error} onRetry={() => status.refetch()} title="No se ha podido comprobar tu acceso" />}

        {s && !s.canExport && (
          <section className="rounded-2xl border border-border bg-card p-6 flex gap-3" aria-labelledby="exp-denied">
            <Lock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 id="exp-denied" className="font-semibold text-foreground">Solo la persona propietaria puede exportar</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {s.ownerConfigured
                  ? `La exportación contiene todos los datos de la empresa, así que solo puede solicitarla y descargarla la persona propietaria${s.owner ? ` (${s.owner})` : ""}.`
                  : "Tu empresa aún no tiene registrada a la persona propietaria. Contacta con soporte para configurarla."}
              </p>
            </div>
          </section>
        )}

        {s && s.canExport && <OwnerArea maxMb={s.maxMb} linkHours={s.linkHours} dailyLimit={s.dailyLimit} />}
        {s && !s.canExport && <Contents maxMb={s.maxMb} linkHours={s.linkHours} dailyLimit={s.dailyLimit} />}
      </div>
    </AdminLayout>
  );
}
