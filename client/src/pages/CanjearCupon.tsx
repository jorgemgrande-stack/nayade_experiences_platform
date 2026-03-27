/**
 * CanjearCupon — Página pública de canje de cupones Groupon / Wonderbox / etc.
 * Diseño coherente con BudgetRequest: hero split + formulario glass flotante
 */
import React, { useState, useRef } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Ticket, Upload, X, AlertTriangle,
  Shield, Zap, Star, ArrowRight, Info, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Assets ───────────────────────────────────────────────────────────────────
const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1774088145054-jpwq7l.png";

// ─── Proveedores soportados ───────────────────────────────────────────────────
const PROVIDERS = [
  { id: "Groupon", label: "Groupon", logo: "🎟️" },
  { id: "Wonderbox", label: "Wonderbox", logo: "🎁" },
  { id: "SmartBox", label: "SmartBox", logo: "📦" },
  { id: "Otro", label: "Otro proveedor", logo: "🎫" },
];

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface FormState {
  provider: string;
  productTicketingId: string;
  customerName: string;
  email: string;
  phone: string;
  couponCode: string;
  securityCode: string;
  requestedDate: string;
  station: string;
  participants: number;
  children: number;
  comments: string;
}

interface FormErrors {
  customerName?: string;
  email?: string;
  couponCode?: string;
  requestedDate?: string;
  attachment?: string;
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CanjearCupon() {
  const [form, setForm] = useState<FormState>({
    provider: "Groupon",
    productTicketingId: "",
    customerName: "",
    email: "",
    phone: "",
    couponCode: "",
    securityCode: "",
    requestedDate: "",
    station: "",
    participants: 1,
    children: 0,
    comments: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cargar productos ticketing activos para el proveedor seleccionado
  const { data: products } = trpc.ticketing.listActiveProducts.useQuery(
    { provider: form.provider },
    { enabled: !!form.provider }
  );

  // Mutation de canje
  const createRedemption = trpc.ticketing.createRedemption.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (err) => {
      if (err.message.includes("ya ha sido registrado")) {
        toast.error("Este cupón ya fue registrado. Si crees que es un error, contáctanos.");
      } else {
        toast.error("Error al enviar la solicitud. Inténtalo de nuevo.");
      }
    },
  });

  // Upload de adjunto al S3 via endpoint
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setErrors((p) => ({ ...p, attachment: "El archivo no puede superar 10MB" }));
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setErrors((p) => ({ ...p, attachment: "Solo se admiten imágenes (JPG, PNG, WEBP) o PDF" }));
      return;
    }

    setAttachmentFile(file);
    setErrors((p) => ({ ...p, attachment: "" }));
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload-coupon", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json() as { url: string };
      setAttachmentUrl(url);
    } catch {
      toast.error("Error al subir el archivo. Puedes continuar sin adjunto.");
      setAttachmentUrl("");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = () => {
    setAttachmentFile(null);
    setAttachmentUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const validate = (): boolean => {
    const errs: FormErrors = {};
    if (!form.customerName.trim()) errs.customerName = "El nombre es obligatorio";
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Email inválido";
    if (!form.couponCode.trim()) errs.couponCode = "El código del cupón es obligatorio";
    if (!form.requestedDate) errs.requestedDate = "Selecciona una fecha aproximada";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    createRedemption.mutate({
      provider: form.provider,
      productTicketingId: form.productTicketingId ? parseInt(form.productTicketingId) : undefined,
      customerName: form.customerName,
      email: form.email,
      phone: form.phone || undefined,
      couponCode: form.couponCode.trim().toUpperCase(),
      securityCode: form.securityCode.trim() || undefined,
      attachmentUrl: attachmentUrl || undefined,
      requestedDate: form.requestedDate || undefined,
      station: form.station || undefined,
      participants: form.participants,
      children: form.children,
      comments: form.comments || undefined,
    });
  };

  const set = (field: keyof FormState, value: string | number) => {
    setForm((p) => ({ ...p, [field]: value }));
    if (field in errors) setErrors((p) => ({ ...p, [field]: "" }));
  };

  // ─── Pantalla de éxito ────────────────────────────────────────────────────
  if (submitted) {
    return (
      <PublicLayout>
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
          <img src={HERO_BG} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div className="relative z-10 text-center max-w-xl mx-auto px-6 py-20">
            <div className="w-24 h-24 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center mx-auto mb-8">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
            </div>
            <h2 className="text-5xl font-heading font-bold text-white mb-4">¡Recibido!</h2>
            <p className="text-xl text-white/75 mb-3 font-display">Tu solicitud de canje está en proceso.</p>
            <p className="text-white/55 mb-10 leading-relaxed">
              Nuestro equipo revisará tu cupón y te confirmará la reserva en
              <strong className="text-amber-400"> menos de 24 horas</strong>.
            </p>
            <div className="bg-white/[0.08] rounded-2xl p-5 mb-8 text-left border border-white/10">
              <p className="text-white/40 text-xs mb-3 font-display uppercase tracking-wider">Resumen de tu solicitud</p>
              <div className="space-y-2 text-sm text-white/70">
                <div className="flex justify-between">
                  <span className="text-white/40">Proveedor</span>
                  <span className="font-medium">{form.provider}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Código cupón</span>
                  <span className="font-mono font-medium text-amber-300">{form.couponCode.toUpperCase()}</span>
                </div>
                {form.requestedDate && (
                  <div className="flex justify-between">
                    <span className="text-white/40">Fecha solicitada</span>
                    <span className="font-medium">{new Date(form.requestedDate + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-white/40">Participantes</span>
                  <span className="font-medium">{form.participants} adultos{form.children > 0 ? ` · ${form.children} niños` : ""}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-10">
              {[
                { icon: Zap, label: "Respuesta rápida" },
                { icon: Star, label: "Confirmación segura" },
                { icon: Shield, label: "Sin coste extra" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="bg-white/10 rounded-2xl p-4 border border-white/10 text-center">
                  <Icon className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                  <span className="text-white/60 text-xs">{label}</span>
                </div>
              ))}
            </div>
            <Button asChild className="bg-amber-500 hover:bg-amber-400 text-white font-semibold h-12 px-8 rounded-full">
              <Link href="/">Explorar más experiencias <ArrowRight className="ml-2 w-4 h-4" /></Link>
            </Button>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // ─── Formulario principal ─────────────────────────────────────────────────
  return (
    <PublicLayout>
      {/* ══════════════════════════════════════════════════════════════════════
          HERO SPLIT — Pantalla completa: claim izquierda + formulario derecha
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-stretch overflow-hidden">

        {/* Fondo */}
        <img
          src={HERO_BG}
          alt="Náyade Experiences"
          className="absolute inset-0 w-full h-full object-cover object-center"
          style={{ animation: "slowZoom 25s ease-in-out infinite alternate" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

        {/* Contenido split */}
        <div className="relative z-10 container flex flex-col lg:flex-row items-center gap-8 lg:gap-12 py-24 lg:py-0 min-h-screen">

          {/* ── Columna izquierda: Claim ─────────────────────────────────── */}
          <div className="flex-1 text-white lg:py-24">
            <span className="inline-flex items-center gap-2 bg-amber-500/90 text-white text-xs font-display font-bold uppercase tracking-widest px-5 py-2 rounded-full mb-6 shadow-lg">
              <Ticket className="w-3.5 h-3.5" />
              Canje de cupones · Groupon & más
            </span>

            <h1 className="text-4xl md:text-5xl xl:text-6xl font-heading font-black leading-[1.05] mb-5">
              Canjea tu cupón<br />
              <span className="text-amber-400">sin complicaciones</span>
            </h1>

            <p className="text-lg md:text-xl text-white/70 font-display font-light mb-8 leading-relaxed max-w-md">
              Tienes un cupón de Groupon, Wonderbox u otro proveedor para una experiencia en Náyade. Rellena el formulario y nosotros nos encargamos de todo.
            </p>

            {/* Chips de proveedores */}
            <div className="flex flex-wrap gap-2 mb-8">
              {PROVIDERS.map(({ id, label, logo }) => (
                <div key={id} className="flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-full px-3 py-1.5 text-xs text-white/75">
                  <span>{logo}</span>
                  {label}
                </div>
              ))}
            </div>

            {/* Trust pills */}
            <div className="flex flex-col gap-2">
              {[
                { icon: Zap, text: "Confirmación en menos de 24h" },
                { icon: Shield, text: "Validación segura del cupón" },
                { icon: Star, text: "Sin coste adicional al canje" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-sm text-white/55">
                  <Icon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  {text}
                </div>
              ))}
            </div>

            {/* Nota informativa */}
            <div className="mt-8 flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 max-w-md">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-white/55 text-xs leading-relaxed">
                El canje está sujeto a disponibilidad. Te recomendamos solicitar la fecha con al menos <strong className="text-white/70">7 días de antelación</strong>. Los cupones caducados no son válidos.
              </p>
            </div>
          </div>

          {/* ── Columna derecha: Formulario glass flotante ───────────────── */}
          <div className="w-full lg:w-[480px] xl:w-[520px] shrink-0 lg:py-8">
            <div
              className="rounded-3xl overflow-hidden shadow-2xl"
              style={{
                background: "rgba(10, 20, 40, 0.85)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06) inset",
              }}
            >
              {/* Barra superior degradada */}
              <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500" />

              {/* Encabezado */}
              <div className="px-7 pt-6 pb-4 border-b border-white/[0.07]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                    <Ticket className="w-4.5 h-4.5 text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-heading font-bold text-xl">Solicitud de canje</h2>
                    <p className="text-white/45 text-sm mt-0.5">Confirmaremos tu reserva en menos de 24h</p>
                  </div>
                </div>
              </div>

              {/* Formulario con scroll interno */}
              <div className="overflow-y-auto max-h-[calc(100vh-260px)] lg:max-h-[calc(100vh-200px)]">
                <form onSubmit={handleSubmit} className="px-7 py-5 space-y-5">

                  {/* Proveedor */}
                  <div>
                    <Label className="text-white/50 text-xs mb-2 block">Proveedor del cupón <span className="text-amber-400">*</span></Label>
                    <div className="grid grid-cols-2 gap-2">
                      {PROVIDERS.map(({ id, label, logo }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => { set("provider", id); set("productTicketingId", ""); }}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-all ${
                            form.provider === id
                              ? "bg-amber-500/15 border-amber-500/50 text-amber-300"
                              : "bg-white/[0.04] border-white/10 text-white/50 hover:border-white/20 hover:text-white/70"
                          }`}
                        >
                          <span>{logo}</span>
                          <span className="font-medium">{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Producto / Experiencia */}
                  {products && products.length > 0 && (
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Experiencia del cupón</Label>
                      <div className="relative">
                        <select
                          value={form.productTicketingId}
                          onChange={(e) => set("productTicketingId", e.target.value)}
                          className="w-full h-10 bg-white/[0.07] border border-white/10 text-white rounded-xl text-sm px-3 pr-8 appearance-none focus:border-amber-500/50 focus:outline-none"
                          style={{ background: "rgba(255,255,255,0.07)" }}
                        >
                          <option value="" style={{ background: "#0a1428" }}>Selecciona la experiencia…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id} style={{ background: "#0a1428" }}>{p.name}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                      </div>
                    </div>
                  )}

                  {/* Nombre + Email */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Nombre <span className="text-amber-400">*</span></Label>
                      <Input
                        value={form.customerName}
                        onChange={(e) => set("customerName", e.target.value)}
                        className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.customerName ? "border-red-400/60" : ""}`}
                        placeholder="Tu nombre"
                      />
                      {errors.customerName && <p className="text-red-400 text-xs mt-1">{errors.customerName}</p>}
                    </div>
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Email <span className="text-amber-400">*</span></Label>
                      <Input
                        type="email"
                        value={form.email}
                        onChange={(e) => set("email", e.target.value)}
                        className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.email ? "border-red-400/60" : ""}`}
                        placeholder="tu@email.com"
                      />
                      {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                    </div>
                  </div>

                  {/* Teléfono + Fecha */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Teléfono</Label>
                      <Input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => set("phone", e.target.value)}
                        className="h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50"
                        placeholder="+34 600 000 000"
                      />
                    </div>
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Fecha preferida <span className="text-amber-400">*</span></Label>
                      <Input
                        type="date"
                        value={form.requestedDate}
                        min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                        onChange={(e) => set("requestedDate", e.target.value)}
                        className={`h-10 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-amber-500/50 [color-scheme:dark] ${errors.requestedDate ? "border-red-400/60" : ""}`}
                      />
                      {errors.requestedDate && <p className="text-red-400 text-xs mt-1">{errors.requestedDate}</p>}
                    </div>
                  </div>

                  {/* Código cupón + Código seguridad */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Código del cupón <span className="text-amber-400">*</span></Label>
                      <Input
                        value={form.couponCode}
                        onChange={(e) => set("couponCode", e.target.value.toUpperCase())}
                        className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm font-mono focus:border-amber-500/50 ${errors.couponCode ? "border-red-400/60" : ""}`}
                        placeholder="GRP-XXXXXX"
                      />
                      {errors.couponCode && <p className="text-red-400 text-xs mt-1">{errors.couponCode}</p>}
                    </div>
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Código de seguridad</Label>
                      <Input
                        value={form.securityCode}
                        onChange={(e) => set("securityCode", e.target.value.toUpperCase())}
                        className="h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm font-mono focus:border-amber-500/50"
                        placeholder="SEC-XXXX"
                      />
                    </div>
                  </div>

                  {/* Participantes */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Adultos</Label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => set("participants", Math.max(1, form.participants - 1))}
                          className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/10 text-white/60 hover:bg-white/10 transition-all flex items-center justify-center text-lg leading-none"
                        >−</button>
                        <span className="flex-1 text-center text-white font-medium text-sm">{form.participants}</span>
                        <button
                          type="button"
                          onClick={() => set("participants", form.participants + 1)}
                          className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/10 text-white/60 hover:bg-white/10 transition-all flex items-center justify-center text-lg leading-none"
                        >+</button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Niños</Label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => set("children", Math.max(0, form.children - 1))}
                          className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/10 text-white/60 hover:bg-white/10 transition-all flex items-center justify-center text-lg leading-none"
                        >−</button>
                        <span className="flex-1 text-center text-white font-medium text-sm">{form.children}</span>
                        <button
                          type="button"
                          onClick={() => set("children", form.children + 1)}
                          className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/10 text-white/60 hover:bg-white/10 transition-all flex items-center justify-center text-lg leading-none"
                        >+</button>
                      </div>
                    </div>
                  </div>

                  {/* Adjunto del cupón */}
                  <div>
                    <Label className="text-white/50 text-xs mb-1.5 block">
                      Adjuntar cupón (opcional pero recomendado)
                    </Label>
                    {!attachmentFile ? (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full h-16 rounded-xl border-2 border-dashed border-white/15 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/25 transition-all flex items-center justify-center gap-3 text-white/40 hover:text-white/60"
                      >
                        <Upload className="w-4 h-4" />
                        <span className="text-sm">Subir imagen o PDF del cupón</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 bg-white/[0.06] border border-white/10 rounded-xl px-4 py-3">
                        {uploading ? (
                          <div className="w-4 h-4 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          </div>
                        )}
                        <span className="flex-1 text-white/60 text-xs truncate">{attachmentFile.name}</span>
                        <button type="button" onClick={removeFile} className="text-white/30 hover:text-white/60 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    {errors.attachment && (
                      <p className="flex items-center gap-1 text-red-400 text-xs mt-1">
                        <AlertTriangle className="w-3 h-3" />
                        {errors.attachment}
                      </p>
                    )}
                    <p className="text-white/25 text-xs mt-1">JPG, PNG, WEBP o PDF · Máx. 10MB · Agiliza la validación</p>
                  </div>

                  {/* Comentarios */}
                  <div>
                    <Label className="text-white/50 text-xs mb-1.5 block">Comentarios (opcional)</Label>
                    <Textarea
                      value={form.comments}
                      onChange={(e) => set("comments", e.target.value)}
                      className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm resize-none"
                      rows={2}
                      placeholder="Preferencias de horario, necesidades especiales…"
                    />
                  </div>

                  {/* Submit */}
                  <Button
                    type="submit"
                    disabled={createRedemption.isPending || uploading}
                    className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-white font-semibold rounded-2xl text-sm shadow-lg shadow-amber-500/20 transition-all"
                  >
                    {createRedemption.isPending ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Enviando solicitud…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Ticket className="w-4 h-4" />
                        Solicitar canje de cupón
                      </span>
                    )}
                  </Button>

                  <p className="text-center text-white/25 text-xs">
                    Sin compromiso · Respuesta en &lt;24h ·{" "}
                    <Link href="/privacidad" className="underline hover:text-white/40 transition-colors">Privacidad</Link>
                  </p>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sección informativa inferior ──────────────────────────────────────── */}
      <section className="bg-[#0a1428] py-16 border-t border-white/[0.06]">
        <div className="container max-w-4xl">
          <h3 className="text-white font-heading font-bold text-2xl mb-8 text-center">¿Cómo funciona el canje?</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Rellena el formulario",
                desc: "Introduce los datos de tu cupón y la fecha preferida para la experiencia.",
                color: "text-amber-400",
              },
              {
                step: "02",
                title: "Validamos tu cupón",
                desc: "Nuestro equipo verifica el código con el proveedor y confirma la disponibilidad.",
                color: "text-sky-400",
              },
              {
                step: "03",
                title: "¡A disfrutar!",
                desc: "Recibirás la confirmación por email con todos los detalles de tu reserva.",
                color: "text-emerald-400",
              },
            ].map(({ step, title, desc, color }) => (
              <div key={step} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6">
                <div className={`text-4xl font-heading font-black ${color} mb-3 opacity-60`}>{step}</div>
                <h4 className="text-white font-semibold mb-2">{title}</h4>
                <p className="text-white/45 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* FAQ rápido */}
          <div className="mt-10 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6">
            <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-400" />
              Preguntas frecuentes
            </h4>
            <div className="space-y-4 text-sm">
              {[
                {
                  q: "¿Qué proveedores son válidos?",
                  a: "Aceptamos cupones de Groupon, Wonderbox, SmartBox y otros proveedores de experiencias. Si tienes dudas, contáctanos.",
                },
                {
                  q: "¿Cuánto tiempo tengo para canjear?",
                  a: "Depende de la fecha de caducidad de tu cupón. Revisa las condiciones del proveedor. Recomendamos canjear con al menos 7 días de antelación.",
                },
                {
                  q: "¿Puedo cambiar la fecha una vez confirmada?",
                  a: "Sí, con 48h de antelación y sujeto a disponibilidad. Contacta con nosotros en reservas@nayadeexperiences.es.",
                },
              ].map(({ q, a }) => (
                <div key={q} className="border-b border-white/[0.06] pb-4 last:border-0 last:pb-0">
                  <p className="text-white/70 font-medium mb-1">{q}</p>
                  <p className="text-white/40 leading-relaxed">{a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
