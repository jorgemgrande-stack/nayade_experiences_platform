import React, { useState } from "react";
import {
  Mail, Users, CreditCard, Calendar, AlertTriangle, Gift,
  Utensils, Wrench, ShieldCheck, FileText, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, RefreshCw, Copy, Eye,
} from "lucide-react";

// ─── Catálogo completo de plantillas del sistema ──────────────────────────────

type TemplateEntry = {
  key: string;
  name: string;
  trigger: string;
  function: string;
  sendToCustomer: boolean;
  sendToAdmin: boolean;
  hasReminders: boolean;
  reminderCount?: number;
  status: "active" | "inactive" | "manual_only";
  notes?: string;
};

type CategoryEntry = {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  templates: TemplateEntry[];
};

const CATALOG: CategoryEntry[] = [
  {
    id: "leads",
    label: "Leads",
    description: "Emails generados al recibir una solicitud de presupuesto web",
    icon: Users,
    color: "sky",
    templates: [
      {
        key: "budget_request_user",
        name: "Solicitud de presupuesto recibida (cliente)",
        trigger: "Cliente envía formulario de solicitud web",
        function: "buildBudgetRequestUserHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "budget_request_admin",
        name: "Notificación interna — nueva solicitud",
        trigger: "Cliente envía formulario de solicitud web",
        function: "buildBudgetRequestAdminHtml",
        sendToCustomer: false,
        sendToAdmin: true,
        hasReminders: false,
        status: "active",
      },
    ],
  },
  {
    id: "presupuestos",
    label: "Presupuestos",
    description: "Emails del ciclo de vida del presupuesto comercial",
    icon: FileText,
    color: "orange",
    templates: [
      {
        key: "quote",
        name: "Presupuesto enviado al cliente",
        trigger: "Operadora pulsa 'Enviar presupuesto' en el CRM",
        function: "buildQuoteHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: true,
        reminderCount: 2,
        status: "active",
        notes: "Envío manual; los recordatorios automáticos los hacen commercial_reminder_1/2/3 vía emailAutomationJob.",
      },
      {
        key: "commercial_reminder_1",
        name: "Recordatorio comercial #1",
        trigger: "emailAutomationJob — regla configurada",
        function: "buildCommercialReminder1Html",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "commercial_reminder_2",
        name: "Recordatorio comercial #2",
        trigger: "emailAutomationJob — regla configurada",
        function: "buildCommercialReminder2Html",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "commercial_reminder_3",
        name: "Recordatorio comercial #3 (último aviso)",
        trigger: "emailAutomationJob — regla configurada",
        function: "buildCommercialReminder3Html",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "proposal",
        name: "Propuesta comercial enviada",
        trigger: "Operadora envía propuesta desde módulo Propuestas",
        function: "buildProposalHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
    ],
  },
  {
    id: "reservas",
    label: "Reservas",
    description: "Confirmaciones y gestión de reservas",
    icon: Calendar,
    color: "emerald",
    templates: [
      {
        key: "reservation_confirm",
        name: "Reserva confirmada",
        trigger: "Pago confirmado vía Redsys o reserva manual confirmada por admin",
        function: "buildReservationConfirmHtml",
        sendToCustomer: true,
        sendToAdmin: true,
        hasReminders: false,
        status: "active",
      },
      {
        key: "reservation_failed",
        name: "Pago de reserva fallido",
        trigger: "Redsys devuelve error de pago",
        function: "buildReservationFailedHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "confirmation",
        name: "Confirmación genérica de reserva",
        trigger: "Reserva creada manualmente desde CRM",
        function: "buildConfirmationHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
    ],
  },
  {
    id: "pagos",
    label: "Pagos y transferencias",
    description: "Emails de pago pendiente, recordatorios y transferencias",
    icon: CreditCard,
    color: "violet",
    templates: [
      {
        key: "pending_payment",
        name: "Pago pendiente — aviso inicial",
        trigger: "Reserva creada sin pago completo",
        function: "buildPendingPaymentHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: true,
        reminderCount: 1,
        status: "active",
      },
      {
        key: "pending_payment_reminder",
        name: "Recordatorio de pago pendiente",
        trigger: "installmentOverdueJob — cuota vencida próxima",
        function: "buildPendingPaymentReminderHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "transfer_confirmation",
        name: "Confirmación de transferencia bancaria",
        trigger: "Admin confirma recepción de transferencia",
        function: "buildTransferConfirmationHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "installment_reminder",
        name: "Recordatorio de cuota fraccionada",
        trigger: "installmentOverdueJob — 3 días antes del vencimiento",
        function: "buildInstallmentReminderHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
    ],
  },
  {
    id: "anulaciones",
    label: "Anulaciones",
    description: "Emails del pipeline de gestión de anulaciones",
    icon: AlertTriangle,
    color: "red",
    templates: [
      {
        key: "cancellation_received",
        name: "Solicitud de anulación recibida",
        trigger: "Cliente envía formulario de anulación",
        function: "buildCancellationReceivedHtml",
        sendToCustomer: true,
        sendToAdmin: true,
        hasReminders: false,
        status: "active",
      },
      {
        key: "cancellation_rejected",
        name: "Anulación rechazada",
        trigger: "Admin rechaza solicitud de anulación",
        function: "buildCancellationRejectedHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "cancellation_accepted_refund",
        name: "Anulación aceptada — devolución económica",
        trigger: "Admin acepta con compensationType = devolucion",
        function: "buildCancellationAcceptedRefundHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "cancellation_accepted_voucher",
        name: "Anulación aceptada — bono compensatorio",
        trigger: "Admin acepta con compensationType = bono",
        function: "buildCancellationAcceptedVoucherHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "cancellation_documentation",
        name: "Solicitud de documentación adicional",
        trigger: "Admin solicita documentación al cliente",
        function: "buildCancellationDocumentationHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "cancellation_refund_executed",
        name: "Devolución ejecutada",
        trigger: "Admin marca devolución como ejecutada",
        function: "buildCancellationRefundExecutedHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
    ],
  },
  {
    id: "cupones",
    label: "Cupones",
    description: "Emails del pipeline de canje de cupones de plataformas externas",
    icon: Gift,
    color: "amber",
    templates: [
      {
        key: "coupon_received",
        name: "Solicitud de canje recibida",
        trigger: "Cliente envía formulario de canje de cupón",
        function: "buildCouponRedemptionReceivedHtml",
        sendToCustomer: true,
        sendToAdmin: true,
        hasReminders: false,
        status: "active",
      },
      {
        key: "coupon_postponed",
        name: "Cupón pospuesto",
        trigger: "Admin marca el cupón como pendiente",
        function: "buildCouponPostponedHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "coupon_internal_alert",
        name: "Alerta interna — nuevo envío de cupones",
        trigger: "Cliente envía uno o más cupones en un solo envío",
        function: "buildCouponInternalAlertHtml",
        sendToCustomer: false,
        sendToAdmin: true,
        hasReminders: false,
        status: "active",
      },
    ],
  },
  {
    id: "restaurantes",
    label: "Restaurantes",
    description: "Emails de reservas de restaurante",
    icon: Utensils,
    color: "rose",
    templates: [
      {
        key: "restaurant_confirm",
        name: "Reserva de restaurante confirmada",
        trigger: "Reserva de restaurante pagada o confirmada por admin",
        function: "buildRestaurantConfirmHtml",
        sendToCustomer: true,
        sendToAdmin: true,
        hasReminders: false,
        status: "active",
      },
      {
        key: "restaurant_payment_link",
        name: "Enlace de pago para restaurante",
        trigger: "Admin envía enlace de pago al cliente",
        function: "buildRestaurantPaymentLinkHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
    ],
  },
  {
    id: "operaciones",
    label: "Operaciones internas",
    description: "Emails de caja, TPV y operativa interna",
    icon: Wrench,
    color: "zinc",
    templates: [
      {
        key: "tpv_ticket",
        name: "Ticket de venta TPV",
        trigger: "Venta realizada desde el TPV presencial",
        function: "buildTpvTicketHtml",
        sendToCustomer: true,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
      },
      {
        key: "cash_open",
        name: "Apertura de caja",
        trigger: "Admin abre la caja del día",
        function: "buildCashOpenHtml",
        sendToCustomer: false,
        sendToAdmin: true,
        hasReminders: false,
        status: "active",
      },
      {
        key: "cash_close",
        name: "Cierre de caja",
        trigger: "Admin cierra la caja del día",
        function: "buildCashCloseHtml",
        sendToCustomer: false,
        sendToAdmin: true,
        hasReminders: false,
        status: "active",
      },
    ],
  },
  {
    id: "administracion",
    label: "Administración",
    description: "Emails del sistema de usuarios y accesos",
    icon: ShieldCheck,
    color: "teal",
    templates: [
      {
        key: "invite",
        name: "Invitación de usuario",
        trigger: "Admin invita a un nuevo usuario al sistema",
        function: "buildInviteHtml",
        sendToCustomer: false,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
        notes: "Enviado al email del nuevo usuario",
      },
      {
        key: "password_reset",
        name: "Recuperación de contraseña",
        trigger: "Usuario solicita reset de contraseña",
        function: "buildPasswordResetHtml",
        sendToCustomer: false,
        sendToAdmin: false,
        hasReminders: false,
        status: "active",
        notes: "Enviado al email del usuario con token TTL 60 min",
      },
    ],
  },
];

// ─── Color helpers ────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, { border: string; bg: string; text: string; badge: string }> = {
  sky:     { border: "border-sky-500/25",     bg: "bg-sky-500/5",     text: "text-sky-400",     badge: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  orange:  { border: "border-orange-500/25",  bg: "bg-orange-500/5",  text: "text-orange-400",  badge: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  emerald: { border: "border-emerald-500/25", bg: "bg-emerald-500/5", text: "text-emerald-400", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  violet:  { border: "border-violet-500/25",  bg: "bg-violet-500/5",  text: "text-violet-400",  badge: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  red:     { border: "border-red-500/25",     bg: "bg-red-500/5",     text: "text-red-400",     badge: "bg-red-500/15 text-red-300 border-red-500/30" },
  amber:   { border: "border-amber-500/25",   bg: "bg-amber-500/5",   text: "text-amber-400",   badge: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  rose:    { border: "border-rose-500/25",    bg: "bg-rose-500/5",    text: "text-rose-400",    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  zinc:    { border: "border-zinc-500/25",    bg: "bg-zinc-500/5",    text: "text-zinc-400",    badge: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  teal:    { border: "border-teal-500/25",    bg: "bg-teal-500/5",    text: "text-teal-400",    badge: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
};

// ─── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({ tmpl, color }: { tmpl: TemplateEntry; color: string }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.zinc;
  return (
    <div className="rounded-lg border border-foreground/[0.07] bg-background/60 p-3 space-y-2 hover:border-foreground/[0.14] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-foreground/85 leading-snug">{tmpl.name}</span>
        <span className={`shrink-0 inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
          tmpl.status === "active" ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/30" :
          tmpl.status === "inactive" ? "text-red-300 bg-red-500/15 border-red-500/30" :
          "text-amber-300 bg-amber-500/15 border-amber-500/30"
        }`}>
          {tmpl.status === "active" ? "Activa" : tmpl.status === "inactive" ? "Inactiva" : "Manual"}
        </span>
      </div>

      <div className="text-[10px] text-foreground/45 leading-relaxed">{tmpl.trigger}</div>

      <div className="flex flex-wrap gap-1.5 items-center">
        {tmpl.sendToCustomer && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
            <Mail className="w-2.5 h-2.5" /> Cliente
          </span>
        )}
        {tmpl.sendToAdmin && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
            <Copy className="w-2.5 h-2.5" /> Admin
          </span>
        )}
        {tmpl.hasReminders && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
            <RefreshCw className="w-2.5 h-2.5" /> {tmpl.reminderCount ?? "?"} reenvío{(tmpl.reminderCount ?? 1) !== 1 ? "s" : ""}
          </span>
        )}
        <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-foreground/30">
          {tmpl.function}
        </span>
      </div>

      {tmpl.notes && (
        <div className="text-[9px] text-foreground/35 italic border-t border-foreground/[0.05] pt-1.5">{tmpl.notes}</div>
      )}
    </div>
  );
}

// ─── Category block ────────────────────────────────────────────────────────────

function CategoryBlock({ cat }: { cat: CategoryEntry }) {
  const [open, setOpen] = useState(true);
  const c = COLOR_MAP[cat.color] ?? COLOR_MAP.zinc;
  const Icon = cat.icon;

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} overflow-hidden`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-foreground/[0.03] transition-colors"
      >
        <div className={`p-1.5 rounded-lg bg-background/40`}>
          <Icon className={`w-4 h-4 ${c.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${c.text}`}>{cat.label}</div>
          <div className="text-[10px] text-foreground/40">{cat.description}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.badge}`}>
            {cat.templates.length} plantilla{cat.templates.length !== 1 ? "s" : ""}
          </span>
          {open ? <ChevronDown className="w-3.5 h-3.5 text-foreground/30" /> : <ChevronRight className="w-3.5 h-3.5 text-foreground/30" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {cat.templates.map(t => (
            <TemplateCard key={t.key} tmpl={t} color={cat.color} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function CommunicationsMap() {
  const [search, setSearch] = useState("");
  const totalTemplates = CATALOG.reduce((s, c) => s + c.templates.length, 0);
  const activeTemplates = CATALOG.reduce(
    (s, c) => s + c.templates.filter(t => t.status === "active").length, 0
  );
  const withReminders = CATALOG.reduce(
    (s, c) => s + c.templates.filter(t => t.hasReminders).length, 0
  );
  const adminOnly = CATALOG.reduce(
    (s, c) => s + c.templates.filter(t => !t.sendToCustomer && t.sendToAdmin).length, 0
  );

  const filteredCatalog = search.trim()
    ? CATALOG.map(cat => ({
        ...cat,
        templates: cat.templates.filter(
          t => t.name.toLowerCase().includes(search.toLowerCase()) ||
               t.trigger.toLowerCase().includes(search.toLowerCase()) ||
               t.function.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(cat => cat.templates.length > 0)
    : CATALOG;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-foreground/[0.08] bg-background p-4">
          <div className="text-xs text-foreground/50 mb-1">Total plantillas</div>
          <div className="text-2xl font-bold text-foreground">{totalTemplates}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-xs text-foreground/50 mb-1">Activas</div>
          <div className="text-2xl font-bold text-emerald-400">{activeTemplates}</div>
        </div>
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
          <div className="text-xs text-foreground/50 mb-1">Con reenvíos</div>
          <div className="text-2xl font-bold text-purple-400">{withReminders}</div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="text-xs text-foreground/50 mb-1">Solo admin</div>
          <div className="text-2xl font-bold text-amber-400">{adminOnly}</div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Buscar plantilla, disparador o función…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 h-8 px-3 text-xs bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-orange-400/50"
        />
        <a
          href="/admin/plantillas-email"
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-foreground/[0.06] hover:bg-foreground/[0.10] text-foreground/70 transition-colors"
        >
          <Eye className="w-3 h-3" />
          Editar plantillas
        </a>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-4 py-3 flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div className="text-[11px] text-foreground/60 leading-relaxed">
          <strong className="text-foreground/80">Modo lectura.</strong> Este mapa refleja las plantillas codificadas en{" "}
          <code className="text-sky-300/80">server/emailTemplates.ts</code>. El estado "Activa" indica que el disparador backend existe y está conectado.
          Para editar el HTML de cada plantilla, usa el módulo{" "}
          <a href="/admin/plantillas-email" className="underline text-sky-300 hover:text-sky-200">Plantillas de email</a>.
        </div>
      </div>

      {/* Catalog */}
      <div className="space-y-4">
        {filteredCatalog.length === 0 ? (
          <div className="text-center py-12 text-foreground/30 text-sm">No se encontraron plantillas para "{search}"</div>
        ) : (
          filteredCatalog.map(cat => <CategoryBlock key={cat.id} cat={cat} />)
        )}
      </div>

      {/* Legend */}
      <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3 flex flex-wrap gap-4 text-[10px] text-foreground/40">
        <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-sky-400" /> Se envía al cliente</span>
        <span className="flex items-center gap-1"><Copy className="w-3 h-3 text-amber-400" /> Se envía/copia al admin</span>
        <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 text-purple-400" /> Tiene reenvíos programados</span>
        <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-400" /> Plantilla activa</span>
        <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" /> Plantilla inactiva</span>
      </div>
    </div>
  );
}
