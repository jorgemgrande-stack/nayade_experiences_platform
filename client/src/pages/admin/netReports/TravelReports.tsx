import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { BarChart3, RefreshCw } from "lucide-react";
import { FILE_STATUS_LABEL, OPERATION_STATUS_LABEL } from "../travel/travelShared";
import { Kpis, ReportError, ReportTable, eur, num, pct, usePeriod } from "./ReportParts";

export default function TravelReports() {
  const utils = trpc.useUtils();
  const { value, valid, bar } = usePeriod();
  const q = trpc.travelReports.report.useQuery(value, { enabled: valid, retry: false });
  const csv = (section: "estados" | "proveedores" | "meses" | "operaciones") => () => utils.travelReports.csv.fetch({ ...value, section });
  const r = q.data;
  const money = [
    { title: "Servicios", cell: (x: any) => x.services, right: true },
    { title: "Venta", cell: (x: any) => eur(x.sellingCents), right: true },
    { title: "Margen", cell: (x: any) => eur(x.marginCents), right: true },
    { title: "Margen %", cell: (x: any) => pct(x.marginBp), right: true },
    { title: "Comisiones", cell: (x: any) => eur(x.commissionCents), right: true },
  ];
  return (
    <AdminLayout title="Informes comerciales">
      <div className="space-y-5 max-w-full">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 shrink-0" /> Informes comerciales</h1>
          <p className="text-muted-foreground text-sm">Expedientes por estado, venta, margen y comisiones por proveedor y por mes (expedientes reservados) y operaciones pendientes con proveedores.</p>
        </div>
        {bar}
        {q.isLoading ? <div className="text-center py-12 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Cargando…</div> : q.error ? <ReportError error={q.error} /> : r && (
          <>
            <Kpis items={[
              { label: "Expedientes creados", value: num(r.totals.files) },
              { label: "Venta reservada", value: eur(r.totals.sellingCents) },
              { label: "Margen", value: eur(r.totals.marginCents), hint: pct(r.totals.marginBp) },
              { label: "Operaciones pendientes", value: num(r.operations.pending), hint: r.operations.overdue ? `${r.operations.overdue} fuera de plazo` : "Ninguna fuera de plazo" },
            ]} />
            <div className="grid lg:grid-cols-2 gap-4">
              <ReportTable title="Expedientes por estado" rows={r.byStatus} empty="Sin expedientes creados en el periodo." csv={csv("estados")} bar={(x) => x.files} columns={[
                { title: "Estado", cell: (x) => FILE_STATUS_LABEL[x.status] ?? x.status }, { title: "Expedientes", cell: (x) => x.files, right: true },
              ]} />
              <ReportTable title="Operaciones pendientes por estado" rows={r.operations.byStatus} empty="No hay operaciones pendientes." csv={csv("operaciones")} columns={[
                { title: "Estado", cell: (x) => OPERATION_STATUS_LABEL[x.status] ?? x.status }, { title: "Operaciones", cell: (x) => x.operations, right: true },
              ]} />
            </div>
            <ReportTable title="Por proveedor" rows={r.bySupplier} empty="Sin servicios reservados en el periodo." csv={csv("proveedores")} bar={(x) => x.marginCents} columns={[{ title: "Proveedor", cell: (x) => x.name }, ...money]} />
            <ReportTable title="Por mes" rows={r.byMonth} empty="Sin servicios reservados en el periodo." csv={csv("meses")} columns={[{ title: "Mes", cell: (x) => x.month }, ...money]} />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
