import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { BarChart3, RefreshCw } from "lucide-react";
import { Kpis, ReportError, ReportTable, num, usePeriod } from "./ReportParts";

const ASSET_LABEL: Record<string, string> = { ski: "Esquís", snowboard: "Snowboard", boots: "Botas", helmet: "Cascos", poles: "Bastones", other: "Otro" };
const RESOLUTION_LABEL: Record<string, string> = { available: "Vuelve a servicio", retired: "Baja", sin_resolucion: "Sin resolución" };

export default function SkiReports() {
  const utils = trpc.useUtils();
  const { value, valid, bar } = usePeriod(true);
  const input = { from: value.from, to: value.to, siteId: value.siteId ?? "" };
  const q = trpc.skiReports.report.useQuery(input, { enabled: valid && !!value.siteId, retry: false });
  const csv = (section: "productos" | "profesores" | "material" | "taller") => () => utils.skiReports.csv.fetch({ ...input, section });
  const r = q.data;
  return (
    <AdminLayout title="Estadísticas de Ski Net">
      <div className="space-y-5 max-w-full">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 shrink-0" /> Estadísticas operativas</h1>
          <p className="text-muted-foreground text-sm">Escuela (sesiones, alumnos y horas por profesor) y alquiler (salidas, rotación del material y taller) de cada sede.</p>
        </div>
        {bar}
        {q.isLoading ? <div className="text-center py-12 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Cargando…</div> : q.error ? <ReportError error={q.error} /> : r && (
          <>
            <Kpis items={[
              { label: "Sesiones", value: num(r.totals.sessions), hint: r.totals.cancelled ? `${r.totals.cancelled} canceladas` : undefined },
              { label: "Alumnos", value: num(r.totals.participants) },
              { label: "Horas de profesor", value: num(r.totals.instructorHours) },
              { label: "Alquileres", value: num(r.totals.deliveries), hint: `${num(r.totals.rentedUnits)} unidades entregadas` },
            ]} />
            {r.school && (
              <div className="grid lg:grid-cols-2 gap-4">
                <ReportTable title="Sesiones y alumnos por producto y nivel" rows={r.byProduct} empty="Sin sesiones en el periodo." csv={csv("productos")} columns={[
                  { title: "Producto", cell: (x) => x.product }, { title: "Nivel", cell: (x) => x.level }, { title: "Sesiones", cell: (x) => x.sessions, right: true }, { title: "Alumnos", cell: (x) => x.participants, right: true },
                ]} />
                <ReportTable title="Horas por profesor" rows={r.byInstructor} empty="Sin sesiones asignadas." csv={csv("profesores")} bar={(x) => x.hours} columns={[
                  { title: "Profesor", cell: (x) => x.name }, { title: "Sesiones", cell: (x) => x.sessions, right: true }, { title: "Horas", cell: (x) => num(x.hours), right: true },
                ]} />
              </div>
            )}
            {r.rental && (
              <div className="grid lg:grid-cols-2 gap-4">
                <ReportTable title="Rotación del material" rows={r.rotation} empty="Sin material ni alquileres." csv={csv("material")} bar={(x) => x.rotation} columns={[
                  { title: "Tipo", cell: (x) => ASSET_LABEL[x.assetType] ?? x.assetType }, { title: "Unidades", cell: (x) => x.units, right: true }, { title: "Salidas", cell: (x) => x.rentals, right: true },
                  { title: "Salidas por unidad", cell: (x) => num(x.rotation), right: true },
                ]} />
                <ReportTable title={`Taller · ${r.workshop.opened} partes (${r.workshop.open} abiertos), ${num(r.workshop.avgDaysToClose)} días de media`} rows={r.workshop.byResolution} empty="Sin partes de taller cerrados." csv={csv("taller")} columns={[
                  { title: "Resolución", cell: (x) => RESOLUTION_LABEL[x.resolution] ?? x.resolution }, { title: "Partes", cell: (x) => x.tickets, right: true },
                ]} />
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
