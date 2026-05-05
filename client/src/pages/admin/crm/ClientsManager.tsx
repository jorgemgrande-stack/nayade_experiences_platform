import { useState, useMemo, useEffect, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, Plus, Search, Pencil, Trash2, RefreshCw, Phone, Mail,
  Building2, FileText, ChevronRight, UserCheck, UserPlus, ArrowRight,
  MapPin, CreditCard, Calendar, Globe, Tag, Ticket,
  History, FileCheck, Ban, BadgePercent, Activity,
  TrendingUp, ShoppingBag, Receipt, AlertCircle, CheckCircle2,
  Clock, Eye, ChevronDown, ChevronUp, Euro, MessageCircle, Bot, Mic,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Link } from "wouter";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ClientRow = {
  id: number;
  leadId: number | null;
  source: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  nif: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  birthDate: string | null;
  notes: string | null;
  isConverted: boolean;
  totalBookings: number;
  totalSpent: string | null;
  lastBookingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── EXPAND DATA MODAL (cuando se convierte en reserva) ─────────────────────

function ExpandDataModal({
  client,
  onClose,
}: {
  client: ClientRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    nif: client.nif ?? "",
    address: client.address ?? "",
    city: client.city ?? "",
    postalCode: client.postalCode ?? "",
    country: client.country ?? "ES",
    birthDate: client.birthDate ?? "",
    notes: client.notes ?? "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const expand = trpc.crm.clients.expand.useMutation({
    onSuccess: () => {
      toast.success("Datos del cliente ampliados. ¡Cliente convertido!");
      utils.crm.clients.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-lg bg-[#0d1526] border-white/10 text-white">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-green-400" />
          Ampliar datos del cliente
        </DialogTitle>
      </DialogHeader>

      {/* Info del cliente */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 mb-2">
        <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-300 font-bold text-sm">
          {client.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="text-white font-medium text-sm">{client.name}</div>
          <div className="text-white/40 text-xs">{client.email}</div>
        </div>
        <div className="ml-auto">
          <span className="px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/25 text-orange-300 text-xs">
            Convirtiendo a cliente
          </span>
        </div>
      </div>

      <p className="text-white/40 text-xs mb-3">
        Estos datos se guardarán en el perfil del cliente para futuras reservas y facturas.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <CreditCard className="w-3 h-3" /> NIF / CIF
            </Label>
            <Input value={form.nif} onChange={(e) => set("nif", e.target.value)}
              placeholder="12345678A"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Fecha de nacimiento
            </Label>
            <Input type="date" value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)}
              className="bg-white/5 border-white/10 text-white mt-1 text-sm" />
          </div>
          <div className="col-span-2">
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Dirección
            </Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)}
              placeholder="Calle, número, piso..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Ciudad</Label>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)}
              placeholder="Madrid"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Código postal</Label>
            <Input value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)}
              placeholder="28001"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <Globe className="w-3 h-3" /> País
            </Label>
            <Input value={form.country} onChange={(e) => set("country", e.target.value)}
              placeholder="ES"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <Tag className="w-3 h-3" /> Notas internas
            </Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Observaciones..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">
          Cancelar
        </Button>
        <Button size="sm" onClick={() => expand.mutate({ id: client.id, ...form })}
          disabled={expand.isPending}
          className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white">
          {expand.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <UserCheck className="w-4 h-4 mr-1" />}
          Guardar y convertir
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── CLIENT FORM MODAL (crear / editar) ─────────────────────────────────────

function ClientFormModal({
  client,
  onClose,
}: {
  client?: ClientRow | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const isEdit = !!client;

  const [form, setForm] = useState({
    name: client?.name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    company: client?.company ?? "",
    nif: client?.nif ?? "",
    address: client?.address ?? "",
    city: client?.city ?? "",
    postalCode: client?.postalCode ?? "",
    country: client?.country ?? "ES",
    birthDate: client?.birthDate ?? "",
    notes: client?.notes ?? "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const create = trpc.crm.clients.create.useMutation({
    onSuccess: () => { toast.success("Cliente creado"); utils.crm.clients.list.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.crm.clients.update.useMutation({
    onSuccess: () => { toast.success("Cliente actualizado"); utils.crm.clients.list.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!form.name || !form.email) { toast.error("Nombre y email son obligatorios"); return; }
    if (isEdit && client) {
      update.mutate({ id: client.id, ...form });
    } else {
      create.mutate(form);
    }
  };

  const isPending = create.isPending || update.isPending;

  return (
    <DialogContent className="max-w-lg bg-[#0d1526] border-white/10 text-white">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-400" />
          {isEdit ? "Editar cliente" : "Nuevo cliente"}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Nombre completo *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Teléfono</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Empresa</Label>
            <Input value={form.company} onChange={(e) => set("company", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">NIF / CIF</Label>
            <Input value={form.nif} onChange={(e) => set("nif", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Dirección</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Ciudad</Label>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Código postal</Label>
            <Input value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Notas internas</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Observaciones sobre el cliente..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">
          Cancelar
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={isPending}
          className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white">
          {isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Users className="w-4 h-4 mr-1" />}
          {isEdit ? "Guardar cambios" : "Crear cliente"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── CLIENT HISTORY MODAL ────────────────────────────────────────────────────

type HistoryTab = "resumen" | "timeline" | "actividad";

function fmtDate(d: Date | string | number | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtEuros(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

type QuoteStatus = "borrador" | "enviado" | "aceptado" | "rechazado" | "convertido_carrito" | string;

function quoteStatusLabel(s: QuoteStatus): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    borrador: { label: "Borrador", color: "text-white/40 bg-white/5 border-white/10" },
    enviado: { label: "Enviado", color: "text-blue-300 bg-blue-500/10 border-blue-500/20" },
    aceptado: { label: "Aceptado", color: "text-green-300 bg-green-500/10 border-green-500/20" },
    rechazado: { label: "Rechazado", color: "text-red-300 bg-red-500/10 border-red-500/20" },
    convertido_carrito: { label: "Reservado", color: "text-purple-300 bg-purple-500/10 border-purple-500/20" },
  };
  return map[s] ?? { label: s, color: "text-white/40 bg-white/5 border-white/10" };
}

function resStatusLabel(s: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    paid: { label: "Pagada", color: "text-green-300 bg-green-500/10 border-green-500/20" },
    pending_payment: { label: "Pendiente pago", color: "text-yellow-300 bg-yellow-500/10 border-yellow-500/20" },
    draft: { label: "Borrador", color: "text-white/40 bg-white/5 border-white/10" },
    failed: { label: "Fallida", color: "text-red-300 bg-red-500/10 border-red-500/20" },
    cancelled: { label: "Cancelada", color: "text-red-300 bg-red-500/10 border-red-500/20" },
  };
  return map[s] ?? { label: s, color: "text-white/40 bg-white/5 border-white/10" };
}

function TimelineDot({ color }: { color: string }) {
  return (
    <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${color}`} />
  );
}

function ClientHistoryModal({ client, onClose, onStartWhatsApp }: { client: ClientRow; onClose: () => void; onStartWhatsApp?: (phone: string, name: string) => void }) {
  const [tab, setTab] = useState<HistoryTab>("resumen");
  const { data, isLoading } = trpc.crm.clients.getHistory.useQuery({ id: client.id });

  const tabs: { id: HistoryTab; label: string; icon: ReactNode }[] = [
    { id: "resumen", label: "Resumen", icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: "timeline", label: "Historial", icon: <History className="w-3.5 h-3.5" /> },
    { id: "actividad", label: "Actividad", icon: <Activity className="w-3.5 h-3.5" /> },
  ];

  // Build unified timeline
  const timeline = useMemo(() => {
    if (!data) return [];
    const events: Array<{
      id: string;
      date: Date;
      type: "lead" | "quote" | "reservation" | "invoice" | "cancellation" | "discount" | "whatsapp" | "vapi";
      title: string;
      subtitle: string;
      color: string;
      dotColor: string;
      icon: ReactNode;
      href?: string;
    }> = [];

    if (data.lead) {
      events.push({
        id: `lead-${data.lead.id}`,
        date: new Date(data.lead.createdAt),
        type: "lead",
        title: `Lead #${data.lead.id} — ${data.lead.opportunityName ?? data.lead.name}`,
        subtitle: `Origen: ${data.lead.source ?? "—"} · Estado: ${data.lead.opportunityStatus ?? "—"}`,
        color: "border-l-blue-500",
        dotColor: "bg-blue-500 border-blue-300",
        icon: <UserPlus className="w-3.5 h-3.5 text-blue-400" />,
        href: `/admin/crm?lead=${data.lead.id}`,
      });
    }

    for (const q of data.quotes) {
      const st = quoteStatusLabel(q.status);
      events.push({
        id: `quote-${q.id}`,
        date: new Date(q.createdAt),
        type: "quote",
        title: `Presupuesto ${q.quoteNumber ?? `#${q.id}`} — ${q.title ?? "Sin título"}`,
        subtitle: `${st.label} · Total: ${q.total ? `${parseFloat(q.total).toFixed(2)} €` : "—"}`,
        color: "border-l-indigo-500",
        dotColor: "bg-indigo-500 border-indigo-300",
        icon: <FileText className="w-3.5 h-3.5 text-indigo-400" />,
      });
    }

    for (const r of data.reservations) {
      const st = resStatusLabel(r.status ?? "pending");
      events.push({
        id: `res-${r.id}`,
        date: new Date(r.createdAt),
        type: "reservation",
        title: `Reserva ${r.merchantOrder ?? `#${r.id}`} — ${r.productName ?? "—"}`,
        subtitle: `${st.label} · Pagado: ${r.amountPaid ? `${(r.amountPaid / 100).toFixed(2)} €` : "0 €"}`,
        color: "border-l-green-500",
        dotColor: "bg-green-500 border-green-300",
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />,
      });
    }

    for (const inv of data.invoices) {
      events.push({
        id: `inv-${inv.id}`,
        date: new Date(inv.createdAt),
        type: "invoice",
        title: `Factura ${inv.invoiceNumber}`,
        subtitle: `Total: ${inv.total ? `${parseFloat(inv.total).toFixed(2)} €` : "—"} · ${inv.pdfUrl ? "PDF disponible" : "Sin PDF"}`,
        color: "border-l-yellow-500",
        dotColor: "bg-yellow-500 border-yellow-300",
        icon: <Receipt className="w-3.5 h-3.5 text-yellow-400" />,
      });
    }

    for (const c of data.cancellations) {
      events.push({
        id: `cancel-${c.id}`,
        date: new Date(c.createdAt),
        type: "cancellation",
        title: `Anulación ${c.cancellationNumber ?? `#${c.id}`}`,
        subtitle: `${c.operationalStatus} · ${c.resolutionStatus} · ${c.refundableAmount ? `Reembolso: ${parseFloat(c.refundableAmount).toFixed(2)} €` : "Sin reembolso"}`,
        color: "border-l-red-500",
        dotColor: "bg-red-500 border-red-300",
        icon: <Ban className="w-3.5 h-3.5 text-red-400" />,
      });
    }

    for (const d of data.discountUses) {
      events.push({
        id: `disc-${d.id}`,
        date: new Date(d.appliedAt),
        type: "discount",
        title: `Cupón aplicado: ${d.code}`,
        subtitle: `Descuento: ${d.discountPercent}% · Ahorro: ${d.discountAmount ? `${parseFloat(d.discountAmount).toFixed(2)} €` : "—"}`,
        color: "border-l-purple-500",
        dotColor: "bg-purple-500 border-purple-300",
        icon: <BadgePercent className="w-3.5 h-3.5 text-purple-400" />,
      });
    }

    for (const wa of (data as any).whatsappConversations ?? []) {
      if (!wa.lastMessageAt) continue;
      events.push({
        id: `wa-${wa.ghlConversationId}`,
        date: new Date(wa.lastMessageAt),
        type: "whatsapp",
        title: `WhatsApp — ${wa.customerName ?? wa.phone ?? "—"}`,
        subtitle: wa.lastMessagePreview
          ? `${wa.lastMessagePreview.slice(0, 80)}${wa.lastMessagePreview.length > 80 ? "…" : ""}`
          : `Estado: ${wa.status ?? "—"}`,
        color: "border-l-emerald-500",
        dotColor: "bg-emerald-500 border-emerald-300",
        icon: <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />,
        href: "/admin/atencion-comercial/whatsapp",
      });
    }

    for (const call of (data as any).vapiCalls ?? []) {
      if (!call.startedAt) continue;
      const dur = call.durationSeconds ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s` : "—";
      events.push({
        id: `vapi-${call.vapiCallId}`,
        date: new Date(call.startedAt),
        type: "vapi",
        title: `Llamada IA Vapi — ${call.customerName ?? call.phoneNumber ?? "—"}`,
        subtitle: call.summary
          ? call.summary.slice(0, 100)
          : `Duración: ${dur} · ${call.endedReason ?? call.status ?? "—"}`,
        color: "border-l-violet-500",
        dotColor: "bg-violet-500 border-violet-300",
        icon: <Mic className="w-3.5 h-3.5 text-violet-400" />,
        href: "/admin/atencion-comercial/agente-ia",
      });
    }

    return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [data]);

  return (
    <DialogContent className="max-w-3xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] flex flex-col p-0">
      {/* Header */}
      <div className="flex items-center gap-4 p-6 pb-4 border-b border-white/10 flex-shrink-0">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500/30 to-indigo-500/30 border border-blue-500/30 flex items-center justify-center text-blue-300 font-bold text-lg">
          {client.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-white leading-tight">{client.name}</h2>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-white/40 text-xs flex items-center gap-1"><Mail className="w-3 h-3" />{client.email}</span>
            {client.phone && <span className="text-white/40 text-xs flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {client.phone && onStartWhatsApp && (
            <button
              onClick={() => onStartWhatsApp(client.phone!, client.name)}
              title={`Iniciar WhatsApp con ${client.name}`}
              className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-1 hover:bg-emerald-500/20 transition-colors"
            >
              <MessageCircle className="w-3 h-3" /> WhatsApp
            </button>
          )}
          {client.isConverted ? (
            <span className="px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-300 text-xs flex items-center gap-1">
              <UserCheck className="w-3 h-3" /> Cliente
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-300 text-xs flex items-center gap-1">
              <UserPlus className="w-3 h-3" /> Lead
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 pt-3 flex-shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.id
                ? "bg-blue-500/15 text-blue-300 border border-blue-500/25"
                : "text-white/40 hover:text-white/70 hover:bg-white/5"
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 text-white/20 animate-spin" />
          </div>
        ) : !data ? (
          <div className="text-center py-12 text-white/30">No se pudo cargar el historial</div>
        ) : (
          <>
            {/* ── RESUMEN ── */}
            {tab === "resumen" && (
              <div className="space-y-4">
                {/* KPI grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl p-4 bg-indigo-500/5 border border-indigo-500/15">
                    <div className="text-2xl font-bold text-indigo-400">{data.kpis.totalQuotes}</div>
                    <div className="text-white/40 text-xs mt-0.5 flex items-center gap-1"><FileText className="w-3 h-3" />Presupuestos</div>
                  </div>
                  <div className="rounded-xl p-4 bg-green-500/5 border border-green-500/15">
                    <div className="text-2xl font-bold text-green-400">{data.kpis.paidReservations}</div>
                    <div className="text-white/40 text-xs mt-0.5 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Reservas pagadas</div>
                  </div>
                  <div className="rounded-xl p-4 bg-yellow-500/5 border border-yellow-500/15">
                    <div className="text-2xl font-bold text-yellow-400">{data.kpis.totalInvoices}</div>
                    <div className="text-white/40 text-xs mt-0.5 flex items-center gap-1"><Receipt className="w-3 h-3" />Facturas</div>
                  </div>
                  <div className="col-span-2 rounded-xl p-4 bg-blue-500/5 border border-blue-500/15">
                    <div className="text-2xl font-bold text-blue-400">{fmtEuros(data.kpis.totalSpentCents)}</div>
                    <div className="text-white/40 text-xs mt-0.5 flex items-center gap-1"><Euro className="w-3 h-3" />Total gastado (reservas pagadas)</div>
                  </div>
                  <div className="rounded-xl p-4 bg-red-500/5 border border-red-500/15">
                    <div className="text-2xl font-bold text-red-400">{data.kpis.totalCancellations}</div>
                    <div className="text-white/40 text-xs mt-0.5 flex items-center gap-1"><Ban className="w-3 h-3" />Anulaciones</div>
                  </div>
                  <div className="rounded-xl p-4 bg-emerald-500/5 border border-emerald-500/15">
                    <div className="text-2xl font-bold text-emerald-400">{(data as any).kpis?.totalWhatsApp ?? 0}</div>
                    <div className="text-white/40 text-xs mt-0.5 flex items-center gap-1"><MessageCircle className="w-3 h-3" />Convs. WhatsApp</div>
                  </div>
                  <div className="rounded-xl p-4 bg-violet-500/5 border border-violet-500/15">
                    <div className="text-2xl font-bold text-violet-400">{(data as any).kpis?.totalVapiCalls ?? 0}</div>
                    <div className="text-white/40 text-xs mt-0.5 flex items-center gap-1"><Mic className="w-3 h-3" />Llamadas Vapi</div>
                  </div>
                </div>

                {/* Lead info */}
                {data.lead && (
                  <div className="rounded-xl p-4 bg-white/[0.03] border border-white/10 space-y-2">
                    <div className="text-white/50 text-xs font-medium uppercase tracking-wider mb-2">Lead origen</div>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                        <UserPlus className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <div className="text-white text-sm font-medium">{data.lead.opportunityName ?? data.lead.name}</div>
                        <div className="text-white/40 text-xs">Lead #{data.lead.id} · {fmtDate(data.lead.createdAt)} · {data.lead.source ?? "—"}</div>
                      </div>
                      <Link href={`/admin/crm?lead=${data.lead.id}`} className="ml-auto">
                        <Button size="sm" variant="ghost" className="text-blue-400 hover:text-blue-300 h-7 px-2 text-xs">
                          <ArrowRight className="w-3.5 h-3.5 mr-1" />Ver lead
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}

                {/* Quick lists */}
                {data.quotes.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-white/10">
                    <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10 text-white/50 text-xs font-medium uppercase tracking-wider flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5" />Presupuestos ({data.quotes.length})
                    </div>
                    <div className="divide-y divide-white/5">
                      {data.quotes.map((q) => {
                        const st = quoteStatusLabel(q.status);
                        return (
                          <div key={q.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]">
                            <div className="flex-1 min-w-0">
                              <div className="text-white text-sm font-medium truncate">{q.quoteNumber ?? `#${q.id}`} — {q.title ?? "Sin título"}</div>
                              <div className="text-white/30 text-xs">{fmtDate(q.createdAt)}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {q.total && <span className="text-white/60 text-xs">{parseFloat(q.total).toFixed(2)} €</span>}
                              <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${st.color}`}>{st.label}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {data.reservations.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-white/10">
                    <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10 text-white/50 text-xs font-medium uppercase tracking-wider flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />Reservas ({data.reservations.length})
                    </div>
                    <div className="divide-y divide-white/5">
                      {data.reservations.map((r) => {
                        const st = resStatusLabel(r.status ?? "pending");
                        return (
                          <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]">
                            <div className="flex-1 min-w-0">
                              <div className="text-white text-sm font-medium">{r.reservationNumber ?? r.merchantOrder ?? `#${r.id}`} — {r.productName ?? "—"}</div>
                              <div className="text-white/30 text-xs">{fmtDate(r.createdAt)} · {r.people ? `${r.people} pax` : ""}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {r.amountTotal != null && (
                                <span className="text-white/60 text-xs">{(r.amountTotal / 100).toFixed(2)} €</span>
                              )}
                              <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${st.color}`}>{st.label}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {data.invoices.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-white/10">
                    <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10 text-white/50 text-xs font-medium uppercase tracking-wider flex items-center gap-2">
                      <Receipt className="w-3.5 h-3.5" />Facturas ({data.invoices.length})
                    </div>
                    <div className="divide-y divide-white/5">
                      {data.invoices.map((inv) => {
                        const viewUrl = inv.pdfUrl ?? `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`;
                        return (
                          <div key={inv.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]">
                            <div className="flex-1 min-w-0">
                              <div className="text-white text-sm font-medium">{inv.invoiceNumber}</div>
                              <div className="text-white/30 text-xs">{fmtDate(inv.createdAt)}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {inv.total && <span className="text-white/60 text-xs">{parseFloat(inv.total).toFixed(2)} €</span>}
                              <a href={viewUrl} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="ghost" className="text-yellow-400 hover:text-yellow-300 h-6 px-2 text-xs">
                                  <FileCheck className="w-3 h-3 mr-1" />PDF
                                </Button>
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {data.cancellations.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-white/10">
                    <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10 text-white/50 text-xs font-medium uppercase tracking-wider flex items-center gap-2">
                      <Ban className="w-3.5 h-3.5 text-red-400" />Anulaciones ({data.cancellations.length})
                    </div>
                    <div className="divide-y divide-white/5">
                      {data.cancellations.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]">
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium">{c.cancellationNumber ?? `Anulación #${c.id}`}</div>
                            <div className="text-white/30 text-xs">{fmtDate(c.createdAt)} · {c.reason}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${c.resolutionStatus === "aceptada_total" ? "text-green-300 bg-green-500/10 border-green-500/20" : c.resolutionStatus === "rechazada" ? "text-red-300 bg-red-500/10 border-red-500/20" : "text-yellow-300 bg-yellow-500/10 border-yellow-500/20"}`}>
                              {c.resolutionStatus}
                            </span>
                            {c.refundableAmount && <span className="text-white/50 text-xs">{parseFloat(c.refundableAmount).toFixed(2)} €</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TIMELINE ── */}
            {tab === "timeline" && (
              <div className="space-y-1">
                {timeline.length === 0 ? (
                  <div className="text-center py-12 text-white/30">No hay eventos registrados</div>
                ) : (
                  <div className="relative">
                    {/* Vertical line */}
                    <div className="absolute left-[7px] top-3 bottom-3 w-px bg-white/10" />
                    <div className="space-y-0">
                      {timeline.map((event, i) => (
                        <div key={event.id} className="relative flex items-start gap-4 py-3">
                          <TimelineDot color={event.dotColor} />
                          <div className={`flex-1 min-w-0 rounded-xl p-3 bg-white/[0.03] border border-white/10 border-l-2 ${event.color} hover:bg-white/[0.05] transition-colors`}>
                            <div className="flex items-start gap-2">
                              <div className="p-1 rounded-md bg-white/5 mt-0.5">{event.icon}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-white text-sm font-medium">{event.title}</span>
                                  {event.href && (
                                    <Link href={event.href}>
                                      <span className="text-blue-400/70 text-xs hover:text-blue-300 flex items-center gap-0.5">
                                        <Eye className="w-3 h-3" />Ver
                                      </span>
                                    </Link>
                                  )}
                                </div>
                                <div className="text-white/40 text-xs mt-0.5">{event.subtitle}</div>
                              </div>
                              <div className="text-white/25 text-xs flex-shrink-0 flex items-center gap-1">
                                <Clock className="w-3 h-3" />{fmtDate(event.date)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── ACTIVIDAD ── */}
            {tab === "actividad" && (
              <div className="space-y-1">
                {data.activityLog.length === 0 ? (
                  <div className="text-center py-12 text-white/30">No hay registros de actividad</div>
                ) : (
                  data.activityLog.map((entry) => {
                    const entityColors: Record<string, string> = {
                      lead: "text-blue-300 bg-blue-500/10 border-blue-500/20",
                      quote: "text-indigo-300 bg-indigo-500/10 border-indigo-500/20",
                      reservation: "text-green-300 bg-green-500/10 border-green-500/20",
                      invoice: "text-yellow-300 bg-yellow-500/10 border-yellow-500/20",
                    };
                    const badgeClass = entityColors[entry.entityType] ?? "text-white/40 bg-white/5 border-white/10";
                    return (
                      <div key={entry.id} className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20 mt-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${badgeClass}`}>
                              {entry.entityType} #{entry.entityId}
                            </span>
                            <span className="text-white/70 text-sm">{entry.action}</span>
                          </div>
                          {entry.actorName && (
                            <div className="text-white/30 text-xs mt-0.5">por {entry.actorName}</div>
                          )}
                          {entry.details && Object.keys(entry.details).length > 0 && (
                            <div className="mt-1 text-white/25 text-xs font-mono bg-white/[0.03] rounded p-2 max-h-20 overflow-y-auto">
                              {JSON.stringify(entry.details, null, 2)}
                            </div>
                          )}
                        </div>
                        <div className="text-white/25 text-xs flex-shrink-0 flex items-center gap-1">
                          <Clock className="w-3 h-3" />{fmtDate(entry.createdAt)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 flex-shrink-0">
        <div className="text-white/30 text-xs">
          Cliente desde {fmtDate(client.createdAt)}
        </div>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">
          Cerrar
        </Button>
      </div>
    </DialogContent>
  );
}

// ─── SOURCE BADGE ─────────────────────────────────────────────────────────────

function SourceBadge({ source, leadId }: { source: string; leadId: number | null }) {
  if (source === "lead" && leadId) {
    return (
      <Link href={`/admin/crm?lead=${leadId}`}>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[10px] cursor-pointer hover:bg-blue-500/20 transition-colors">
          <ArrowRight className="w-2.5 h-2.5" /> Lead #{leadId}
        </span>
      </Link>
    );
  }
  if (source === "manual") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/30 text-[10px]">
        Manual
      </span>
    );
  }
  return null;
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ClientsManager() {
  const [search, setSearch] = useState("");
  const [editClient, setEditClient] = useState<ClientRow | null | undefined>(undefined);
  const [expandClient, setExpandClient] = useState<ClientRow | null>(null);
  const [historyClient, setHistoryClient] = useState<ClientRow | null>(null);
  const [deleteClientId, setDeleteClientId] = useState<number | null>(null);

  const searchInput = useMemo(() => ({ q: search, limit: 50 }), [search]);
  const { data: clientsData, isLoading } = trpc.crm.clients.list.useQuery(
    { search, limit: 50 }
  );
  const clientsList = clientsData?.items as ClientRow[] | undefined;
  const utils = trpc.useUtils();

  // Auto-open client modal when URL has ?clientId=X
  useEffect(() => {
    if (!clientsList) return;
    const params = new URLSearchParams(window.location.search);
    const clientIdParam = params.get("clientId");
    if (!clientIdParam) return;
    const targetId = parseInt(clientIdParam, 10);
    const found = clientsList.find((c) => c.id === targetId);
    if (found) {
      setEditClient(found);
      // Clean up URL param without page reload
      const url = new URL(window.location.href);
      url.searchParams.delete("clientId");
      window.history.replaceState({}, "", url.toString());
    }
  }, [clientsList]);

  const convertedCount = clientsList?.filter((c) => c.isConverted).length ?? 0;
  const fromLeadCount = clientsList?.filter((c) => c.source === "lead").length ?? 0;

  const deleteClient = trpc.crm.clients.delete.useMutation({
    onSuccess: () => { toast.success("Cliente eliminado"); utils.crm.clients.list.invalidate(); setDeleteClientId(null); },
    onError: (e) => toast.error(e.message),
  });

  // ── WhatsApp: iniciar conversación directamente desde CRM ─────────────────
  const [waPhone, setWaPhone] = useState("");
  const [waName, setWaName] = useState("");
  const [waSending, setWaSending] = useState(false);

  async function startWhatsApp(phone: string, name: string) {
    setWaSending(true);
    try {
      const res = await fetch("/api/ghl/conversations/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, contactName: name }),
      });
      const data = await res.json();
      if (data.ok) {
        // Navegar directamente a la bandeja de WhatsApp para escribir el mensaje
        window.location.href = "/admin/atencion-comercial/whatsapp";
      } else {
        toast.error("No se pudo abrir la conversación", {
          description: data.message?.slice(0, 100) ?? "Error desconocido",
          action: { label: "Abrir WA", onClick: () => { window.location.href = "/admin/atencion-comercial/whatsapp"; } },
        });
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setWaSending(false);
    }
  }

  return (
    <AdminLayout>
      <div className="min-h-screen bg-[#080e1c] text-white px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/25">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-white/30 text-xs mb-0.5">
                <Link href="/admin/crm" className="hover:text-white/60 transition-colors">CRM</Link>
                <ChevronRight className="w-3 h-3" />
                <span>Clientes</span>
              </div>
              <h1 className="text-xl font-bold text-white leading-none">Gestión de Clientes</h1>
              <p className="text-xs text-white/40 mt-0.5">Los clientes se crean automáticamente al recibir un lead</p>
            </div>
          </div>
          <Button
            onClick={() => setEditClient(null)}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white"
          >
            <Plus className="w-4 h-4 mr-2" /> Nuevo cliente
          </Button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl p-4 bg-blue-500/5 border border-blue-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-400">{clientsData?.total ?? 0}</div>
                <div className="text-white/40 text-xs">Total clientes</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4 bg-green-500/5 border border-green-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                <UserCheck className="w-4 h-4 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-green-400">{convertedCount}</div>
                <div className="text-white/40 text-xs">Convertidos</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4 bg-orange-500/5 border border-orange-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <UserPlus className="w-4 h-4 text-orange-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-400">{fromLeadCount}</div>
                <div className="text-white/40 text-xs">Desde lead</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4 bg-purple-500/5 border border-purple-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <Building2 className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-400">
                  {clientsList?.filter((c) => c.company).length ?? 0}
                </div>
                <div className="text-white/40 text-xs">Con empresa</div>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o empresa..."
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-4 py-3 text-white/40 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium">Contacto</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium">Empresa</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium">Estado</th>
                <th className="text-right px-4 py-3 text-white/40 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-12 text-white/30">Cargando...</td></tr>
              ) : !clientsList || clientsList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 rounded-full bg-white/5">
                        <Users className="w-8 h-8 text-white/20" />
                      </div>
                      <p className="text-white/30 text-sm">No hay clientes todavía</p>
                      <p className="text-white/20 text-xs">Se crearán automáticamente al recibir leads</p>
                    </div>
                  </td>
                </tr>
              ) : clientsList.map((client) => (
                <tr key={client.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-300 font-bold text-sm flex-shrink-0">
                        {client.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-medium">{client.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <SourceBadge source={client.source} leadId={client.leadId} />
                          {client.nif && (
                            <span className="text-white/25 text-[10px]">NIF: {client.nif}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-white/60 text-xs">
                        <Mail className="w-3 h-3" /> {client.email}
                      </div>
                      {client.phone && (
                        <div className="flex items-center gap-1.5 text-white/60 text-xs">
                          <Phone className="w-3 h-3" /> {client.phone}
                        </div>
                      )}
                      {client.city && (
                        <div className="flex items-center gap-1.5 text-white/40 text-xs">
                          <MapPin className="w-3 h-3" /> {client.city}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {client.company ? (
                      <div className="flex items-center gap-1.5 text-white/70 text-sm">
                        <Building2 className="w-3.5 h-3.5 text-white/30" /> {client.company}
                      </div>
                    ) : <span className="text-white/20 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {client.isConverted ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-300 text-xs">
                        <UserCheck className="w-3 h-3" /> Cliente
                      </span>
                    ) : client.source === "cupon" ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs"
                        title="Cliente captado desde cupón de plataforma externa"
                      >
                        <Ticket className="w-3 h-3" /> Lead Cupón
                      </span>
                    ) : (
                      <button
                        onClick={() => setExpandClient(client)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-300 text-xs hover:bg-orange-500/20 transition-colors cursor-pointer"
                        title="Ampliar datos para convertir en cliente"
                      >
                        <UserPlus className="w-3 h-3" /> Lead
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {client.phone && (
                        <Button size="sm" variant="ghost"
                          className="text-emerald-400 hover:text-emerald-300 h-7 px-2"
                          onClick={() => startWhatsApp(client.phone!, client.name)}
                          title="Iniciar WhatsApp"
                          disabled={waSending}>
                          <MessageCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost"
                        className="text-purple-400 hover:text-purple-300 h-7 px-2"
                        onClick={() => setHistoryClient(client)}
                        title="Ver historial completo">
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      {!client.isConverted && (
                        <Button size="sm" variant="ghost"
                          className="text-green-400 hover:text-green-300 h-7 px-2"
                          onClick={() => setExpandClient(client)}
                          title="Ampliar datos del cliente">
                          <UserCheck className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost"
                        className="text-blue-400 hover:text-blue-300 h-7 px-2"
                        onClick={() => setEditClient(client)}
                        title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost"
                        className="text-red-400/60 hover:text-red-400 h-7 px-2"
                        onClick={() => setDeleteClientId(client.id)}
                        title="Eliminar">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Client History Modal */}
      <Dialog open={historyClient !== null} onOpenChange={(o) => !o && setHistoryClient(null)}>
        {historyClient && (
          <ClientHistoryModal client={historyClient} onClose={() => setHistoryClient(null)} onStartWhatsApp={startWhatsApp} />
        )}
      </Dialog>

      {/* Expand Data Modal */}
      <Dialog open={expandClient !== null} onOpenChange={(o) => !o && setExpandClient(null)}>
        {expandClient && (
          <ExpandDataModal client={expandClient} onClose={() => setExpandClient(null)} />
        )}
      </Dialog>

      {/* Create / Edit Modal */}
      <Dialog open={editClient !== undefined} onOpenChange={(o) => !o && setEditClient(undefined)}>
        {editClient !== undefined && (
          <ClientFormModal client={editClient} onClose={() => setEditClient(undefined)} />
        )}
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteClientId !== null} onOpenChange={(o) => !o && setDeleteClientId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" /> Eliminar cliente
            </DialogTitle>
          </DialogHeader>
          <p className="text-white/60 text-sm">
            ¿Seguro que quieres eliminar este cliente? Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteClientId(null)}
              className="border-white/15 text-white/60">Cancelar</Button>
            <Button size="sm"
              onClick={() => deleteClientId && deleteClient.mutate({ id: deleteClientId })}
              disabled={deleteClient.isPending}
              className="bg-red-600 hover:bg-red-700 text-white">
              {deleteClient.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
