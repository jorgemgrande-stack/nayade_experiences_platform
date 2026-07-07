import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, CloudLightning, HeartPulse, Car, XCircle, HelpCircle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const REASONS = [
  { value: "meteorologicas", label: "Condiciones meteorológicas adversas", icon: CloudLightning },
  { value: "accidente", label: "Accidente o lesión", icon: Car },
  { value: "enfermedad", label: "Enfermedad o causa médica", icon: HeartPulse },
  { value: "desistimiento", label: "Desistimiento voluntario", icon: XCircle },
  { value: "otra", label: "Otra causa", icon: HelpCircle },
];

export default function SolicitarAnulacion() {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    activityDate: "",
    reason: "" as "meteorologicas" | "accidente" | "enfermedad" | "desistimiento" | "otra" | "",
    reasonDetail: "",
    locator: "",
    termsChecked: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [requestId, setRequestId] = useState<number | null>(null);

  const createRequest = trpc.cancellations.createRequest.useMutation({
    onSuccess: (data) => {
      setRequestId(data.requestId);
      setSubmitted(true);
    },
    onError: (err) => {
      setErrors({ general: err.message });
    },
  });

  function validate() {
    const e: Record<string, string> = {};
    if (!form.fullName.trim() || form.fullName.length < 2) e.fullName = "El nombre es obligatorio (mín. 2 caracteres)";
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Introduce un email válido";
    if (!form.activityDate) e.activityDate = "La fecha de la actividad es obligatoria";
    if (!form.reason) e.reason = "Selecciona el motivo de la anulación";
    if (form.reason === "otra" && !form.reasonDetail.trim()) e.reasonDetail = "Explica el motivo de la anulación";
    if (!form.termsChecked) e.termsChecked = "Debes aceptar los términos y condiciones";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    createRequest.mutate({
      fullName: form.fullName,
      email: form.email,
      phone: form.phone || undefined,
      activityDate: form.activityDate,
      reason: form.reason as "meteorologicas" | "accidente" | "enfermedad" | "desistimiento" | "otra",
      reasonDetail: form.reasonDetail || undefined,
      locator: form.locator || undefined,
      termsChecked: form.termsChecked,
      originUrl: window.location.href,
    });
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Solicitud recibida</h1>
          <p className="text-gray-400 mb-2">
            Hemos registrado tu solicitud de anulación con el número de referencia:
          </p>
          <div className="bg-[#1a1a1a] border border-orange-500/30 rounded-xl px-6 py-4 mb-6 inline-block">
            <span className="text-orange-400 text-2xl font-bold">#{requestId}</span>
          </div>
          <p className="text-gray-400 text-sm mb-8">
            Recibirás un email de confirmación en <strong className="text-white">{form.email}</strong>.
            Nuestro equipo revisará tu solicitud y te contactará en el menor tiempo posible.
          </p>
          <Link href="/">
            <Button variant="outline" className="gap-2 border-gray-700 text-gray-300 hover:bg-gray-800">
              <ArrowLeft className="w-4 h-4" />
              Volver al inicio
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-orange-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Solicitud de Anulación</h1>
          <p className="text-gray-400 max-w-lg mx-auto">
            Completa el formulario para solicitar la anulación de tu actividad o reserva. Nuestro equipo
            revisará tu caso y te responderá en el menor tiempo posible.
          </p>
        </div>

        {/* Aviso informativo */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 mb-8 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-200/80 text-sm leading-relaxed">
            Las anulaciones están sujetas a los términos y condiciones de Náyade Experiences. La aceptación
            de la solicitud dependerá del motivo y la documentación aportada.
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="bg-[#111] border border-white/5 rounded-2xl p-8 space-y-6">
          {/* Datos personales */}
          <div>
            <h2 className="text-white font-semibold text-lg mb-4 pb-2 border-b border-white/5">
              Datos del solicitante
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label htmlFor="fullName" className="text-gray-300 mb-1.5 block">
                  Nombre completo <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  placeholder="Tu nombre y apellidos"
                  className={`bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600 ${errors.fullName ? "border-red-500" : ""}`}
                />
                {errors.fullName && <p className="text-red-400 text-xs mt-1">{errors.fullName}</p>}
              </div>
              <div>
                <Label htmlFor="email" className="text-gray-300 mb-1.5 block">
                  Email <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="tu@email.com"
                  className={`bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600 ${errors.email ? "border-red-500" : ""}`}
                />
                {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
              </div>
              <div>
                <Label htmlFor="phone" className="text-gray-300 mb-1.5 block">
                  Teléfono <span className="text-gray-500 text-xs">(opcional)</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+34 600 000 000"
                  className="bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600"
                />
              </div>
            </div>
          </div>

          {/* Datos de la reserva */}
          <div>
            <h2 className="text-white font-semibold text-lg mb-4 pb-2 border-b border-white/5">
              Datos de la reserva
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="activityDate" className="text-gray-300 mb-1.5 block">
                  Fecha de la actividad <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="activityDate"
                  type="date"
                  value={form.activityDate}
                  onChange={(e) => setForm({ ...form, activityDate: e.target.value })}
                  className={`bg-[#1a1a1a] border-white/10 text-white [color-scheme:dark] ${errors.activityDate ? "border-red-500" : ""}`}
                />
                {errors.activityDate && <p className="text-red-400 text-xs mt-1">{errors.activityDate}</p>}
              </div>
              <div>
                <Label htmlFor="locator" className="text-gray-300 mb-1.5 block">
                  Nº de reserva / localizador <span className="text-gray-500 text-xs">(si lo tienes)</span>
                </Label>
                <Input
                  id="locator"
                  value={form.locator}
                  onChange={(e) => setForm({ ...form, locator: e.target.value })}
                  placeholder="Ej: NAY-2025-001234"
                  className="bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600"
                />
              </div>
            </div>
          </div>

          {/* Motivo */}
          <div>
            <h2 className="text-white font-semibold text-lg mb-4 pb-2 border-b border-white/5">
              Motivo de la anulación
            </h2>
            <div className="mb-4">
              <Label className="text-gray-300 mb-2 block">
                Motivo principal <span className="text-red-400">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {REASONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm({ ...form, reason: value as typeof form.reason })}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      form.reason === value
                        ? "border-orange-500 bg-orange-500/10 text-orange-300"
                        : "border-white/10 bg-[#1a1a1a] text-gray-400 hover:border-white/20 hover:text-gray-300"
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">{label}</span>
                  </button>
                ))}
              </div>
              {errors.reason && <p className="text-red-400 text-xs mt-2">{errors.reason}</p>}
            </div>

            {(form.reason === "otra" || form.reason) && (
              <div>
                <Label htmlFor="reasonDetail" className="text-gray-300 mb-1.5 block">
                  {form.reason === "otra" ? (
                    <>Explica el motivo <span className="text-red-400">*</span></>
                  ) : (
                    "Información adicional (opcional)"
                  )}
                </Label>
                <Textarea
                  id="reasonDetail"
                  value={form.reasonDetail}
                  onChange={(e) => setForm({ ...form, reasonDetail: e.target.value })}
                  placeholder={
                    form.reason === "otra"
                      ? "Describe el motivo de la anulación..."
                      : "Añade cualquier información relevante sobre tu caso..."
                  }
                  rows={4}
                  className={`bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600 resize-none ${errors.reasonDetail ? "border-red-500" : ""}`}
                />
                {errors.reasonDetail && <p className="text-red-400 text-xs mt-1">{errors.reasonDetail}</p>}
              </div>
            )}
          </div>

          {/* Términos */}
          <div className={`flex items-start gap-3 p-4 rounded-xl border ${errors.termsChecked ? "border-red-500/50 bg-red-500/5" : "border-white/5 bg-[#1a1a1a]"}`}>
            <Checkbox
              id="terms"
              checked={form.termsChecked}
              onCheckedChange={(v) => setForm({ ...form, termsChecked: !!v })}
              className="mt-0.5"
            />
            <label htmlFor="terms" className="text-gray-400 text-sm leading-relaxed cursor-pointer">
              He leído y acepto los{" "}
              <a href="/terminos-y-condiciones" target="_blank" className="text-orange-400 hover:underline">
                términos y condiciones
              </a>{" "}
              de Náyade Experiences, incluyendo la política de anulaciones y devoluciones.
              <span className="text-red-400 ml-1">*</span>
            </label>
          </div>
          {errors.termsChecked && <p className="text-red-400 text-xs -mt-4">{errors.termsChecked}</p>}

          {/* Error general */}
          {errors.general && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">
              {errors.general}
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            disabled={createRequest.isPending}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl transition-all"
          >
            {createRequest.isPending ? "Enviando solicitud..." : "Enviar solicitud de anulación"}
          </Button>
        </form>

        {/* Footer */}
        <p className="text-center text-gray-600 text-sm mt-6">
          ¿Tienes dudas? Contacta con nosotros en{" "}
          <a href="mailto:reservas@nayadeexperiences.es" className="text-orange-400 hover:underline">
            reservas@nayadeexperiences.es
          </a>
        </p>
      </div>
    </div>
  );
}
