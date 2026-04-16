/**
 * BookingModal — Flujo de reserva con pago Redsys
 * Pasos: 1) Fecha + Personas + Variante  2) Extras  3) Datos cliente  4) Resumen + Pagar
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
    hasTimeSlots?: boolean;
    pricingType?: "per_person" | "per_unit";
    unitCapacity?: number;
    maxUnits?: number;
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
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Time slots (optional, retrocompatible)
  const [selectedTimeSlotId, setSelectedTimeSlotId] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>("");

  // Cargar variantes del producto
  const { data: variants } = trpc.public.getVariantsByExperience.useQuery(
    { experienceId: product.id },
    { enabled: isOpen }
  );

  // Cargar time slots (solo si el producto los tiene)
  const { data: timeSlots } = trpc.timeSlots.getByProduct.useQuery(
    { productId: product.id },
    { enabled: isOpen && !!product.hasTimeSlots }
  );
  const hasTimeSlotConfig = !!product.hasTimeSlots && (timeSlots?.length ?? 0) > 0;
  // Detectar el tipo de slot (todos deben ser del mismo tipo para un producto)
  const slotType = timeSlots?.[0]?.type ?? "fixed";

  const hasVariants = (variants?.length ?? 0) > 0;
  const selectedVariant = variants?.find(v => v.id === selectedVariantId) ?? null;

  // Calcular precio efectivo por persona
  const basePrice = parseFloat(String(product.basePrice ?? 0));
  const effectivePricePerPerson = useMemo(() => {
    if (!selectedVariant) return basePrice;
    const mod = parseFloat(String(selectedVariant.priceModifier ?? 0));
    if (selectedVariant.priceType === "percentage") {
      return basePrice + (basePrice * mod / 100);
    }
    // fixed o per_person: el valor es el precio directo
    return mod;
  }, [selectedVariant, basePrice]);

  const isPerUnit = product.pricingType === "per_unit" && product.unitCapacity && product.unitCapacity > 0;
  const unitsNeeded = isPerUnit ? Math.ceil(people / product.unitCapacity!) : people;

  const extrasTotal = useMemo(() =>
    extras.reduce((sum, e) => sum + (selectedExtras[e.name] ?? 0) * e.price, 0),
    [extras, selectedExtras]
  );
  const estimatedTotal = effectivePricePerPerson * unitsNeeded + extrasTotal;

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
        variantId: selectedVariantId ?? undefined,
        extras: extrasPayload,
        customerName,
        customerEmail,
        customerPhone: customerPhone || undefined,
        notes: notes || undefined,
        origin: window.location.origin,
        // Time slots (optional, retrocompatible)
        selectedTimeSlotId: selectedTimeSlotId ?? undefined,
        selectedTime: selectedTime || undefined,
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
    if (step === "datetime") {
      if (!bookingDate || people < (product.minPersons ?? 1)) return false;
      // Si hay variantes obligatorias, debe seleccionarse una
      const hasRequired = variants?.some(v => v.isRequired);
      if (hasRequired && !selectedVariantId) return false;
      // Si el producto tiene time slots, debe seleccionarse uno
      if (hasTimeSlotConfig) {
        if (slotType === "fixed" || slotType === "range") {
          if (!selectedTimeSlotId) return false;
        } else if (slotType === "flexible") {
          if (!selectedTime) return false;
        }
      }
      return true;
    }
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
                Desde {effectivePricePerPerson.toFixed(2)}€/persona
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
          {/* Step 1: Fecha, personas y variante */}
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

              {/* Selector de variante (si hay variantes) */}
              {hasVariants && (
                <div>
                  <label style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
                    Tipo de tarifa {variants?.some(v => v.isRequired) ? "*" : "(opcional)"}
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {!variants?.some(v => v.isRequired) && (
                      <label
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "0.75rem 1rem", border: `1.5px solid ${selectedVariantId === null ? "#f97316" : "#d1d5db"}`,
                          borderRadius: "0.5rem", cursor: "pointer",
                          background: selectedVariantId === null ? "#fff7ed" : "#fff",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                          <input
                            type="radio"
                            name="variant"
                            checked={selectedVariantId === null}
                            onChange={() => setSelectedVariantId(null)}
                            style={{ accentColor: "#f97316" }}
                          />
                          <div>
                            <div style={{ fontWeight: 600, color: "#1a1a1a", fontSize: "0.9rem" }}>Precio base</div>
                            <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>Tarifa estándar</div>
                          </div>
                        </div>
                        <span style={{ fontWeight: 700, color: "#f97316", fontSize: "1rem" }}>
                          {basePrice.toFixed(2)}€
                        </span>
                      </label>
                    )}
                    {variants?.map(v => {
                      const mod = parseFloat(String(v.priceModifier ?? 0));
                      const displayPrice = v.priceType === "percentage"
                        ? basePrice + (basePrice * mod / 100)
                        : mod;
                      const isSelected = selectedVariantId === v.id;
                      return (
                        <label
                          key={v.id}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "0.75rem 1rem", border: `1.5px solid ${isSelected ? "#f97316" : "#d1d5db"}`,
                            borderRadius: "0.5rem", cursor: "pointer",
                            background: isSelected ? "#fff7ed" : "#fff",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <input
                              type="radio"
                              name="variant"
                              checked={isSelected}
                              onChange={() => setSelectedVariantId(v.id)}
                              style={{ accentColor: "#f97316" }}
                            />
                            <div>
                              <div style={{ fontWeight: 600, color: "#1a1a1a", fontSize: "0.9rem" }}>
                                {v.name}
                                {v.isRequired && (
                                  <span style={{ marginLeft: "0.4rem", fontSize: "0.7rem", color: "#f97316", fontWeight: 400 }}>
                                    (obligatorio)
                                  </span>
                                )}
                              </div>
                              {v.description && (
                                <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>{v.description}</div>
                              )}
                            </div>
                          </div>
                          <span style={{ fontWeight: 700, color: "#f97316", fontSize: "1rem" }}>
                            {displayPrice.toFixed(2)}€
                            {v.priceType === "percentage" && (
                              <span style={{ fontWeight: 400, fontSize: "0.75rem", color: "#9ca3af", marginLeft: "0.25rem" }}>
                                ({mod > 0 ? "+" : ""}{mod}%)
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Time Slots Selector (solo si el producto los tiene) */}
              {hasTimeSlotConfig && (
                <div>
                  <label style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
                    Horario *
                  </label>
                  {slotType === "flexible" ? (
                    // Tipo flexible: input de hora libre
                    <div>
                      <input
                        type="time"
                        value={selectedTime}
                        onChange={e => setSelectedTime(e.target.value)}
                        style={{
                          width: "100%", padding: "0.75rem", border: "1.5px solid #d1d5db",
                          borderRadius: "0.5rem", fontSize: "1rem", outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                      <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#6b7280" }}>
                        Elige la hora a la que deseas realizar la actividad
                      </p>
                    </div>
                  ) : (
                    // Tipo fixed o range: botones de selección
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {timeSlots?.map(slot => {
                        const isSelected = selectedTimeSlotId === slot.id;
                        const slotLabel = slot.startTime
                          ? (slot.endTime ? `${slot.label} (${slot.startTime}–${slot.endTime})` : `${slot.label} (${slot.startTime})`)
                          : slot.label;
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => setSelectedTimeSlotId(slot.id)}
                            style={{
                              padding: "0.6rem 1rem",
                              border: `1.5px solid ${isSelected ? "#f97316" : "#d1d5db"}`,
                              borderRadius: "0.5rem",
                              background: isSelected ? "#fff7ed" : "#fff",
                              color: isSelected ? "#c2410c" : "#374151",
                              fontWeight: isSelected ? 700 : 400,
                              fontSize: "0.9rem",
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            {slotLabel}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div style={{
                background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "0.5rem",
                padding: "0.75rem 1rem",
              }}>
                <span style={{ color: "#9a3412", fontSize: "0.875rem" }}>
                  💡 Subtotal estimado: <strong>{(effectivePricePerPerson * unitsNeeded).toFixed(2)}€</strong>
                  {" "}({effectivePricePerPerson.toFixed(2)}€ × {isPerUnit
                    ? `${unitsNeeded} unidad${unitsNeeded !== 1 ? "es" : ""} (${people} pers.)`
                    : `${people} persona${people !== 1 ? "s" : ""}`})
                  {selectedVariant && (
                    <span style={{ color: "#6b7280" }}> — tarifa: {selectedVariant.name}</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Step 2: Extras */}
          {step === "extras" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {extras.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✨</div>
                  <p style={{ fontWeight: 600, color: "#374151" }}>No hay extras disponibles</p>
                  <p style={{ fontSize: "0.875rem", marginTop: "0.25rem" }}>Puedes continuar al siguiente paso.</p>
                </div>
              ) : (
                extras.map(extra => (
                  <div key={extra.name} style={{
                    padding: "1rem", border: "1.5px solid #e5e7eb", borderRadius: "0.75rem",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
                  }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: 600, color: "#1a1a1a", fontSize: "0.95rem" }}>{extra.name}</p>
                      {extra.description && (
                        <p style={{ margin: "0.2rem 0 0", color: "#6b7280", fontSize: "0.8rem" }}>{extra.description}</p>
                      )}
                      <p style={{ margin: "0.2rem 0 0", color: "#f97316", fontWeight: 700, fontSize: "0.9rem" }}>
                        +{extra.price}€/ud
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <button
                        onClick={() => handleExtraChange(extra.name, (selectedExtras[extra.name] ?? 0) - 1)}
                        style={{
                          width: "32px", height: "32px", borderRadius: "50%",
                          border: "1.5px solid #d1d5db", background: "#f9fafb",
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "1.1rem",
                        }}
                      >−</button>
                      <span style={{ minWidth: "1.5rem", textAlign: "center", fontWeight: 700 }}>
                        {selectedExtras[extra.name] ?? 0}
                      </span>
                      <button
                        onClick={() => handleExtraChange(extra.name, (selectedExtras[extra.name] ?? 0) + 1)}
                        style={{
                          width: "32px", height: "32px", borderRadius: "50%",
                          border: "1.5px solid #d1d5db", background: "#f9fafb",
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "1.1rem",
                        }}
                      >+</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Step 3: Datos cliente */}
          {step === "customer" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
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
                  {isPerUnit && (
                    <Row label="Unidades" value={`${unitsNeeded} unidad${unitsNeeded !== 1 ? "es" : ""} (${product.unitCapacity} pers./unidad)`} />
                  )}
                  {/* Mostrar horario si está seleccionado */}
                  {hasTimeSlotConfig && selectedTimeSlotId && (
                    <Row label="Horario" value={timeSlots?.find(s => s.id === selectedTimeSlotId)?.label ?? ""} />
                  )}
                  {hasTimeSlotConfig && slotType === "flexible" && selectedTime && (
                    <Row label="Hora elegida" value={selectedTime} />
                  )}
                  {selectedVariant && (
                    <Row label="Tarifa" value={selectedVariant.name} />
                  )}
                  <Row
                    label={isPerUnit ? "Precio por unidad" : "Precio por persona"}
                    value={`${effectivePricePerPerson.toFixed(2)}€ × ${unitsNeeded} = ${(effectivePricePerPerson * unitsNeeded).toFixed(2)}€`}
                  />
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
