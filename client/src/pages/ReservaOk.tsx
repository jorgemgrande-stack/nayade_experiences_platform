/**
 * Página /reserva/ok
 * Redsys redirige aquí tras un pago exitoso.
 * IMPORTANTE: Esta página NO marca la reserva como pagada.
 * El estado se actualiza únicamente en el endpoint IPN (/api/redsys/notification).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";

export default function ReservaOk() {
  const [merchantOrder, setMerchantOrder] = useState<string | null>(null);

  useEffect(() => {
    // Redsys puede enviar Ds_Order como query param en la URL de retorno
    const params = new URLSearchParams(window.location.search);
    const order = params.get("Ds_Order") ?? params.get("order");
    if (order) setMerchantOrder(order);
  }, []);

  const { data: reservation } = trpc.reservations.getStatus.useQuery(
    { merchantOrder: merchantOrder! },
    { enabled: !!merchantOrder, refetchInterval: 3000, retry: false }
  );

  return (
    <PublicLayout>
      <section style={{
        minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center",
        padding: "3rem 1rem",
      }}>
        <div style={{
          maxWidth: "520px", width: "100%", textAlign: "center",
          background: "#fff", borderRadius: "1.5rem", padding: "3rem 2rem",
          boxShadow: "0 20px 60px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
        }}>
          {/* Icono animado */}
          <div style={{
            width: "80px", height: "80px", borderRadius: "50%",
            background: "linear-gradient(135deg, #16a34a, #15803d)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 1.5rem",
            boxShadow: "0 8px 24px rgba(22,163,74,0.3)",
          }}>
            <span style={{ fontSize: "2.5rem" }}>✓</span>
          </div>

          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#1a1a1a", marginBottom: "0.75rem" }}>
            ¡Pago completado!
          </h1>

          <p style={{ color: "#6b7280", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Tu pago ha sido procesado correctamente. Recibirás un email de confirmación
            con todos los detalles de tu reserva en breve.
          </p>

          {/* Estado de la reserva */}
          {merchantOrder && (
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "0.75rem",
              padding: "1rem", marginBottom: "1.5rem",
            }}>
              {reservation ? (
                <div>
                  <div style={{ fontWeight: 700, color: "#15803d", marginBottom: "0.5rem" }}>
                    {reservation.productName}
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#374151" }}>
                    📅 {reservation.bookingDate} · 👥 {reservation.people} persona{reservation.people !== 1 ? "s" : ""}
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#374151", marginTop: "0.25rem" }}>
                    💶 Total: <strong>{parseFloat(String(reservation.amountTotal)).toFixed(2)}€</strong>
                  </div>
                  <div style={{
                    display: "inline-block", marginTop: "0.5rem",
                    padding: "0.25rem 0.75rem", borderRadius: "9999px",
                    background: reservation.status === "paid" ? "#dcfce7" : "#fef3c7",
                    color: reservation.status === "paid" ? "#15803d" : "#92400e",
                    fontSize: "0.75rem", fontWeight: 700,
                  }}>
                    {reservation.status === "paid" ? "✓ Confirmada" : "⏳ Procesando..."}
                  </div>
                </div>
              ) : (
                <div style={{ color: "#6b7280", fontSize: "0.875rem" }}>
                  <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⏳</span>
                  {" "}Verificando estado de la reserva...
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/">
              <button style={{
                padding: "0.75rem 1.5rem", borderRadius: "0.5rem",
                background: "linear-gradient(135deg, #f97316, #ea580c)",
                border: "none", color: "#fff", fontWeight: 700, cursor: "pointer",
                boxShadow: "0 4px 12px rgba(249,115,22,0.4)",
              }}>
                Volver al inicio
              </button>
            </Link>
            <Link href="/experiencias">
              <button style={{
                padding: "0.75rem 1.5rem", borderRadius: "0.5rem",
                background: "transparent", border: "1.5px solid #d1d5db",
                color: "#374151", fontWeight: 600, cursor: "pointer",
              }}>
                Ver más experiencias
              </button>
            </Link>
          </div>

          <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "1.5rem" }}>
            ¿Tienes alguna duda? Escríbenos a{" "}
            <a href="mailto:hola@nayadeexperiences.es" style={{ color: "#f97316" }}>
              hola@nayadeexperiences.es
            </a>
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}
