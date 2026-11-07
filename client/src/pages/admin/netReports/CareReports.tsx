import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { BarChart3, RefreshCw } from "lucide-react";
import { Kpis, ReportError, ReportTable, eur, num, pct, usePeriod } from "./ReportParts";

const TYPE_LABEL: Record<string, string> = { cabina: "Cabina", terapeuta: "Profesional", sin_recurso: "Sin asignar" };

export default function CareReports() {
  const utils = trpc.useUtils();
  const { value, valid, bar } = usePeriod();
  const q = trpc.careReports.report.useQuery(value, { enabled: valid, retry: false });
  const csv = (section: "ocupacion" | "tratamientos" | "bonos") => () => utils.careReports.csv.fetch({ ...value, section });
  const r = q.data;
  return (
    <AdminLayout title="Estadísticas del centro">
      <div className="space-y-5 max-w-full">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 shrink-0" /> Estadísticas y gestión del centro</h1>
          <p className="text-muted-foreground text-sm">Ocupación de cabinas y profesionales, citas por tratamiento, ingresos y bonos. La sede filtra los bonos; la agenda del SPA es de toda la empresa.</p>
        </div>
        {bar}
        {q.isLoading ? <div className="text-center py-12 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Cargando…</div> : q.error ? <ReportError error={q.error} /> : r && (
          <>
            <Kpis items={[
              { label: "Ingresos", value: eur(r.totals.revenueCents), hint: `Citas ${eur(r.totals.appointmentRevenueCents)} · bonos ${eur(r.totals.packRevenueCents)}` },
              { label: "Citas", value: num(r.totals.appointments) },
              { label: "Ocupación", value: pct(r.totals.occupancyBp), hint: "Minutos reservados / ofrecidos" },
              { label: "Bonos vendidos", value: num(r.packs.sold), hint: `${num(r.packs.consumedSessions)} sesiones consumidas` },
            ]} />
            <ReportTable title="Ocupación por cabina y profesional" rows={r.occupancy} empty="Sin franjas de agenda en el periodo." csv={csv("ocupacion")} bar={(x) => x.occupancyBp} columns={[
              { title: "Recurso", cell: (x) => x.name }, { title: "Tipo", cell: (x) => TYPE_LABEL[x.type] ?? x.type }, { title: "Franjas", cell: (x) => x.slots, right: true },
              { title: "Reservado", cell: (x) => `${num(x.bookedMinutes / 60)} h`, right: true }, { title: "Ocupación", cell: (x) => pct(x.occupancyBp), right: true },
            ]} />
            <ReportTable title="Citas por tratamiento" rows={r.byTreatment} empty="Sin citas en el periodo." csv={csv("tratamientos")} bar={(x) => x.appointments} columns={[
              { title: "Tratamiento", cell: (x) => x.name }, { title: "Citas", cell: (x) => x.appointments, right: true }, { title: "Personas", cell: (x) => x.people, right: true },
              { title: "Ingresos cobrados", cell: (x) => eur(x.revenueCents), right: true },
            ]} />
            <ReportTable title={`Bonos · ${r.packs.expired} caducados con ${r.packs.expiredSessionsLeft} sesiones sin usar`} rows={r.packs.byPack} empty="Sin bonos vendidos en el periodo." csv={csv("bonos")} columns={[
              { title: "Bono", cell: (x) => x.name }, { title: "Vendidos", cell: (x) => x.sold, right: true }, { title: "Ingresos", cell: (x) => eur(x.revenueCents), right: true },
            ]} />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
