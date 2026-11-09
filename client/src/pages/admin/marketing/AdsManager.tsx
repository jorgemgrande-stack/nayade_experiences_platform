/**
 * Elephant Connect · Ads Manager (/admin/marketing/ads): inversión y resultados de las campañas de Meta Ads y Google
 * Ads en un solo panel, medidos con las ventas reales de la empresa (reservas del Core). Importación diaria con las
 * credenciales propias de la empresa o, sin ellas, con los CSV de los informes de cada plataforma. Solo lectura en las
 * plataformas: nunca crea ni modifica campañas. La autorización real (licencia `ads-manager` y administración) la
 * aplica el servidor.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Info, Megaphone, RefreshCw, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { ADS_ERROR_LABELS, ADS_PLATFORMS, ADS_PLATFORM_LABELS, ADS_PLATFORM_SHORT, type AdsErrorKind, type AdsPlatform } from "@shared/adsManager";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const ellipsis = "overflow-hidden text-ellipsis whitespace-nowrap";
const NONE = "—";
const eur = (c: number | null | undefined) => (c == null ? NONE : (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
const int = (n: number | null | undefined) => (n == null ? NONE : Math.round(n).toLocaleString("es-ES"));
const dec = (n: number | null | undefined) => (n == null ? NONE : n.toLocaleString("es-ES", { maximumFractionDigits: 2 }));
const pct = (r: number | null | undefined) => (r == null ? NONE : `${(r * 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`);
const roas = (r: number | null | undefined) => (r == null ? NONE : `${r.toLocaleString("es-ES", { maximumFractionDigits: 2 })}×`);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : NONE);
const SEVERITY: Record<string, "destructive" | "secondary" | "outline"> = { alta: "destructive", media: "secondary", info: "outline" };

/** Texto de un archivo: los informes de Google Ads suelen venir en UTF-16; los de Meta, en UTF-8. */
async function readCsvFile(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 3 && buf[1] === 0 && buf[3] === 0)) return new TextDecoder("utf-16le").decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

function Dashboard({ days, setDays }: { days: number; setDays: (n: number) => void }) {
  const q = trpc.adsManager.dashboard.useQuery({ days });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const maxDay = Math.max(1, ...Object.values(groupDaily(d.daily)).map((x) => x.meta + x.google));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Periodo:</span>
        {[7, 30, 90].map((n) => (
          <Button key={n} size="sm" variant={days === n ? "default" : "outline"} onClick={() => setDays(n)}>
            {n} días
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">
          {d.range.from} → {d.range.to}
        </span>
      </div>

      {!d.hasData && (
        <PanelEmpty
          icon={<Megaphone className="h-5 w-5" />}
          title="Aún no hay datos de tus campañas"
          description="Conecta Meta Ads o Google Ads en Integraciones y pagos para importarlos cada día, o sube el informe de cada plataforma en CSV desde «Importar»."
        />
      )}

      {d.alerts.length > 0 && (
        <section className={sectionClass} aria-labelledby="ads-alerts">
          <h2 id="ads-alerts" className="text-base font-semibold text-foreground">Avisos</h2>
          <ul className="space-y-2">
            {d.alerts.map((a) => (
              <li key={a.key} className="flex items-start gap-2 text-sm">
                {a.severity === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
                <div>
                  <p className="font-medium text-foreground">
                    {a.title} <Badge variant={SEVERITY[a.severity]}>{a.severity}</Badge>
                  </p>
                  <p className="text-muted-foreground">{a.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={sectionClass} aria-labelledby="ads-totals">
        <h2 id="ads-totals" className="text-base font-semibold text-foreground">Resumen</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi label="Inversión" value={eur(d.totals.spendCents)} />
          <Kpi label="Ventas reales atribuidas" value={int(d.totals.sales)} hint={d.totals.revenueCents == null ? "Sin ventas etiquetadas" : eur(d.totals.revenueCents)} />
          <Kpi label="ROAS real (ingresos / inversión)" value={roas(d.totals.kpis.roas)} />
          <Kpi label="Coste por venta" value={eur(d.totals.kpis.costPerSaleCents)} />
          <Kpi label="Conversiones (según las plataformas)" value={dec(d.totals.conversions)} hint={`CPA ${eur(d.totals.kpis.cpaCents)}`} />
          <Kpi label="Clics" value={int(d.totals.clicks)} hint={`CTR ${pct(d.totals.kpis.ctr)} · CPC ${eur(d.totals.kpis.cpcCents)}`} />
          <Kpi label="Impresiones" value={int(d.totals.impressions)} />
          <Kpi label="Ventas del periodo en tu negocio" value={int(d.coreSales.sales)} hint={`${eur(d.coreSales.revenueCents)} · ${int(d.coreSales.tagged)} con origen`} />
        </div>
        <p className="text-xs text-muted-foreground">
          Los ingresos son tus ventas reales (reservas cobradas y no anuladas) con su origen identificado. Las conversiones y su valor son los que declara cada plataforma, que suele contar también ventas que no son tuyas o duplicadas.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {d.byPlatform.map((p) => (
          <div key={p.platform} className={sectionClass}>
            <h3 className="font-semibold text-foreground">{ADS_PLATFORM_LABELS[p.platform]}</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Inversión</dt>
              <dd className="text-right font-medium">{eur(p.spendCents)}</dd>
              <dt className="text-muted-foreground">Ventas reales</dt>
              <dd className="text-right font-medium">{int(p.sales)} · {eur(p.revenueCents)}</dd>
              <dt className="text-muted-foreground">ROAS real</dt>
              <dd className="text-right font-medium">{roas(p.kpis.roas)}</dd>
              <dt className="text-muted-foreground">Coste por venta</dt>
              <dd className="text-right font-medium">{eur(p.kpis.costPerSaleCents)}</dd>
              <dt className="text-muted-foreground">Conversiones de la plataforma</dt>
              <dd className="text-right font-medium">{dec(p.conversions)} (CPA {eur(p.kpis.cpaCents)})</dd>
              <dt className="text-muted-foreground">ROAS que declara</dt>
              <dd className="text-right font-medium">{roas(p.kpis.platformRoas)}</dd>
            </dl>
            {p.unattributed.sales > 0 && (
              <p className="text-xs text-muted-foreground">
                {p.unattributed.sales} venta(s) ({eur(p.unattributed.revenueCents)}) llegaron por {ADS_PLATFORM_SHORT[p.platform]} sin una campaña reconocible: cuentan en el canal, no en una campaña.
              </p>
            )}
          </div>
        ))}
      </section>

      {d.daily.length > 0 && (
        <section className={sectionClass} aria-labelledby="ads-daily">
          <h2 id="ads-daily" className="text-base font-semibold text-foreground">Inversión por día</h2>
          <div className="flex h-32 items-end gap-px" role="img" aria-label="Inversión diaria de Meta y Google">
            {Object.entries(groupDaily(d.daily)).map(([day, v]) => (
              <div key={day} className="flex flex-1 flex-col justify-end" title={`${day}: Meta ${eur(v.meta)} · Google ${eur(v.google)}`}>
                <div className="bg-primary/80" style={{ height: `${(v.google / maxDay) * 100}%` }} />
                <div className="bg-primary/40" style={{ height: `${(v.meta / maxDay) * 100}%` }} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Tono claro: Meta · tono oscuro: Google.</p>
        </section>
      )}

      {d.campaigns.length > 0 && (
        <section className={sectionClass} aria-labelledby="ads-campaigns">
          <h2 id="ads-campaigns" className="text-base font-semibold text-foreground">Campañas</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2">Campaña</th>
                  <th className="px-2 text-right">Inversión</th>
                  <th className="px-2 text-right">Clics</th>
                  <th className="px-2 text-right">CTR</th>
                  <th className="px-2 text-right">Conv. plataforma</th>
                  <th className="px-2 text-right">CPA</th>
                  <th className="px-2 text-right">Ventas reales</th>
                  <th className="px-2 text-right">Ingresos</th>
                  <th className="px-2 text-right">ROAS</th>
                  <th className="pl-2 text-right">Coste/venta</th>
                </tr>
              </thead>
              <tbody>
                {d.campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="max-w-[260px] py-2 pr-2">
                      <p className={`font-medium text-foreground ${ellipsis}`} title={c.name}>{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ADS_PLATFORM_SHORT[c.platform]}
                        {c.source === "csv" ? " · CSV" : ""}
                        {c.utmCampaign ? ` · utm ${c.utmCampaign}` : ""}
                      </p>
                    </td>
                    <td className="px-2 text-right">{eur(c.spendCents)}</td>
                    <td className="px-2 text-right">{int(c.clicks)}</td>
                    <td className="px-2 text-right">{pct(c.kpis.ctr)}</td>
                    <td className="px-2 text-right">{dec(c.conversions)}</td>
                    <td className="px-2 text-right">{eur(c.kpis.cpaCents)}</td>
                    <td className="px-2 text-right" title={c.reliable ? undefined : "Ninguna venta ha llevado nunca la etiqueta de esta campaña: sin datos (no es un cero)."}>{c.reliable ? int(c.sales) : "sin datos"}</td>
                    <td className="px-2 text-right">{c.reliable ? eur(c.revenueCents) : NONE}</td>
                    <td className="px-2 text-right">{roas(c.kpis.roas)}</td>
                    <td className="pl-2 text-right">{eur(c.kpis.costPerSaleCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            «Sin datos» = ninguna de tus ventas ha llevado nunca la etiqueta de esa campaña: no se puede saber si no vende o si no está etiquetada. Cada venta cuenta para una sola campaña y nunca se reparte en proporción.
          </p>
        </section>
      )}
    </div>
  );
}

function groupDaily(list: Array<{ day: string; platform: AdsPlatform; spendCents: number }>) {
  const out: Record<string, { meta: number; google: number }> = {};
  for (const r of list) {
    out[r.day] ??= { meta: 0, google: 0 };
    out[r.day][r.platform] += r.spendCents;
  }
  return out;
}

// ─── Campañas (código UTM y archivo) ─────────────────────────────────────────

function Campaigns() {
  const utils = trpc.useUtils();
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const q = trpc.adsManager.campaigns.useQuery({ includeArchived: showArchived });
  const setUtm = trpc.adsManager.setCampaignUtm.useMutation({ onSuccess: () => (toast.success("Código guardado"), utils.adsManager.invalidate()), onError: (e) => toastError(e) });
  const archive = trpc.adsManager.setCampaignArchived.useMutation({ onSuccess: () => utils.adsManager.invalidate(), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  return (
    <section className={sectionClass}>
      <p className="text-sm text-muted-foreground">
        Para atribuir tus ventas, el enlace de cada anuncio debe llevar <code>utm_campaign</code> con el identificador de la campaña, su nombre exacto o el código que pongas aquí (y <code>utm_source</code> = facebook, instagram o google). En Google Ads basta con el etiquetado automático y <code>utm_campaign={"{campaignid}"}</code> en la plantilla de seguimiento.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} /> Ver también las archivadas
      </label>
      {!q.data!.length ? (
        <PanelEmpty icon={<Megaphone className="h-5 w-5" />} title="Aún no hay campañas" description="Aparecen al importar los datos de Meta o de Google (por conexión o por CSV)." />
      ) : (
        <ul className="divide-y divide-border">
          {q.data!.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className={`font-medium text-foreground ${ellipsis}`} title={c.name}>{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {ADS_PLATFORM_SHORT[c.platform]} · {c.externalId.startsWith("nombre:") ? "sin identificador (CSV)" : `ID ${c.externalId}`} · {c.firstDay ?? NONE} → {c.lastDay ?? NONE}
                  {c.archived ? " · archivada" : ""}
                </p>
              </div>
              <Input
                aria-label={`Código utm_campaign de ${c.name}`}
                className="w-48"
                placeholder="utm_campaign"
                maxLength={160}
                value={edit[c.id] ?? c.utmCampaign ?? ""}
                onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })}
              />
              <Button size="sm" variant="outline" disabled={setUtm.isPending || (edit[c.id] ?? c.utmCampaign ?? "") === (c.utmCampaign ?? "")} onClick={() => setUtm.mutate({ id: c.id, utmCampaign: (edit[c.id] ?? "").trim() || null })}>
                Guardar
              </Button>
              <Button size="sm" variant="ghost" aria-label={c.archived ? "Recuperar" : "Archivar"} onClick={() => archive.mutate({ id: c.id, archived: !c.archived })}>
                {c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Importar ─────────────────────────────────────────────────────────────────

function Imports() {
  const utils = trpc.useUtils();
  const dash = trpc.adsManager.dashboard.useQuery({ days: 30 });
  const sync = trpc.adsManager.sync.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success(`Importación correcta: ${r.rowsUpserted} fila(s)`);
      else toast.error(`${r.error.label}. ${r.error.message}`);
      utils.adsManager.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const [platform, setPlatform] = useState<AdsPlatform>("meta");
  const importCsv = trpc.adsManager.importCsv.useMutation({
    onSuccess: (r) => {
      toast.success(`Importadas ${r.rows} fila(s) de ${r.campaigns} campaña(s)${r.skipped ? `; ${r.skipped} omitida(s)` : ""}`);
      if (r.problems.length) toast.message(r.problems.slice(0, 3).join(" "));
      if (r.detectedPlatform && r.detectedPlatform !== platform) toast.warning(`El archivo parece de ${ADS_PLATFORM_SHORT[r.detectedPlatform]}: revisa que hayas elegido la plataforma correcta.`);
      utils.adsManager.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const importTags = trpc.adsManager.importSaleTags.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.tagged} venta(s) con su origen`);
      if (r.unknownCount) toast.warning(`${r.unknownCount} referencia(s) no corresponden a ninguna reserva: ${r.unknownReferences.slice(0, 5).join(", ")}`);
      utils.adsManager.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const [tag, setTag] = useState({ reference: "", utmSource: "", utmCampaign: "" });
  const tagSale = trpc.adsManager.tagSale.useMutation({ onSuccess: () => (toast.success("Origen guardado"), setTag({ reference: "", utmSource: "", utmCampaign: "" }), utils.adsManager.invalidate()), onError: (e) => toastError(e) });

  const pick = async (e: React.ChangeEvent<HTMLInputElement>, kind: "ads" | "tags") => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5_500_000) return void toast.error("El archivo es demasiado grande (máximo unos 5 MB): exporta un periodo más corto.");
    const text = await readCsvFile(file);
    if (kind === "ads") importCsv.mutate({ platform, text, fileName: file.name });
    else importTags.mutate({ text, fileName: file.name });
  };

  return (
    <div className="space-y-6">
      <section className={sectionClass} aria-labelledby="ads-sync">
        <h2 id="ads-sync" className="text-base font-semibold text-foreground">Importación automática</h2>
        <p className="text-sm text-muted-foreground">Cada día a primera hora se importan los últimos 7 días (90 la primera vez) con las credenciales de tu empresa. Solo se leen datos: nunca se crean ni se cambian campañas.</p>
        {dash.isLoading ? (
          <PanelLoading />
        ) : dash.error ? (
          <PanelError error={dash.error} onRetry={() => dash.refetch()} />
        ) : (
          <ul className="space-y-3">
            {dash.data!.sync.map((s) => (
              <li key={s.platform} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                {s.configured ? <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" /> : <XCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-foreground">{ADS_PLATFORM_LABELS[s.platform]}</p>
                  <p className="text-muted-foreground">
                    {s.configured ? `Conectado · última importación correcta: ${when(s.lastOkAt)}` : "Sin conectar: configúralo en Integraciones y pagos o sube su CSV."}
                  </p>
                  {s.lastError && (!s.lastOkAt || s.lastError.at > s.lastOkAt) && (
                    <p className="text-destructive">
                      {ADS_ERROR_LABELS[s.lastError.kind as AdsErrorKind] ?? s.lastError.kind}. {s.lastError.message}
                    </p>
                  )}
                </div>
                {s.configured ? (
                  <Button size="sm" variant="outline" disabled={sync.isPending || s.running} onClick={() => sync.mutate({ platform: s.platform })}>
                    <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" /> Importar ahora
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/admin/configuracion/integraciones">Conectar</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={sectionClass} aria-labelledby="ads-csv">
        <h2 id="ads-csv" className="text-base font-semibold text-foreground">Subir el informe de una plataforma (CSV)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Meta: Administrador de anuncios → Campañas → Informes → Exportar datos de la tabla, con el desglose por tiempo «Día» (columnas: nombre de la campaña, día, importe gastado, impresiones, clics y resultados).</li>
          <li>Google Ads: Campañas → Segmento → Tiempo → Día → Descargar (CSV). Incluye coste, impresiones, clics, conversiones y, si puedes, el ID de campaña.</li>
          <li>Reimportar un periodo corrige los datos de esos días; nunca duplica.</li>
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>Plataforma</span>
            <select className={selectClass} value={platform} onChange={(e) => setPlatform(e.target.value as AdsPlatform)}>
              {ADS_PLATFORMS.map((p) => (
                <option key={p} value={p}>{ADS_PLATFORM_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
            <Upload className="h-4 w-4" aria-hidden="true" /> {importCsv.isPending ? "Importando…" : "Elegir archivo CSV"}
            <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="sr-only" disabled={importCsv.isPending} onChange={(e) => pick(e, "ads")} />
          </label>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="ads-tags">
        <h2 id="ads-tags" className="text-base font-semibold text-foreground">Origen de tus ventas</h2>
        <p className="text-sm text-muted-foreground">
          Para medir cada campaña con tus ventas reales, indica de qué campaña viene cada reserva. Sube un CSV con la referencia (localizador o número de pedido) y su origen: <code>utm_source</code>, <code>utm_campaign</code>, <code>gclid</code> o <code>fbclid</code>. Sirve el informe de transacciones de Google Analytics con el «ID de transacción» y la «Campaña de la sesión». Las reservas con clic de Meta ya se reconocen solas (cuentan para Meta, no para una campaña).
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
          <Upload className="h-4 w-4" aria-hidden="true" /> {importTags.isPending ? "Importando…" : "Elegir archivo CSV de ventas"}
          <input type="file" accept=".csv,.tsv,text/csv" className="sr-only" disabled={importTags.isPending} onChange={(e) => pick(e, "tags")} />
        </label>
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            tagSale.mutate({ reference: tag.reference, utmSource: tag.utmSource || null, utmCampaign: tag.utmCampaign || null });
          }}
        >
          <Input aria-label="Referencia de la reserva" placeholder="Localizador o pedido" value={tag.reference} maxLength={40} onChange={(e) => setTag({ ...tag, reference: e.target.value })} required />
          <Input aria-label="Origen (utm_source)" placeholder="facebook, google…" value={tag.utmSource} maxLength={120} onChange={(e) => setTag({ ...tag, utmSource: e.target.value })} />
          <Input aria-label="Campaña (utm_campaign)" placeholder="utm_campaign" value={tag.utmCampaign} maxLength={160} onChange={(e) => setTag({ ...tag, utmCampaign: e.target.value })} />
          <Button type="submit" variant="outline" disabled={tagSale.isPending || !tag.reference.trim()}>Guardar origen</Button>
        </form>
      </section>

      {dash.data && dash.data.runs.length > 0 && (
        <section className={sectionClass} aria-labelledby="ads-runs">
          <h2 id="ads-runs" className="text-base font-semibold text-foreground">Últimas importaciones</h2>
          <ul className="divide-y divide-border text-sm">
            {dash.data.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-2 py-1.5">
                <span className="w-32 text-muted-foreground">{when(r.startedAt)}</span>
                <span className="w-24">{r.platform === "core" ? "Ventas" : ADS_PLATFORM_SHORT[r.platform as AdsPlatform] ?? r.platform}</span>
                <span className="w-20">{r.kind === "api" ? "Automática" : "CSV"}</span>
                <Badge variant={r.status === "ok" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status === "ok" ? "correcta" : r.status === "failed" ? "fallida" : "en curso"}</Badge>
                <span className="text-muted-foreground">
                  {r.rowsUpserted} fila(s){r.rowsSkipped ? `, ${r.rowsSkipped} omitida(s)` : ""}
                  {r.rangeStart ? ` · ${r.rangeStart} → ${r.rangeEnd}` : ""}
                  {r.errorMessage ? ` · ${r.errorMessage}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Presupuestos ─────────────────────────────────────────────────────────────

function Budgets() {
  const utils = trpc.useUtils();
  const dash = trpc.adsManager.dashboard.useQuery({ days: 30 });
  const campaigns = trpc.adsManager.campaigns.useQuery();
  const [form, setForm] = useState<{ scope: "total" | "platform" | "campaign"; platform: AdsPlatform; campaignId: string; amount: string }>({ scope: "total", platform: "meta", campaignId: "", amount: "" });
  const save = trpc.adsManager.saveBudget.useMutation({ onSuccess: () => (toast.success("Presupuesto guardado"), setForm({ ...form, amount: "" }), utils.adsManager.invalidate()), onError: (e) => toastError(e) });
  const archive = trpc.adsManager.archiveBudget.useMutation({ onSuccess: () => utils.adsManager.invalidate(), onError: (e) => toastError(e) });
  const cents = useMemo(() => Math.round(Number(form.amount.replace(/\./g, "").replace(",", ".")) * 100), [form.amount]);
  if (dash.isLoading) return <PanelLoading />;
  if (dash.error) return <PanelError error={dash.error} onRetry={() => dash.refetch()} />;
  return (
    <div className="space-y-6">
      <section className={sectionClass}>
        <p className="text-sm text-muted-foreground">Presupuesto mensual previsto. Avisamos si el gasto del mes lo supera o si, al ritmo actual, lo superará a final de mes.</p>
        {!dash.data!.budgets.length ? (
          <p className="text-sm text-muted-foreground">Aún no tienes presupuestos.</p>
        ) : (
          <ul className="divide-y divide-border">
            {dash.data!.budgets.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 font-medium text-foreground">{b.label}</span>
                <span>{eur(b.spentCents)} de {eur(b.monthlyCents)}</span>
                <div className="h-2 w-32 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className={b.spentCents > b.monthlyCents ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${Math.min(100, (b.spentCents / b.monthlyCents) * 100)}%` }} />
                </div>
                <Button size="sm" variant="ghost" aria-label="Quitar presupuesto" onClick={() => archive.mutate({ id: b.id })}>
                  <Archive className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form
        className={sectionClass}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ scope: form.scope, platform: form.scope === "platform" ? form.platform : null, campaignId: form.scope === "campaign" ? Number(form.campaignId) || null : null, monthlyCents: cents });
        }}
      >
        <h2 className="text-base font-semibold text-foreground">Nuevo presupuesto mensual</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>Para</span>
            <select className={selectClass} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}>
              <option value="total">Todas las campañas</option>
              <option value="platform">Una plataforma</option>
              <option value="campaign">Una campaña</option>
            </select>
          </label>
          {form.scope === "platform" && (
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              <span>Plataforma</span>
              <select className={selectClass} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as AdsPlatform })}>
                {ADS_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{ADS_PLATFORM_SHORT[p]}</option>
                ))}
              </select>
            </label>
          )}
          {form.scope === "campaign" && (
            <label className="space-y-1.5 text-sm font-medium text-foreground">
              <span>Campaña</span>
              <select className={selectClass} value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })} required>
                <option value="">Elige…</option>
                {(campaigns.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{ADS_PLATFORM_SHORT[c.platform]} · {c.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>Importe al mes (€)</span>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="500" required />
          </label>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending || !(cents > 0)}>Guardar</Button>
        </div>
      </form>
    </div>
  );
}

// ─── Medición ─────────────────────────────────────────────────────────────────

function Tracking() {
  const dash = trpc.adsManager.dashboard.useQuery({ days: 30 });
  if (dash.isLoading) return <PanelLoading />;
  if (dash.error) return <PanelError error={dash.error} onRetry={() => dash.refetch()} />;
  return (
    <section className={sectionClass}>
      <p className="text-sm text-muted-foreground">Qué está midiendo tu web y tu tienda para que las plataformas aprendan de tus ventas y para atribuirlas a cada campaña.</p>
      <ul className="space-y-3">
        {dash.data!.tracking.map((t) => (
          <li key={t.key} className="flex items-start gap-2 text-sm">
            {t.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
            <div>
              <p className="font-medium text-foreground">{t.label}</p>
              <p className="text-muted-foreground">{t.detail}</p>
              {!t.ok && <p className="text-muted-foreground">{t.fix}</p>}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/configuracion/integraciones">Integraciones y pagos</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/configuracion/marca">Marca y tema (analítica de la web)</Link>
        </Button>
      </div>
    </section>
  );
}

// ─── Ajustes ──────────────────────────────────────────────────────────────────

function Settings() {
  const utils = trpc.useUtils();
  const s = trpc.adsManager.settings.useQuery();
  const [draft, setDraft] = useState<{ autoSync: boolean; minSpend: string; days: string } | null>(null);
  const save = trpc.adsManager.saveSettings.useMutation({ onSuccess: () => (toast.success("Ajustes guardados"), setDraft(null), utils.adsManager.invalidate()), onError: (e) => toastError(e) });
  if (s.isLoading) return <PanelLoading />;
  if (s.error) return <PanelError error={s.error} onRetry={() => s.refetch()} />;
  const d = draft ?? { autoSync: s.data!.autoSync, minSpend: String(s.data!.noConvMinSpendCents / 100), days: String(s.data!.noConvDays) };
  return (
    <form
      className={sectionClass}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ autoSync: d.autoSync, noConvMinSpendCents: Math.round(Number(d.minSpend.replace(",", ".")) * 100) || 0, noConvDays: Math.round(Number(d.days)) || 14 });
      }}
    >
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Checkbox checked={d.autoSync} onCheckedChange={(v) => setDraft({ ...d, autoSync: v === true })} /> Importar cada día los datos de las plataformas conectadas
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Avisar de una campaña sin conversiones si ha gastado al menos (€)</span>
          <Input inputMode="decimal" value={d.minSpend} onChange={(e) => setDraft({ ...d, minSpend: e.target.value })} />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>… en los últimos (días)</span>
          <Input inputMode="numeric" value={d.days} onChange={(e) => setDraft({ ...d, days: e.target.value })} />
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>Guardar</Button>
      </div>
    </form>
  );
}

export default function AdsManager() {
  const [tab, setTab] = useState("panel");
  const [days, setDays] = useState(30);
  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect</p>
          <h1 className="text-2xl font-bold text-foreground">Publicidad (Ads Manager)</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Tus campañas de Meta y de Google en un solo panel: lo que inviertes, lo que consiguen según cada plataforma y lo que de verdad vendes gracias a ellas.</p>
        </header>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="panel">Panel</TabsTrigger>
            <TabsTrigger value="campanas">Campañas</TabsTrigger>
            <TabsTrigger value="importar">Importar</TabsTrigger>
            <TabsTrigger value="presupuestos">Presupuestos</TabsTrigger>
            <TabsTrigger value="medicion">Medición</TabsTrigger>
            <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
          </TabsList>
          <TabsContent value="panel" className="pt-4"><Dashboard days={days} setDays={setDays} /></TabsContent>
          <TabsContent value="campanas" className="pt-4"><Campaigns /></TabsContent>
          <TabsContent value="importar" className="pt-4"><Imports /></TabsContent>
          <TabsContent value="presupuestos" className="pt-4"><Budgets /></TabsContent>
          <TabsContent value="medicion" className="pt-4"><Tracking /></TabsContent>
          <TabsContent value="ajustes" className="pt-4"><Settings /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
