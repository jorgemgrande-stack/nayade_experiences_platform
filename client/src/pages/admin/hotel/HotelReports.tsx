import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { PanelLoading, PanelError } from "@/components/admin/PanelStates";
import AdminLayout from "@/components/AdminLayout";
import { MetricCard } from "@/components/admin/PanelVisual";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BarChart3, BedDouble, CalendarCheck, Percent, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PmsNotInstalled, addDays, eur, isPmsNotInstalled, localToday, shortDate } from "./pmsShared";

const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;

function Stat({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: LucideIcon }) {
  return <MetricCard icon={<Icon />} label={label} value={value} detail={hint} className="bg-gradient-to-br from-primary/5 to-card" />;
}

function TaxSetting() {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminGetPmsSettings.useQuery(undefined, { retry: false });
  const [value, setValue] = useState("");
  useEffect(() => {
    if (q.data) setValue(String(q.data.accommodationTaxBp / 100));
  }, [q.data]);
  const save = trpc.hotel.adminSetPmsSettings.useMutation({
    onSuccess: () => { toast.success("IVA del alojamiento guardado"); void utils.hotel.adminGetPmsSettings.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  if (isPmsNotInstalled(q.error)) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Percent className="h-4 w-4" /> IVA del alojamiento</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Tipo (%)</Label>
          <Input inputMode="decimal" className="w-28" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button size="sm" disabled={save.isPending} onClick={() => {
          const bp = Math.round(Number(value.replace(",", ".")) * 100);
          if (!Number.isFinite(bp)) return toast.error("Valor no válido");
          save.mutate({ accommodationTaxBp: bp });
        }}>Guardar</Button>
        <p className="text-xs text-muted-foreground basis-full">Se aplica a las noches que se cargan en el folio a partir de ahora (por defecto, 10 %). Los extras llevan su propio IVA.</p>
      </CardContent>
    </Card>
  );
}

export default function HotelReports() {
  const utils = trpc.useUtils();
  const today = localToday();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [auditDate, setAuditDate] = useState(addDays(today, -1));
  const valid = from <= to;
  const q = trpc.hotel.adminGetReport.useQuery({ from, to }, { enabled: valid, retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const audit = trpc.hotel.adminRunNightAudit.useMutation({
    onSuccess: (k) => { toast.success(`Día ${shortDate(k.businessDate)} cerrado · ocupación ${pct(k.occupancyBp)}`); void utils.hotel.adminGetReport.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const d = q.data;
  const s = d?.summary;
  const audited = new Map((d?.audits ?? []).map((a) => [a.businessDate, a]));

  return (
    <AdminLayout title="Informes del hotel">
      <div className="space-y-5 max-w-full">
        <PanelPageHeader icon={<BarChart3 />} title="Informes" description={"Ocupación, ingresos de alojamiento, ADR (ingreso medio por habitación ocupada) y RevPAR (ingreso por habitación disponible)."}
          actions={<>
          <Button variant="outline" size="icon" onClick={() => void utils.hotel.adminGetReport.invalidate()} aria-label="Actualizar"><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /></Button>
          </>}
        />

        {isPmsNotInstalled(q.error) ? (
          <PmsNotInstalled />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" className="w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
              {!valid && <span className="text-sm text-destructive pb-2">La fecha inicial debe ser anterior a la final.</span>}
            </div>

            {q.isLoading ? (
              <PanelLoading />
            ) : q.error ? (
              <PanelError error={q.error} onRetry={() => void q.refetch()} />
            ) : s && d && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat icon={Percent} label="Ocupación media" value={pct(s.occupancyBp)} hint={`${s.roomNightsSold} de ${s.roomNightsAvailable} noches`} />
                  <Stat icon={Wallet} label="Ingresos de alojamiento" value={eur(s.roomRevenueCents)} hint={`${s.nights} días`} />
                  <Stat icon={BedDouble} label="ADR" value={eur(s.adrCents)} hint="Por habitación ocupada" />
                  <Stat icon={TrendingUp} label="RevPAR" value={eur(s.revparCents)} hint="Por habitación disponible" />
                </div>

                <Card>
                  <CardHeader className="pb-2 flex flex-row flex-wrap items-end justify-between gap-2 space-y-0">
                    <CardTitle className="text-base flex items-center gap-2"><CalendarCheck className="h-4 w-4" /> Cerrar día</CardTitle>
                    <div className="flex flex-wrap items-end gap-2">
                      <Input type="date" className="w-40" value={auditDate} max={d.today} onChange={(e) => e.target.value && setAuditDate(e.target.value)} aria-label="Día que se cierra" />
                      <Button size="sm" disabled={audit.isPending || auditDate > d.today} onClick={() => audit.mutate({ businessDate: auditDate })}>{audit.isPending ? "Cerrando…" : "Cerrar día"}</Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">El cierre guarda los indicadores del día. Repetirlo los recalcula. También puede hacerse cada madrugada de forma automática si lo activa soporte.</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[760px]">
                        <thead className="border-b border-border bg-muted/40 text-left">
                          <tr>
                            <th className="p-2 font-medium">Día</th>
                            <th className="p-2 font-medium">Llegadas</th>
                            <th className="p-2 font-medium">Salidas</th>
                            <th className="p-2 font-medium">No-shows</th>
                            <th className="p-2 font-medium">Ocupadas</th>
                            <th className="p-2 font-medium">Ocupación</th>
                            <th className="p-2 font-medium text-right">Ingresos</th>
                            <th className="p-2 font-medium text-right">ADR</th>
                            <th className="p-2 font-medium text-right">RevPAR</th>
                            <th className="p-2 font-medium">Cierre</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.days.slice().reverse().map((k) => {
                            const a = audited.get(k.businessDate);
                            return (
                              <tr key={k.businessDate} className="border-b border-border last:border-0">
                                <td className="p-2 whitespace-nowrap">{shortDate(k.businessDate)}</td>
                                <td className="p-2">{k.arrivals}</td>
                                <td className="p-2">{k.departures}</td>
                                <td className="p-2">{k.noShows}</td>
                                <td className="p-2">{k.roomsOccupied} / {k.capacity}</td>
                                <td className="p-2">{pct(k.occupancyBp)}</td>
                                <td className="p-2 text-right whitespace-nowrap">{eur(k.roomRevenueCents)}</td>
                                <td className="p-2 text-right whitespace-nowrap">{eur(k.adrCents)}</td>
                                <td className="p-2 text-right whitespace-nowrap">{eur(k.revparCents)}</td>
                                <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{a ? `${a.source === "automatico" ? "Automático" : "Manual"} · ${pct(a.occupancyBp)}` : "Sin cerrar"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
                {s.roomNightsAvailable === 0 && (
                  <p className="text-sm text-muted-foreground">Sin capacidad: crea tus tipologías y habitaciones para ver la ocupación.</p>
                )}
              </>
            )}
            <TaxSetting />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
