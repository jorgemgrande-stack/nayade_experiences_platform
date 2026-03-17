/**
 * Página /reserva/error
 * Redsys redirige aquí cuando el pago es cancelado o falla.
 * IMPORTANTE: La reserva permanece en estado "failed" según lo que
 * haya notificado Redsys al endpoint IPN. Esta página solo informa al usuario.
 */
import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";

export default function ReservaError() {
  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get("Ds_Response") ?? params.get("code");

  const getErrorMessage = (code: string | null) => {
    if (!code) return "El pago no pudo completarse.";
    const n = parseInt(code);
    if (n === 9915) return "El usuario canceló el pago.";
    if (n >= 101 && n <= 199) return "Tarjeta caducada o datos incorrectos.";
    if (n >= 200 && n <= 299) return "Fondos insuficientes.";
    if (n >= 900 && n <= 999) return "Error en el proceso de pago. Inténtalo de nuevo.";
    return "El pago fue rechazado por el banco.";
  };

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
          {/* Icono */}
          <div style={{
            width: "80px", height: "80px", borderRadius: "50%",
            background: "linear-gradient(135deg, #dc2626, #b91c1c)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 1.5rem",
            boxShadow: "0 8px 24px rgba(220,38,38,0.3)",
          }}>
            <span style={{ fontSize: "2.5rem" }}>✕</span>
          </div>

          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#1a1a1a", marginBottom: "0.75rem" }}>
            Pago no completado
          </h1>

          <p style={{ color: "#6b7280", marginBottom: "1rem", lineHeight: 1.6 }}>
            {getErrorMessage(errorCode)}
          </p>

          {errorCode && (
            <div style={{
              background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem",
              padding: "0.75rem", marginBottom: "1.5rem",
              fontSize: "0.8rem", color: "#dc2626",
            }}>
              Código de respuesta: <strong>{errorCode}</strong>
            </div>
          )}

          <p style={{ color: "#6b7280", marginBottom: "2rem", fontSize: "0.9rem" }}>
            Tu reserva ha quedado guardada pero <strong>no se ha realizado ningún cargo</strong>.
            Puedes intentarlo de nuevo o contactarnos para ayudarte.
          </p>

          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/experiencias">
              <button style={{
                padding: "0.75rem 1.5rem", borderRadius: "0.5rem",
                background: "linear-gradient(135deg, #f97316, #ea580c)",
                border: "none", color: "#fff", fontWeight: 700, cursor: "pointer",
                boxShadow: "0 4px 12px rgba(249,115,22,0.4)",
              }}>
                Intentar de nuevo
              </button>
            </Link>
            <Link href="/contacto">
              <button style={{
                padding: "0.75rem 1.5rem", borderRadius: "0.5rem",
                background: "transparent", border: "1.5px solid #d1d5db",
                color: "#374151", fontWeight: 600, cursor: "pointer",
              }}>
                Contactar con nosotros
              </button>
            </Link>
          </div>

          <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "1.5rem" }}>
            ¿Necesitas ayuda? Llámanos al{" "}
            <a href="tel:+34919041947" style={{ color: "#f97316" }}>+34 919 041 947</a>
            {" "}o escríbenos a{" "}
            <a href="mailto:hola@nayadeexperiences.es" style={{ color: "#f97316" }}>
              hola@nayadeexperiences.es
            </a>
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}
