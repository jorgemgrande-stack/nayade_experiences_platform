/**
 * Panel Admin — Gestión de Reservas Redsys
 * Ruta: /admin/operaciones/reservas
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import {
  CreditCard, Search, Filter, Download, Eye, X,
  CheckCircle, Clock, XCircle, AlertCircle, Ban,
  Phone, Mail, Calendar, Users, Euro,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft:           { label: "Borrador",       color: "#6b7280", bg: "#f3f4f6", icon: <AlertCircle className="w-3.5 h-3.5" /> },
  pending_payment: { label: "Pago pendiente", color: "#d97706", bg: "#fef3c7", icon: <Clock className="w-3.5 h-3.5" /> },
  paid:            { label: "Pagada",         color: "#16a34a", bg: "#dcfce7", icon: <CheckCircle className="w-3.5 h-3.5" /> },
  failed:          { label: "Fallida",        color: "#dc2626", bg: "#fee2e2", icon: <XCircle className="w-3.5 h-3.5" /> },
  cancelled:       { label: "Cancelada",      color: "#6b7280", bg: "#f3f4f6", icon: <Ban className="w-3.5 h-3.5" /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "3px 10px", borderRadius: "9999px",
      background: cfg.bg, color: cfg.color,
      fontSize: "0.75rem", fontWeight: 600,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function formatDate(ts: number | string | null | undefined) {
  if (!ts) return "—";
  return new Date(Number(ts)).toLocaleDateString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatAmount(cents: number | null | undefined) {
  if (!cents) return "—";
  return (cents / 100).toFixed(2) + "€";
}

// ─── Exportación CSV ─────────────────────────────────────────────────────────

function exportToCSV(data: any[]) {
  const headers = [
    "ID", "Fecha", "Producto", "Cliente", "Email", "Teléfono",
    "Personas", "Fecha Actividad", "Total", "Estado", "Merchant Order",
  ];
  const rows = data.map((r) => [
    r.id,
    formatDate(r.createdAt),
    r.productName,
    r.customerName,
    r.customerEmail,
    r.customerPhone ?? "",
    r.people,
    r.bookingDate,
    formatAmount(r.amountTotal),
    STATUS_CONFIG[r.status]?.label ?? r.status,
    r.merchantOrder,
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reservas-nayade-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Modal de detalle ────────────────────────────────────────────────────────

function ReservationDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading } = trpc.reservations.getById.useQuery({ id });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "1rem",
    }}>
      <div style={{
        background: "#fff", borderRadius: "1rem", padding: "2rem",
        maxWidth: "600px", width: "100%", maxHeight: "90vh", overflowY: "auto",
        position: "relative",
      }}>
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: "1rem", right: "1rem",
            background: "none", border: "none", cursor: "pointer", color: "#6b7280",
          }}
        >
          <X className="w-5 h-5" />
        </button>

        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1.5rem", color: "#111" }}>
          Detalle de Reserva #{id}
        </h2>

        {isLoading && <p style={{ color: "#6b7280" }}>Cargando...</p>}

        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Estado */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, color: "#374151" }}>Estado</span>
              <StatusBadge status={data.status} />
            </div>

            {/* Producto */}
            <div style={{ background: "#f9fafb", borderRadius: "0.75rem", padding: "1rem" }}>
              <h3 style={{ fontWeight: 600, color: "#111", marginBottom: "0.75rem" }}>Producto</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.875rem" }}>
                <span style={{ color: "#6b7280" }}>Actividad</span>
                <span style={{ fontWeight: 500 }}>{data.productName}</span>
                <span style={{ color: "#6b7280" }}>Fecha actividad</span>
                <span style={{ fontWeight: 500 }}>{data.bookingDate}</span>
                <span style={{ color: "#6b7280" }}>Personas</span>
                <span style={{ fontWeight: 500 }}>{data.people}</span>
                <span style={{ color: "#6b7280" }}>Total</span>
                <span style={{ fontWeight: 700, color: "#16a34a" }}>{formatAmount(data.amountTotal)}</span>
              </div>
            </div>

            {/* Cliente */}
            <div style={{ background: "#f9fafb", borderRadius: "0.75rem", padding: "1rem" }}>
              <h3 style={{ fontWeight: 600, color: "#111", marginBottom: "0.75rem" }}>Cliente</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Users className="w-4 h-4 text-gray-400" />
                  <span>{data.customerName}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Mail className="w-4 h-4 text-gray-400" />
                  <a href={`mailto:${data.customerEmail}`} style={{ color: "#f97316" }}>{data.customerEmail}</a>
                </div>
                {data.customerPhone && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Phone className="w-4 h-4 text-gray-400" />
                    <a href={`tel:${data.customerPhone}`} style={{ color: "#f97316" }}>{data.customerPhone}</a>
                  </div>
                )}
              </div>
            </div>

            {/* Extras */}
            {data.extrasJson && data.extrasJson !== "[]" && (
              <div style={{ background: "#f9fafb", borderRadius: "0.75rem", padding: "1rem" }}>
                <h3 style={{ fontWeight: 600, color: "#111", marginBottom: "0.75rem" }}>Extras</h3>
                <pre style={{ fontSize: "0.8rem", color: "#374151", whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(JSON.parse(data.extrasJson), null, 2)}
                </pre>
              </div>
            )}

            {/* Datos técnicos Redsys */}
            <div style={{ background: "#f9fafb", borderRadius: "0.75rem", padding: "1rem" }}>
              <h3 style={{ fontWeight: 600, color: "#111", marginBottom: "0.75rem" }}>Datos técnicos</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.8rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#6b7280" }}>Merchant Order</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 500 }}>{data.merchantOrder}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#6b7280" }}>Creada</span>
                  <span>{formatDate(data.createdAt)}</span>
                </div>
                {data.paidAt && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#6b7280" }}>Pagada</span>
                    <span>{formatDate(data.paidAt)}</span>
                  </div>
                )}
                {data.redsysResponse && (
                  <div>
                    <span style={{ color: "#6b7280", display: "block", marginBottom: "0.25rem" }}>Respuesta Redsys</span>
                    <pre style={{ fontSize: "0.75rem", background: "#e5e7eb", padding: "0.5rem", borderRadius: "0.5rem", overflowX: "auto" }}>
                      {data.redsysResponse}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function ReservationsManager() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const PAGE_SIZE = 20;

  const { data: reservations = [], isLoading, refetch } = trpc.reservations.getAll.useQuery({
    status: statusFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  // Filtrado local por búsqueda de texto
  const filtered = reservations.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.customerName?.toLowerCase().includes(q) ||
      r.customerEmail?.toLowerCase().includes(q) ||
      r.productName?.toLowerCase().includes(q) ||
      r.merchantOrder?.toLowerCase().includes(q)
    );
  });

  // Estadísticas rápidas
  const stats = {
    total: reservations.length,
    paid: reservations.filter((r) => r.status === "paid").length,
    pending: reservations.filter((r) => r.status === "pending_payment").length,
    failed: reservations.filter((r) => r.status === "failed").length,
    revenue: reservations
      .filter((r) => r.status === "paid")
      .reduce((sum, r) => sum + (r.amountTotal ?? 0), 0),
  };

  return (
    <AdminLayout title="Reservas Redsys">
      <div style={{ padding: "1.5rem", maxWidth: "1400px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111", marginBottom: "0.25rem" }}>
              Reservas Redsys
            </h1>
            <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
              Gestión de reservas con pago online
            </p>
          </div>
          <button
            onClick={() => exportToCSV(filtered)}
            style={{
              display: "flex", alignItems: "center", gap: "0.5rem",
              padding: "0.625rem 1.25rem", borderRadius: "0.5rem",
              background: "linear-gradient(135deg, #f97316, #f59e0b)",
              border: "none", color: "#fff", fontWeight: 600,
              cursor: "pointer", fontSize: "0.875rem",
            }}
          >
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
          {[
            { label: "Total reservas", value: stats.total, icon: <CreditCard className="w-5 h-5" />, color: "#6366f1" },
            { label: "Pagadas", value: stats.paid, icon: <CheckCircle className="w-5 h-5" />, color: "#16a34a" },
            { label: "Pendientes", value: stats.pending, icon: <Clock className="w-5 h-5" />, color: "#d97706" },
            { label: "Fallidas", value: stats.failed, icon: <XCircle className="w-5 h-5" />, color: "#dc2626" },
            { label: "Ingresos", value: formatAmount(stats.revenue), icon: <Euro className="w-5 h-5" />, color: "#16a34a" },
          ].map((s) => (
            <div key={s.label} style={{
              background: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.75rem",
              padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: s.color }}>
                {s.icon}
                <span style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 500 }}>{s.label}</span>
              </div>
              <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111" }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 240px" }}>
            <Search className="w-4 h-4" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
            <input
              type="text"
              placeholder="Buscar por cliente, email, producto..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%", paddingLeft: "2.25rem", paddingRight: "0.75rem",
                paddingTop: "0.5rem", paddingBottom: "0.5rem",
                border: "1px solid #d1d5db", borderRadius: "0.5rem",
                fontSize: "0.875rem", outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ position: "relative" }}>
            <Filter className="w-4 h-4" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              style={{
                paddingLeft: "2.25rem", paddingRight: "1rem",
                paddingTop: "0.5rem", paddingBottom: "0.5rem",
                border: "1px solid #d1d5db", borderRadius: "0.5rem",
                fontSize: "0.875rem", background: "#fff", cursor: "pointer",
              }}
            >
              <option value="">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="pending_payment">Pago pendiente</option>
              <option value="paid">Pagada</option>
              <option value="failed">Fallida</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </div>
          <button
            onClick={() => refetch()}
            style={{
              padding: "0.5rem 1rem", borderRadius: "0.5rem",
              border: "1px solid #d1d5db", background: "#fff",
              cursor: "pointer", fontSize: "0.875rem", color: "#374151",
            }}
          >
            Actualizar
          </button>
        </div>

        {/* Tabla */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.75rem", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  {["Fecha", "Producto", "Cliente", "Email", "Teléfono", "Personas", "Total", "Estado", "Merchant Order", ""].map((h) => (
                    <th key={h} style={{
                      padding: "0.75rem 1rem", textAlign: "left",
                      fontWeight: 600, color: "#374151", whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={10} style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>
                      Cargando reservas...
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>
                      <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" style={{ display: "block", margin: "0 auto 0.5rem" }} />
                      No hay reservas con los filtros actuales
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "0.75rem 1rem", whiteSpace: "nowrap", color: "#374151" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        <Calendar className="w-3.5 h-3.5 text-gray-400" />
                        {formatDate(r.createdAt)}
                      </div>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontWeight: 500, color: "#111", maxWidth: "180px" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.productName}
                      </div>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "#374151" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        <Users className="w-3.5 h-3.5 text-gray-400" />
                        {r.customerName}
                      </div>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "#374151" }}>
                      <a href={`mailto:${r.customerEmail}`} style={{ color: "#f97316", textDecoration: "none" }}>
                        {r.customerEmail}
                      </a>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "#374151" }}>
                      {r.customerPhone ? (
                        <a href={`tel:${r.customerPhone}`} style={{ color: "#374151", textDecoration: "none" }}>
                          {r.customerPhone}
                        </a>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "center", color: "#374151" }}>
                      {r.people}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontWeight: 600, color: r.status === "paid" ? "#16a34a" : "#374151" }}>
                      {formatAmount(r.amountTotal)}
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#6b7280" }}>
                      {r.merchantOrder}
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <button
                        onClick={() => setSelectedId(r.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.25rem",
                          padding: "0.375rem 0.75rem", borderRadius: "0.375rem",
                          border: "1px solid #d1d5db", background: "#fff",
                          cursor: "pointer", fontSize: "0.75rem", color: "#374151",
                        }}
                      >
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "0.75rem 1rem", borderTop: "1px solid #e5e7eb",
            background: "#f9fafb", fontSize: "0.875rem", color: "#6b7280",
          }}>
            <span>
              Mostrando {filtered.length} de {reservations.length} reservas
              {statusFilter && ` (filtro: ${STATUS_CONFIG[statusFilter]?.label})`}
            </span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                style={{
                  padding: "0.375rem 0.75rem", borderRadius: "0.375rem",
                  border: "1px solid #d1d5db", background: page === 0 ? "#f3f4f6" : "#fff",
                  cursor: page === 0 ? "not-allowed" : "pointer", color: page === 0 ? "#9ca3af" : "#374151",
                }}
              >
                ← Anterior
              </button>
              <span style={{ padding: "0.375rem 0.75rem", fontWeight: 600 }}>
                Pág. {page + 1}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={reservations.length < PAGE_SIZE}
                style={{
                  padding: "0.375rem 0.75rem", borderRadius: "0.375rem",
                  border: "1px solid #d1d5db",
                  background: reservations.length < PAGE_SIZE ? "#f3f4f6" : "#fff",
                  cursor: reservations.length < PAGE_SIZE ? "not-allowed" : "pointer",
                  color: reservations.length < PAGE_SIZE ? "#9ca3af" : "#374151",
                }}
              >
                Siguiente →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de detalle */}
      {selectedId !== null && (
        <ReservationDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </AdminLayout>
  );
}
