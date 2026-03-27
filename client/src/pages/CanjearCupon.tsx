/**
 * CanjearCupon — Página pública de canje de cupones Groupon / Wonderbox / etc.
 * v22.3: soporte multi-cupón dinámico (añadir/quitar cupones en el mismo envío)
 */
import React, { useState, useRef } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Ticket, Upload, X, AlertTriangle,
  Shield, Zap, Star, ArrowRight, Info, ChevronDown, Plus, Trash2
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
interface CouponEntry {
  id: string; // UUID local para key React
  provider: string;
  productTicketingId: string;
  couponCode: string;
  securityCode: string;
  attachmentFile: File | null;
  attachmentUrl: string;
  uploading: boolean;
  couponCodeError: string;
}

interface CommonForm {
  customerName: string;
  email: string;
  phone: string;
  requestedDate: string;
  station: string;
  participants: number;
  children: number;
  comments: string;
}

interface FormErrors {
  customerName?: string;
  email?: string;
  requestedDate?: string;
}

function makeCoupon(): CouponEntry {
  return {
    id: Math.random().toString(36).slice(2),
    provider: "Groupon",
    productTicketingId: "",
    couponCode: "",
    securityCode: "",
    attachmentFile: null,
    attachmentUrl: "",
    uploading: false,
    couponCodeError: "",
  };
}

// ─── Sub-componente: bloque de un cupón ──────────────────────────────────────
function CouponBlock({
  coupon,
  index,
  total,
  products,
  onUpdate,
  onRemove,
}: {
  coupon: CouponEntry;
  index: number;
  total: number;
  products: { id: number; name: string }[] | undefined;
  onUpdate: (id: string, patch: Partial<CouponEntry>) => void;
  onRemove: (id: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error("El archivo no puede superar 10MB");
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error("Solo se admiten imágenes (JPG, PNG, WEBP) o PDF");
      return;
    }
    onUpdate(coupon.id, { attachmentFile: file, uploading: true });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload-coupon", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json() as { url: string };
      onUpdate(coupon.id, { attachmentUrl: url, uploading: false });
    } catch {
      toast.error("Error al subir el archivo. Puedes continuar sin adjunto.");
      onUpdate(coupon.id, { attachmentUrl: "", uploading: false });
    }
  };

  const removeFile = () => {
    onUpdate(coupon.id, { attachmentFile: null, attachmentUrl: "" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3 relative">
      {/* Cabecera del bloque */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-amber-400 text-xs font-display font-semibold uppercase tracking-wider">
          Cupón {index + 1}
        </span>
        {total > 1 && (
          <button
            type="button"
            onClick={() => onRemove(coupon.id)}
            className="text-white/25 hover:text-red-400 transition-colors"
            title="Eliminar este cupón"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Proveedor */}
      <div>
        <Label className="text-white/50 text-xs mb-1.5 block">Proveedor <span className="text-amber-400">*</span></Label>
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDERS.map(({ id, label, logo }) => (
            <button
              key={id}
              type="button"
              onClick={() => onUpdate(coupon.id, { provider: id, productTicketingId: "" })}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs transition-all ${
                coupon.provider === id
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

      {/* Producto */}
      {products && products.length > 0 && (
        <div>
          <Label className="text-white/50 text-xs mb-1.5 block">Experiencia del cupón</Label>
          <div className="relative">
            <select
              value={coupon.productTicketingId}
              onChange={(e) => onUpdate(coupon.id, { productTicketingId: e.target.value })}
              className="w-full h-9 bg-white/[0.07] border border-white/10 text-white rounded-xl text-xs px-3 pr-8 appearance-none focus:border-amber-500/50 focus:outline-none"
              style={{ background: "rgba(255,255,255,0.07)" }}
            >
              <option value="" style={{ background: "#0a1428" }}>Selecciona la experiencia…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id} style={{ background: "#0a1428" }}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Código cupón + Código seguridad */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-white/50 text-xs mb-1.5 block">Código del cupón <span className="text-amber-400">*</span></Label>
          <Input
            value={coupon.couponCode}
            onChange={(e) => onUpdate(coupon.id, { couponCode: e.target.value.toUpperCase(), couponCodeError: "" })}
            className={`h-9 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-xs font-mono focus:border-amber-500/50 ${coupon.couponCodeError ? "border-red-400/60" : ""}`}
            placeholder="GRP-XXXXXX"
          />
          {coupon.couponCodeError && <p className="text-red-400 text-xs mt-1">{coupon.couponCodeError}</p>}
        </div>
        <div>
          <Label className="text-white/50 text-xs mb-1.5 block">Código de seguridad</Label>
          <Input
            value={coupon.securityCode}
            onChange={(e) => onUpdate(coupon.id, { securityCode: e.target.value.toUpperCase() })}
            className="h-9 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-xs font-mono focus:border-amber-500/50"
            placeholder="SEC-XXXX"
          />
        </div>
      </div>

      {/* Adjunto */}
      <div>
        <Label className="text-white/50 text-xs mb-1.5 block">Adjuntar cupón (recomendado)</Label>
        {!coupon.attachmentFile ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-12 rounded-xl border-2 border-dashed border-white/15 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/25 transition-all flex items-center justify-center gap-2 text-white/40 hover:text-white/60"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="text-xs">Subir imagen o PDF</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2">
            {coupon.uploading ? (
              <div className="w-3.5 h-3.5 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin shrink-0" />
            ) : (
              <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </div>
            )}
            <span className="flex-1 text-white/60 text-xs truncate">{coupon.attachmentFile.name}</span>
            <button type="button" onClick={removeFile} className="text-white/30 hover:text-white/60 transition-colors">
              <X className="w-3 h-3" />
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
        <p className="text-white/25 text-xs mt-1">JPG, PNG, WEBP o PDF · Máx. 10MB</p>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CanjearCupon() {
  const [form, setForm] = useState<CommonForm>({
    customerName: "",
    email: "",
    phone: "",
    requestedDate: "",
    station: "",
    participants: 1,
    children: 0,
    comments: "",
  });
  const [coupons, setCoupons] = useState<CouponEntry[]>([makeCoupon()]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{ totalAccepted: number; totalRejected: number } | null>(null);

  // Cargar productos activos (del primer proveedor seleccionado como referencia)
  const { data: products } = trpc.ticketing.listActiveProducts.useQuery(
    { provider: coupons[0]?.provider ?? "Groupon" },
    { enabled: true }
  );

  const createSubmission = trpc.ticketing.createSubmission.useMutation({
    onSuccess: (data) => {
      setSubmissionResult({ totalAccepted: data.totalAccepted, totalRejected: data.totalRejected });
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (err) => {
      if (err.message.includes("duplicado") || err.message.includes("registrado")) {
        toast.error("Uno o más cupones ya han sido registrados. Comprueba los códigos.");
      } else {
        toast.error("Error al enviar la solicitud. Inténtalo de nuevo.");
      }
    },
  });

  const setCommon = (field: keyof CommonForm, value: string | number) => {
    setForm((p) => ({ ...p, [field]: value }));
    if (field in errors) setErrors((p) => ({ ...p, [field]: "" }));
  };

  const updateCoupon = (id: string, patch: Partial<CouponEntry>) => {
    setCoupons((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
  };

  const removeCoupon = (id: string) => {
    setCoupons((prev) => prev.filter((c) => c.id !== id));
  };

  const addCoupon = () => {
    if (coupons.length >= 5) {
      toast.info("Máximo 5 cupones por envío. Para más, contacta con nosotros.");
      return;
    }
    setCoupons((prev) => [...prev, makeCoupon()]);
  };

  const validate = (): boolean => {
    const errs: FormErrors = {};
    if (!form.customerName.trim()) errs.customerName = "El nombre es obligatorio";
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Email inválido";
    if (!form.requestedDate) errs.requestedDate = "Selecciona una fecha aproximada";
    setErrors(errs);

    // Validar cupones
    let couponValid = true;
    setCoupons((prev) => prev.map((c) => {
      if (!c.couponCode.trim()) {
        couponValid = false;
        return { ...c, couponCodeError: "El código es obligatorio" };
      }
      return c;
    }));

    return Object.keys(errs).length === 0 && couponValid;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const anyUploading = coupons.some((c) => c.uploading);
    if (anyUploading) {
      toast.info("Espera a que terminen de subirse los archivos adjuntos.");
      return;
    }

    createSubmission.mutate({
      customerName: form.customerName,
      email: form.email,
      phone: form.phone || undefined,
      requestedDate: form.requestedDate || undefined,
      station: form.station || undefined,
      participants: form.participants,
      children: form.children,
      comments: form.comments || undefined,
      coupons: coupons.map((c) => ({
        provider: c.provider,
        productTicketingId: c.productTicketingId ? parseInt(c.productTicketingId) : undefined,
        couponCode: c.couponCode.trim().toUpperCase(),
        securityCode: c.securityCode.trim() || undefined,
        attachmentUrl: c.attachmentUrl || undefined,
      })),
    });
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
            {submissionResult && submissionResult.totalRejected > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-6 text-left">
                <p className="text-amber-300 text-sm font-medium mb-1">
                  ⚠️ {submissionResult.totalAccepted} cupón{submissionResult.totalAccepted !== 1 ? "es" : ""} aceptado{submissionResult.totalAccepted !== 1 ? "s" : ""}
                </p>
                <p className="text-amber-400/70 text-xs">
                  {submissionResult.totalRejected} cupón{submissionResult.totalRejected !== 1 ? "es" : ""} no pudo procesarse por ser duplicado. Contacta con nosotros si crees que es un error.
                </p>
              </div>
            )}
            <p className="text-white/55 mb-10 leading-relaxed">
              Nuestro equipo revisará {coupons.length > 1 ? `tus ${coupons.length} cupones` : "tu cupón"} y te confirmará la reserva en
              <strong className="text-amber-400"> menos de 24 horas</strong>.
            </p>
            <div className="bg-white/[0.08] rounded-2xl p-5 mb-8 text-left border border-white/10">
              <p className="text-white/40 text-xs mb-3 font-display uppercase tracking-wider">Resumen de tu solicitud</p>
              <div className="space-y-2 text-sm text-white/70">
                <div className="flex justify-between">
                  <span className="text-white/40">Cupones enviados</span>
                  <span className="font-medium">{coupons.length}</span>
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
          <div className="w-full lg:w-[500px] xl:w-[540px] shrink-0 lg:py-8">
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                      <Ticket className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <h2 className="text-white font-heading font-bold text-xl">Solicitud de canje</h2>
                      <p className="text-white/45 text-sm mt-0.5">Confirmaremos tu reserva en menos de 24h</p>
                    </div>
                  </div>
                  {coupons.length > 1 && (
                    <span className="bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold px-2.5 py-1 rounded-full">
                      {coupons.length} cupones
                    </span>
                  )}
                </div>
              </div>

              {/* Formulario con scroll interno */}
              <div className="overflow-y-auto max-h-[calc(100vh-240px)] lg:max-h-[calc(100vh-180px)]">
                <form onSubmit={handleSubmit} className="px-7 py-5 space-y-5">

                  {/* ── Datos del cliente (comunes a todos los cupones) ── */}
                  <div>
                    <p className="text-white/35 text-xs font-display uppercase tracking-wider mb-3">Tus datos</p>

                    {/* Nombre + Email */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Nombre <span className="text-amber-400">*</span></Label>
                        <Input
                          value={form.customerName}
                          onChange={(e) => setCommon("customerName", e.target.value)}
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
                          onChange={(e) => setCommon("email", e.target.value)}
                          className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.email ? "border-red-400/60" : ""}`}
                          placeholder="tu@email.com"
                        />
                        {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                      </div>
                    </div>

                    {/* Teléfono + Fecha */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Teléfono</Label>
                        <Input
                          type="tel"
                          value={form.phone}
                          onChange={(e) => setCommon("phone", e.target.value)}
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
                          onChange={(e) => setCommon("requestedDate", e.target.value)}
                          className={`h-10 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-amber-500/50 [color-scheme:dark] ${errors.requestedDate ? "border-red-400/60" : ""}`}
                        />
                        {errors.requestedDate && <p className="text-red-400 text-xs mt-1">{errors.requestedDate}</p>}
                      </div>
                    </div>

                    {/* Participantes */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Adultos</Label>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setCommon("participants", Math.max(1, form.participants - 1))} className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/10 text-white/60 hover:bg-white/10 transition-all flex items-center justify-center text-lg leading-none">−</button>
                          <span className="flex-1 text-center text-white font-medium text-sm">{form.participants}</span>
                          <button type="button" onClick={() => setCommon("participants", form.participants + 1)} className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/10 text-white/60 hover:bg-white/10 transition-all flex items-center justify-center text-lg leading-none">+</button>
                        </div>
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Niños</Label>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setCommon("children", Math.max(0, form.children - 1))} className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/10 text-white/60 hover:bg-white/10 transition-all flex items-center justify-center text-lg leading-none">−</button>
                          <span className="flex-1 text-center text-white font-medium text-sm">{form.children}</span>
                          <button type="button" onClick={() => setCommon("children", form.children + 1)} className="w-8 h-8 rounded-lg bg-white/[0.07] border border-white/10 text-white/60 hover:bg-white/10 transition-all flex items-center justify-center text-lg leading-none">+</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Bloque de cupones ── */}
                  <div>
                    <p className="text-white/35 text-xs font-display uppercase tracking-wider mb-3">
                      Tus cupones ({coupons.length})
                    </p>
                    <div className="space-y-3">
                      {coupons.map((coupon, idx) => (
                        <CouponBlock
                          key={coupon.id}
                          coupon={coupon}
                          index={idx}
                          total={coupons.length}
                          products={products}
                          onUpdate={updateCoupon}
                          onRemove={removeCoupon}
                        />
                      ))}
                    </div>

                    {/* Botón añadir cupón */}
                    {coupons.length < 5 && (
                      <button
                        type="button"
                        onClick={addCoupon}
                        className="mt-3 w-full h-10 rounded-xl border border-dashed border-amber-500/30 bg-amber-500/[0.04] hover:bg-amber-500/[0.08] hover:border-amber-500/50 transition-all flex items-center justify-center gap-2 text-amber-400/70 hover:text-amber-400 text-xs font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Añadir otro cupón
                      </button>
                    )}
                  </div>

                  {/* Comentarios */}
                  <div>
                    <Label className="text-white/50 text-xs mb-1.5 block">Comentarios (opcional)</Label>
                    <Textarea
                      value={form.comments}
                      onChange={(e) => setCommon("comments", e.target.value)}
                      className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm resize-none"
                      rows={2}
                      placeholder="Preferencias de horario, necesidades especiales…"
                    />
                  </div>

                  {/* Submit */}
                  <Button
                    type="submit"
                    disabled={createSubmission.isPending || coupons.some((c) => c.uploading)}
                    className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-white font-semibold rounded-2xl text-sm shadow-lg shadow-amber-500/20 transition-all"
                  >
                    {createSubmission.isPending ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Enviando solicitud…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Ticket className="w-4 h-4" />
                        Solicitar canje{coupons.length > 1 ? ` (${coupons.length} cupones)` : ""}
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
              { step: "01", title: "Rellena el formulario", desc: "Introduce tus datos y los códigos de tus cupones. Puedes enviar hasta 5 cupones en un solo formulario.", color: "text-amber-400" },
              { step: "02", title: "Validamos tus cupones", desc: "Nuestro equipo verifica los códigos con el proveedor y confirma la disponibilidad para la fecha solicitada.", color: "text-sky-400" },
              { step: "03", title: "¡A disfrutar!", desc: "Recibirás la confirmación por email con todos los detalles de tu reserva.", color: "text-emerald-400" },
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
                { q: "¿Qué proveedores son válidos?", a: "Aceptamos cupones de Groupon, Wonderbox, SmartBox y otros proveedores de experiencias. Si tienes dudas, contáctanos." },
                { q: "¿Puedo enviar varios cupones a la vez?", a: "Sí, puedes añadir hasta 5 cupones en un mismo formulario. Ideal si tienes cupones para toda la familia." },
                { q: "¿Cuánto tiempo tengo para canjear?", a: "Depende de la fecha de caducidad de tu cupón. Revisa las condiciones del proveedor. Recomendamos canjear con al menos 7 días de antelación." },
                { q: "¿Puedo cambiar la fecha una vez confirmada?", a: "Sí, con 48h de antelación y sujeto a disponibilidad. Contacta con nosotros en reservas@nayadeexperiences.es." },
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
