/**
 * BookingModal — Flujo de reserva con pago Redsys
 * Pasos: 1) Fecha + Personas  2) Extras  3) Datos cliente  4) Resumen + Pagar
 * El importe se calcula en backend. El frontend solo muestra el total estimado.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";

interface Extra {
  name: string;
  price: number;
  description?: string;
}

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    id: number;
    title: string;
    basePrice: string | number;
    duration?: string;
    minPersons?: number;
    maxPersons?: number;
    image1?: string;
  };
  /** Extras disponibles para este producto (opcional) */
  extras?: Extra[];
}

type Step = "datetime" | "extras" | "customer" | "summary";

const STEPS: { id: Step; label: string }[] = [
  { id: "datetime", label: "Fecha y personas" },
  { id: "extras", label: "Extras" },
  { id: "customer", label: "Tus datos" },
  { id: "summary", label: "Resumen" },
];

export default function BookingModal({ isOpen, onClose, product, extras = [] }: BookingModalProps) {
  const [step, setStep] = useState<Step>("datetime");
  const [bookingDate, setBookingDate] = useState("");
  const [people, setPeople] = useState(product.minPersons ?? 1);
  const [selectedExtras, setSelectedExtras] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const basePrice = parseFloat(String(product.basePrice ?? 0));
  const extrasTotal = useMemo(() =>
    extras.reduce((sum, e) => sum + (selectedExtras[e.name] ?? 0) * e.price, 0),
    [extras, selectedExtras]
  );
  const estimatedTotal = basePrice * people + extrasTotal;

  const createAndPay = trpc.reservations.createAndPay.useMutation();

  const today = new Date().toISOString().split("T")[0];

  const handleExtraChange = (name: string, qty: number) => {
    setSelectedExtras(prev => ({ ...prev, [name]: Math.max(0, qty) }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const extrasPayload = extras
        .filter(e => (selectedExtras[e.name] ?? 0) > 0)
        .map(e => ({ name: e.name, price: e.price, quantity: selectedExtras[e.name] }));

      const result = await createAndPay.mutateAsync({
        productId: product.id,
        bookingDate,
        people,
        extras: extrasPayload,
        customerName,
        customerEmail,
        customerPhone: customerPhone || undefined,
        notes: notes || undefined,
        origin: window.location.origin,
      });

      // Construir y enviar el formulario Redsys automáticamente
      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.redsysForm.url;
      form.style.display = "none";

      const fields = {
        Ds_SignatureVersion: result.redsysForm.Ds_SignatureVersion,
        Ds_MerchantParameters: result.redsysForm.Ds_MerchantParameters,
        Ds_Signature: result.redsysForm.Ds_Signature,
      };

      for (const [key, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al procesar la reserva";
      setError(msg);
      setIsSubmitting(false);
    }
  };

  const canGoNext = () => {
    if (step === "datetime") return bookingDate !== "" && people >= (product.minPersons ?? 1);
    if (step === "extras") return true;
    if (step === "customer") return customerName.length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail);
    return true;
  };

  const goNext = () => {
    const idx = STEPS.findIndex(s => s.id === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].id);
  };

  const goPrev = () => {
    const idx = STEPS.findIndex(s => s.id === step);
    if (idx > 0) setStep(STEPS[idx - 1].id);
  };

  if (!isOpen) return null;

  const currentStepIdx = STEPS.findIndex(s => s.id === step);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#fff", borderRadius: "1rem", width: "100%", maxWidth: "560px",
          maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#1a1a1a" }}>
                Reservar: {product.title}
              </h2>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#666" }}>
                Desde {basePrice}€/persona
                {product.duration && ` · ${product.duration}`}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: "1.5rem", color: "#999", padding: "0.25rem",
                lineHeight: 1,
              }}
            >×</button>
          </div>

          {/* Progress steps */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            {STEPS.map((s, idx) => (
              <div key={s.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                <div style={{
                  width: "100%", height: "4px", borderRadius: "2px",
                  background: idx <= currentStepIdx ? "#f97316" : "#e5e7eb",
                  transition: "background 0.3s",
                }} />
                <span style={{
                  fontSize: "0.65rem", color: idx <= currentStepIdx ? "#f97316" : "#9ca3af",
                  fontWeight: idx === currentStepIdx ? 600 : 400,
                  textAlign: "center",
                }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
          {/* Step 1: Fecha y personas */}
          {step === "datetime" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
                  Fecha de la actividad *
                </label>
                <input
                  type="date"
                  min={today}
                  value={bookingDate}
                  onChange={e => setBookingDate(e.target.value)}
                  style={{
                    width: "100%", padding: "0.75rem", border: "1.5px solid #d1d5db",
                    borderRadius: "0.5rem", fontSize: "1rem", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
                  Número de personas *
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <button
                    onClick={() => setPeople(p => Math.max(product.minPersons ?? 1, p - 1))}
                    style={{
                      width: "40px", height: "40px", borderRadius: "50%",
                      border: "1.5px solid #d1d5db", background: "#f9fafb",
                      fontSize: "1.25rem", cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center",
                    }}
                  >−</button>
                  <span style={{ fontSize: "1.5rem", fontWeight: 700, minWidth: "2rem", textAlign: "center" }}>
                    {people}
                  </span>
                  <button
                    onClick={() => setPeople(p => Math.min(product.maxPersons ?? 100, p + 1))}
                    style={{
                      width: "40px", height: "40px", borderRadius: "50%",
                      border: "1.5px solid #d1d5db", background: "#f9fafb",
                      fontSize: "1.25rem", cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center",
                    }}
                  >+</button>
                  <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>
                    {product.minPersons && product.maxPersons
                      ? `(${product.minPersons}–${product.maxPersons} personas)`
                      : "personas"}
                  </span>
                </div>
              </div>
              <div style={{
                background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "0.5rem",
                padding: "0.75rem 1rem",
              }}>
                <span style={{ color: "#9a3412", fontSize: "0.875rem" }}>
                  💡 Subtotal estimado: <strong>{(basePrice * people).toFixed(2)}€</strong>
                  {" "}({basePrice}€ × {people} persona{people !== 1 ? "s" : ""})
                </span>
              </div>
            </div>
          )}

          {/* Step 2: Extras */}
          {step === "extras" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {extras.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✓</div>
                  <p>No hay extras disponibles para esta actividad.</p>
                  <p style={{ fontSize: "0.875rem" }}>Pulsa "Siguiente" para continuar.</p>
                </div>
              ) : (
                extras.map(extra => (
                  <div key={extra.name} style={{
                    border: "1.5px solid #e5e7eb", borderRadius: "0.75rem",
                    padding: "1rem", display: "flex", justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "#1a1a1a" }}>{extra.name}</div>
                      {extra.description && (
                        <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.2rem" }}>
                          {extra.description}
                        </div>
                      )}
                      <div style={{ color: "#f97316", fontWeight: 700, marginTop: "0.25rem" }}>
                        +{extra.price}€/ud
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <button
                        onClick={() => handleExtraChange(extra.name, (selectedExtras[extra.name] ?? 0) - 1)}
                        style={{
                          width: "32px", height: "32px", borderRadius: "50%",
                          border: "1.5px solid #d1d5db", background: "#f9fafb",
                          cursor: "pointer", fontSize: "1rem",
                        }}
                      >−</button>
                      <span style={{ fontWeight: 600, minWidth: "1.5rem", textAlign: "center" }}>
                        {selectedExtras[extra.name] ?? 0}
                      </span>
                      <button
                        onClick={() => handleExtraChange(extra.name, (selectedExtras[extra.name] ?? 0) + 1)}
                        style={{
                          width: "32px", height: "32px", borderRadius: "50%",
                          border: "1.5px solid #d1d5db", background: "#f9fafb",
                          cursor: "pointer", fontSize: "1rem",
                        }}
                      >+</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Step 3: Datos del cliente */}
          {step === "customer" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "0.4rem", color: "#374151" }}>
                  Nombre completo *
                </label>
                <input
                  type="text"
                  placeholder="Tu nombre y apellidos"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  style={{
                    width: "100%", padding: "0.75rem", border: "1.5px solid #d1d5db",
                    borderRadius: "0.5rem", fontSize: "1rem", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "0.4rem", color: "#374151" }}>
                  Email *
                </label>
                <input
                  type="email"
                  placeholder="tu@email.com"
                  value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  style={{
                    width: "100%", padding: "0.75rem", border: "1.5px solid #d1d5db",
                    borderRadius: "0.5rem", fontSize: "1rem", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "0.4rem", color: "#374151" }}>
                  Teléfono (opcional)
                </label>
                <input
                  type="tel"
                  placeholder="+34 600 000 000"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  style={{
                    width: "100%", padding: "0.75rem", border: "1.5px solid #d1d5db",
                    borderRadius: "0.5rem", fontSize: "1rem", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "0.4rem", color: "#374151" }}>
                  Notas adicionales (opcional)
                </label>
                <textarea
                  placeholder="Alergias, necesidades especiales, nivel de experiencia..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%", padding: "0.75rem", border: "1.5px solid #d1d5db",
                    borderRadius: "0.5rem", fontSize: "1rem", outline: "none",
                    boxSizing: "border-box", resize: "vertical",
                  }}
                />
              </div>
            </div>
          )}

          {/* Step 4: Resumen */}
          {step === "summary" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{
                background: "#f9fafb", borderRadius: "0.75rem", padding: "1.25rem",
                border: "1px solid #e5e7eb",
              }}>
                <h3 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 700, color: "#1a1a1a" }}>
                  Resumen de tu reserva
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  <Row label="Actividad" value={product.title} />
                  <Row label="Fecha" value={bookingDate} />
                  <Row label="Personas" value={`${people} persona${people !== 1 ? "s" : ""}`} />
                  <Row label="Precio base" value={`${basePrice}€ × ${people} = ${(basePrice * people).toFixed(2)}€`} />
                  {extras.filter(e => (selectedExtras[e.name] ?? 0) > 0).map(e => (
                    <Row
                      key={e.name}
                      label={`Extra: ${e.name}`}
                      value={`${e.price}€ × ${selectedExtras[e.name]} = ${(e.price * (selectedExtras[e.name] ?? 0)).toFixed(2)}€`}
                    />
                  ))}
                  <div style={{ borderTop: "1px solid #d1d5db", paddingTop: "0.6rem", marginTop: "0.4rem" }}>
                    <Row
                      label="TOTAL ESTIMADO"
                      value={`${estimatedTotal.toFixed(2)}€`}
                      bold
                      accent
                    />
                  </div>
                </div>
              </div>

              <div style={{
                background: "#f9fafb", borderRadius: "0.75rem", padding: "1.25rem",
                border: "1px solid #e5e7eb",
              }}>
                <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem", fontWeight: 700, color: "#1a1a1a" }}>
                  Datos del cliente
                </h3>
                <Row label="Nombre" value={customerName} />
                <Row label="Email" value={customerEmail} />
                {customerPhone && <Row label="Teléfono" value={customerPhone} />}
              </div>

              <div style={{
                background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "0.5rem",
                padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#92400e",
              }}>
                🔒 El pago se procesará de forma segura a través de <strong>Redsys TPV</strong>.
                Serás redirigido al banco para completar la transacción.
                El importe final será confirmado por el servidor.
              </div>

              {error && (
                <div style={{
                  background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem",
                  padding: "0.75rem 1rem", color: "#dc2626", fontSize: "0.875rem",
                }}>
                  ⚠️ {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "1rem 1.5rem", borderTop: "1px solid #f0f0f0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: "1rem",
        }}>
          <button
            onClick={step === "datetime" ? onClose : goPrev}
            style={{
              padding: "0.75rem 1.5rem", borderRadius: "0.5rem",
              border: "1.5px solid #d1d5db", background: "#fff",
              cursor: "pointer", fontWeight: 600, color: "#374151",
              fontSize: "0.9rem",
            }}
          >
            {step === "datetime" ? "Cancelar" : "← Atrás"}
          </button>

          {step !== "summary" ? (
            <button
              onClick={goNext}
              disabled={!canGoNext()}
              style={{
                padding: "0.75rem 2rem", borderRadius: "0.5rem",
                background: canGoNext() ? "linear-gradient(135deg, #f97316, #ea580c)" : "#d1d5db",
                border: "none", cursor: canGoNext() ? "pointer" : "not-allowed",
                fontWeight: 700, color: "#fff", fontSize: "0.9rem",
                boxShadow: canGoNext() ? "0 4px 12px rgba(249,115,22,0.4)" : "none",
              }}
            >
              Siguiente →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{
                padding: "0.75rem 2rem", borderRadius: "0.5rem",
                background: isSubmitting ? "#d1d5db" : "linear-gradient(135deg, #16a34a, #15803d)",
                border: "none", cursor: isSubmitting ? "not-allowed" : "pointer",
                fontWeight: 700, color: "#fff", fontSize: "0.9rem",
                boxShadow: isSubmitting ? "none" : "0 4px 12px rgba(22,163,74,0.4)",
                display: "flex", alignItems: "center", gap: "0.5rem",
              }}
            >
              {isSubmitting ? (
                <>
                  <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⏳</span>
                  Procesando...
                </>
              ) : (
                "🔒 Pagar reserva"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>{label}</span>
      <span style={{
        fontWeight: bold ? 700 : 500,
        color: accent ? "#f97316" : "#1a1a1a",
        fontSize: bold ? "1rem" : "0.875rem",
      }}>{value}</span>
    </div>
  );
}
