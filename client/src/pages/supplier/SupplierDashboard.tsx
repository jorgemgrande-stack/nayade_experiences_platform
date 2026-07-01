import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { LogOut, Loader2, Package, Euro, TrendingUp, Receipt } from "lucide-react";

const LOGO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png";

// Etiquetas legibles para los canales de venta (reservations.channel)
const CHANNEL_LABEL: Record<string, string> = {
  ONLINE_DIRECTO: "Online directo",
  ONLINE_ASISTIDO: "Online asistido",
  VENTA_DELEGADA: "Venta delegada",
  TELEFONO: "Teléfono",
  EMAIL: "Email",
  TPV_FISICO: "TPV físico",
  PARTNER: "Partner",
  TICKETING: "Cupones / Ticketing",
  MANUAL: "Manual",
  API: "API",
  OTRO: "Otro",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  paid:            { label: "Pagada",     cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" },
  pending_payment: { label: "Pendiente",  cls: "bg-amber-500/15 text-amber-400 border border-amber-500/25" },
  cancelled:       { label: "Cancelada",  cls: "bg-red-500/15 text-red-400 border border-red-500/25" },
  failed:          { label: "Fallida",    cls: "bg-gray-500/15 text-gray-400 border border-gray-500/25" },
};

const SETTLEMENT_STATUS: Record<string, string> = {
  borrador: "Borrador", emitida: "Emitida", pendiente_abono: "Pendiente de abono",
  abonada: "Abonada", incidencia: "Incidencia", recalculada: "Recalculada",
};

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export default function SupplierDashboard() {
  const { user, loading, logout } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login?returnTo=" + encodeURIComponent(location)); return; }
    if ((user as any).role !== "supplier") navigate("/admin");
  }, [user, loading, navigate, location]);

  const isSupplier = !!user && (user as any).role === "supplier";

  const { data: supplier } = trpc.supplierPortal.getMySupplier.useQuery(undefined, { enabled: isSupplier });
  const { data: products = [], isLoading: prodLoading } = trpc.supplierPortal.getMyProducts.useQuery(undefined, { enabled: isSupplier });
  const { data: salesData, isLoading: salesLoading } = trpc.supplierPortal.getMySales.useQuery(undefined, { enabled: isSupplier });
  const { data: settlements = [] } = trpc.supplierPortal.getMySettlements.useQuery(undefined, { enabled: isSupplier });

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080e1c]">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }
  if (!isSupplier) return null;

  const summary = salesData?.summary;
  const sales = salesData?.sales ?? [];
  const supplierName = (supplier as any)?.commercialName || (supplier as any)?.fiscalName || "Proveedor";

  return (
    <div className="min-h-screen text-white bg-[#080e1c]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a1628]/95 border-b border-white/[0.07] backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
          <img src={LOGO} alt="Skicenter" className="h-7 w-auto object-contain" />
          <div className="hidden sm:flex flex-col items-center">
            <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">{supplierName}</span>
            <span className="text-[11px] text-white/40">{(user as any).name ?? (user as any).email}</span>
          </div>
          <button
            onClick={() => logout().then(() => navigate("/login"))}
            className="text-white/30 hover:text-white/70 transition-colors p-1.5"
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="mb-8">
          <p className="text-white/40 text-sm mb-1 uppercase tracking-widest font-medium">Portal de Proveedor</p>
          <h1 className="text-3xl font-bold text-white">Hola, {supplierName}</h1>
          <p className="text-white/40 text-sm mt-1.5">Ventas de tus productos por todos los canales</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <StatCard icon={<TrendingUp className="w-4 h-4" />} value={summary?.totalSales ?? 0} label="Ventas" sublabel="pagadas" color="orange" />
          <StatCard icon={<Euro className="w-4 h-4" />} value={summary ? eur(summary.totalRevenueEur) : "—"} label="Ingresos" sublabel="brutos" color="emerald" />
          <StatCard icon={<Package className="w-4 h-4" />} value={products.length} label="Productos" sublabel="tuyos" color="violet" />
        </div>

        {/* Ventas por canal */}
        <Section title="Ventas por canal">
          {salesLoading ? <Spinner /> : !summary || summary.byChannel.length === 0 ? (
            <Empty text="Aún no hay ventas registradas de tus productos." />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.byChannel.map(c => (
                <div key={c.channel} className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-white/40 uppercase tracking-wide">{CHANNEL_LABEL[c.channel] ?? c.channel}</p>
                  <p className="text-2xl font-bold text-white mt-1">{eur(c.revenueEur)}</p>
                  <p className="text-xs text-white/40 mt-0.5">{c.count} venta{c.count !== 1 ? "s" : ""}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Detalle de ventas */}
        <Section title="Detalle de ventas">
          {salesLoading ? <Spinner /> : sales.length === 0 ? (
            <Empty text="Sin ventas todavía." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-white/40 text-xs">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Producto</th>
                    <th className="text-left px-4 py-2.5 font-medium">Canal</th>
                    <th className="text-left px-4 py-2.5 font-medium">Fecha</th>
                    <th className="text-center px-4 py-2.5 font-medium">Pax</th>
                    <th className="text-right px-4 py-2.5 font-medium">Importe</th>
                    <th className="text-center px-4 py-2.5 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map(s => (
                    <tr key={s.id} className="border-t border-white/[0.06]">
                      <td className="px-4 py-2.5 text-white/80">{s.productName}</td>
                      <td className="px-4 py-2.5 text-white/60">{CHANNEL_LABEL[s.channel ?? "OTRO"] ?? s.channel}{s.platformName ? ` · ${s.platformName}` : ""}</td>
                      <td className="px-4 py-2.5 text-white/60">{s.bookingDate}</td>
                      <td className="px-4 py-2.5 text-center text-white/60">{s.people}</td>
                      <td className="px-4 py-2.5 text-right text-white/80 font-medium">{eur(s.amountEur)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full ${STATUS[s.status ?? ""]?.cls ?? "bg-gray-500/15 text-gray-400"}`}>
                          {STATUS[s.status ?? ""]?.label ?? s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Productos */}
        <Section title="Tus productos">
          {prodLoading ? <Spinner /> : products.length === 0 ? (
            <Empty text="No tienes productos vinculados todavía." />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {products.map(p => (
                <div key={`${p.type}-${p.id}`} className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                  <span className="text-[10px] uppercase tracking-wide text-orange-400/80">{p.type}</span>
                  <p className="text-white font-semibold mt-1">{p.title}</p>
                  <p className="text-xs text-white/40 mt-0.5">{p.basePrice ? eur(parseFloat(String(p.basePrice))) : "—"}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Liquidaciones */}
        <Section title="Liquidaciones">
          {settlements.length === 0 ? (
            <Empty text="Sin liquidaciones emitidas." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-white/40 text-xs">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Nº</th>
                    <th className="text-left px-4 py-2.5 font-medium">Periodo</th>
                    <th className="text-right px-4 py-2.5 font-medium">Neto proveedor</th>
                    <th className="text-center px-4 py-2.5 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(settlements as any[]).map(s => (
                    <tr key={s.id} className="border-t border-white/[0.06]">
                      <td className="px-4 py-2.5 text-white/80">{s.settlementNumber}</td>
                      <td className="px-4 py-2.5 text-white/60">{s.periodFrom} → {s.periodTo}</td>
                      <td className="px-4 py-2.5 text-right text-white/80 font-medium">{eur(parseFloat(String(s.netAmountProvider ?? 0)))}</td>
                      <td className="px-4 py-2.5 text-center text-white/60">{SETTLEMENT_STATUS[s.status] ?? s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </main>

      <footer className="border-t border-white/[0.06] py-4 mt-8">
        <div className="max-w-5xl mx-auto px-4 text-[11px] text-white/25">
          Portal de Proveedores · Skicenter
        </div>
      </footer>
    </div>
  );
}

function StatCard({ icon, value, label, sublabel, color }: { icon: React.ReactNode; value: React.ReactNode; label: string; sublabel: string; color: string }) {
  const colors: Record<string, string> = {
    orange: "text-orange-400 bg-orange-500/10 border-orange-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  };
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border ${colors[color]}`}>{icon}</div>
      <p className="text-2xl font-bold text-white mt-2">{value}</p>
      <p className="text-xs text-white/40">{label} · {sublabel}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-3 flex items-center gap-2">
        <Receipt className="w-4 h-4 text-white/30" /> {title}
      </h2>
      {children}
    </section>
  );
}

function Spinner() { return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>; }
function Empty({ text }: { text: string }) { return <p className="text-white/40 text-sm py-6 text-center bg-white/[0.02] border border-white/[0.06] rounded-xl">{text}</p>; }
