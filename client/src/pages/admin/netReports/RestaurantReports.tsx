import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { BarChart3, RefreshCw } from "lucide-react";
import { RestaurantPicker, useRestaurantChoice } from "../restaurantNet/RestaurantNetParts";
import { Kpis, ReportError, ReportTable, eur, num, pct, usePeriod } from "./ReportParts";

type Section = "dias" | "turnos" | "salas" | "camareros" | "platos" | "cocina";

export default function RestaurantReports() {
  const utils = trpc.useUtils();
  const choice = useRestaurantChoice();
  const { value, valid, bar } = usePeriod();
  const input = { ...value, ...(choice.restaurantId != null ? { restaurantId: choice.restaurantId } : {}) };
  const q = trpc.restaurantReports.report.useQuery(input, { enabled: valid, retry: false });
  const csv = (section: Section) => () => utils.restaurantReports.csv.fetch({ ...input, section });
  const r = q.data;
  const salesCols = (label: string) => [
    { title: label, cell: (x: any) => x.label ?? x.key },
    { title: "Comandas", cell: (x: any) => x.orders, right: true },
    { title: "Comensales", cell: (x: any) => x.guests, right: true },
    { title: "Ventas", cell: (x: any) => eur(x.salesCents), right: true },
    { title: "Ticket medio", cell: (x: any) => eur(x.avgTicketCents), right: true },
  ];
  return (
    <AdminLayout title="Informes de restaurante">
      <div className="space-y-5 max-w-full">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 shrink-0" /> Informes operativos</h1>
          <p className="text-muted-foreground text-sm">Ventas cobradas por día, turno, sala y camarero, ticket medio, platos más vendidos y tiempos de cocina.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3"><RestaurantPicker choice={choice} />{bar}</div>
        {q.isLoading ? <div className="text-center py-12 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Cargando…</div> : q.error ? <ReportError error={q.error} /> : r && (
          <>
            <Kpis items={[
              { label: "Ventas", value: eur(r.totals.salesCents) },
              { label: "Comandas cobradas", value: num(r.totals.orders) },
              { label: "Ticket medio", value: eur(r.totals.avgTicketCents), hint: "Por comanda" },
              { label: "Por comensal", value: eur(r.totals.avgPerGuestCents), hint: `${num(r.totals.guests)} comensales` },
            ]} />
            <ReportTable title="Por día" rows={r.byDay} columns={salesCols("Día")} empty="Sin comandas cobradas en el periodo." csv={csv("dias")} bar={(x) => x.salesCents} />
            <div className="grid lg:grid-cols-2 gap-4">
              <ReportTable title="Por turno" rows={r.byShift} columns={salesCols("Turno")} empty="Sin datos." csv={csv("turnos")} />
              <ReportTable title="Por sala" rows={r.byRoom} columns={salesCols("Sala")} empty="Sin datos." csv={csv("salas")} />
            </div>
            <ReportTable title="Por camarero" rows={r.byWaiter} columns={salesCols("Camarero")} empty="Sin datos." csv={csv("camareros")} bar={(x) => x.salesCents} />
            <ReportTable title="Platos más vendidos" rows={r.topDishes} empty="Sin platos vendidos." csv={csv("platos")} bar={(x) => x.quantity} columns={[
              { title: "Plato", cell: (x) => x.name }, { title: "Unidades", cell: (x) => x.quantity, right: true }, { title: "Ventas", cell: (x) => eur(x.salesCents), right: true },
            ]} />
            <ReportTable title="Tiempos de cocina (envío → listo)" rows={r.kitchen} empty="Sin platos con tiempos de cocina registrados (KDS)." csv={csv("cocina")} columns={[
              { title: "Estación", cell: (x) => x.station }, { title: "Platos", cell: (x) => x.items, right: true }, { title: "Media", cell: (x) => `${num(x.avgMinutes)} min`, right: true },
              { title: "P90", cell: (x) => `${num(x.p90Minutes)} min`, right: true }, { title: "Plazo", cell: (x) => (x.slaMinutes == null ? "—" : `${x.slaMinutes} min`), right: true },
              { title: "Fuera de plazo", cell: (x) => pct(x.lateBp), right: true },
            ]} />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
