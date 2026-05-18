import React, { useState } from "react";

type AuditStatus = "ok" | "warning" | "unknown";
type Recipient = "client" | "admin" | "both" | "user";
type TriggerType = "event" | "cron" | "manual" | "unknown";

interface AuditEntry {
  id: string;
  category: string;
  functionName: string;
  friendlyName: string;
  trigger: string;
  triggerType: TriggerType;
  sendsToClient: boolean;
  sendsToAdmin: boolean;
  recipient: Recipient;
  hasFunction: boolean;
  hasSubject: boolean;
  hasBody: boolean;
  isCronDriven: boolean;
  cronSource?: string;
  status: AuditStatus;
  notes?: string;
}

const AUDIT_DATA: AuditEntry[] = [
  // ── LEADS ─────────────────────────────────────────────────────────────────
  {
    id: "budget_request_user",
    category: "Leads",
    functionName: "buildBudgetRequestUserHtml",
    friendlyName: "Solicitud de presupuesto (confirmación cliente)",
    trigger: "Envío de formulario de contacto",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "budget_request_admin",
    category: "Leads",
    functionName: "buildBudgetRequestAdminHtml",
    friendlyName: "Solicitud de presupuesto (aviso admin)",
    trigger: "Envío de formulario de contacto",
    triggerType: "event",
    sendsToClient: false,
    sendsToAdmin: true,
    recipient: "admin",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },

  // ── PRESUPUESTOS ───────────────────────────────────────────────────────────
  {
    id: "quote",
    category: "Presupuestos",
    functionName: "buildQuoteHtml",
    friendlyName: "Email de presupuesto",
    trigger: "Envío manual desde CRM (no auto-programado: 'quote' está en LEGACY_CRON_TEMPLATES)",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: true,
    cronSource: null,
    status: "ok",
    notes: "Envío manual únicamente. Los recordatorios automáticos los gestionan commercial_reminder_1/2/3 vía emailAutomationJob.",
  },
  {
    id: "proposal",
    category: "Presupuestos",
    functionName: "buildProposalHtml",
    friendlyName: "Propuesta comercial",
    trigger: "Envío manual de propuesta desde CRM",
    triggerType: "manual",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "commercial_reminder_1",
    category: "Presupuestos",
    functionName: "buildCommercialReminder1Html",
    friendlyName: "Recordatorio comercial #1",
    trigger: "emailAutomationJob — primer recordatorio por regla",
    triggerType: "cron",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: true,
    cronSource: "emailAutomationJob (cada 10 min, flag: email_automation_job_enabled)",
    status: "ok",
  },
  {
    id: "commercial_reminder_2",
    category: "Presupuestos",
    functionName: "buildCommercialReminder2Html",
    friendlyName: "Recordatorio comercial #2",
    trigger: "emailAutomationJob — segundo recordatorio por regla",
    triggerType: "cron",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: true,
    cronSource: "emailAutomationJob (cada 10 min, flag: email_automation_job_enabled)",
    status: "ok",
  },
  {
    id: "commercial_reminder_3",
    category: "Presupuestos",
    functionName: "buildCommercialReminder3Html",
    friendlyName: "Recordatorio comercial #3",
    trigger: "emailAutomationJob — tercer recordatorio por regla",
    triggerType: "cron",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: true,
    cronSource: "emailAutomationJob (cada 10 min, flag: email_automation_job_enabled)",
    status: "ok",
  },

  // ── RESERVAS ───────────────────────────────────────────────────────────────
  {
    id: "reservation_confirm",
    category: "Reservas",
    functionName: "buildReservationConfirmHtml",
    friendlyName: "Confirmación de reserva",
    trigger: "Pago TPV / Redsys confirmado",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "reservation_failed",
    category: "Reservas",
    functionName: "buildReservationFailedHtml",
    friendlyName: "Fallo en pago de reserva",
    trigger: "Pago TPV rechazado o fallido",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "confirmation",
    category: "Reservas",
    functionName: "buildConfirmationHtml",
    friendlyName: "Confirmación completa (post-pago)",
    trigger: "postConfirmOperation — tras confirmar reserva con todos los detalles",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },

  // ── PAGOS / TRANSFERENCIAS ─────────────────────────────────────────────────
  {
    id: "transfer_confirmation",
    category: "Pagos / Transferencias",
    functionName: "buildTransferConfirmationHtml",
    friendlyName: "Confirmación de transferencia",
    trigger: "Confirmación manual de pago por transferencia",
    triggerType: "event",
    sendsToClient: false,
    sendsToAdmin: true,
    recipient: "admin",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "pending_payment",
    category: "Pagos / Transferencias",
    functionName: "buildPendingPaymentHtml",
    friendlyName: "Aviso pago pendiente",
    trigger: "Reserva con pago pendiente (link de pago generado)",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "pending_payment_reminder",
    category: "Pagos / Transferencias",
    functionName: "buildPendingPaymentReminderHtml",
    friendlyName: "Recordatorio pago pendiente",
    trigger: "Recordatorio manual o automático de pago pendiente",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "installment_reminder",
    category: "Pagos / Transferencias",
    functionName: "buildInstallmentReminderHtml",
    friendlyName: "Recordatorio de cuota",
    trigger: "Cuota próxima a vencer — envío manual o automático",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },

  // ── ANULACIONES ────────────────────────────────────────────────────────────
  {
    id: "cancellation_received",
    category: "Anulaciones",
    functionName: "buildCancellationReceivedHtml",
    friendlyName: "Anulación recibida (confirmación al cliente)",
    trigger: "cancellations.createRequest",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "cancellation_rejected",
    category: "Anulaciones",
    functionName: "buildCancellationRejectedHtml",
    friendlyName: "Anulación rechazada",
    trigger: "cancellations.rejectRequest",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "cancellation_accepted_refund",
    category: "Anulaciones",
    functionName: "buildCancellationAcceptedRefundHtml",
    friendlyName: "Anulación aceptada — devolución",
    trigger: "cancellations.acceptRequest (compensationType = devolucion)",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "cancellation_accepted_voucher",
    category: "Anulaciones",
    functionName: "buildCancellationAcceptedVoucherHtml",
    friendlyName: "Anulación aceptada — bono",
    trigger: "cancellations.acceptRequest (compensationType = bono)",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "cancellation_documentation",
    category: "Anulaciones",
    functionName: "buildCancellationDocumentationHtml",
    friendlyName: "Solicitud de documentación de anulación",
    trigger: "Sin trigger confirmado — función definida pero no localizado en router",
    triggerType: "unknown",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "warning",
    notes: "Función creada pero no se ha encontrado un trigger explícito en cancellations.ts. Verificar si está en uso.",
  },
  {
    id: "cancellation_refund_executed",
    category: "Anulaciones",
    functionName: "buildCancellationRefundExecutedHtml",
    friendlyName: "Devolución ejecutada",
    trigger: "Acción admin de devolución ejecutada en expediente de anulación",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },

  // ── CUPONES ────────────────────────────────────────────────────────────────
  {
    id: "coupon_received",
    category: "Cupones",
    functionName: "buildCouponRedemptionReceivedHtml",
    friendlyName: "Cupón recibido / confirmación",
    trigger: "ticketing.createSubmission / ticketing.createRedemption",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: true,
    recipient: "both",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "coupon_postponed",
    category: "Cupones",
    functionName: "buildCouponPostponedHtml",
    friendlyName: "Cupón pospuesto",
    trigger: "ticketing.postponeCoupon",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "coupon_internal_alert",
    category: "Cupones",
    functionName: "buildCouponInternalAlertHtml",
    friendlyName: "Alerta interna de cupón (incidencia)",
    trigger: "ticketing.markIncidence",
    triggerType: "event",
    sendsToClient: false,
    sendsToAdmin: true,
    recipient: "admin",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },

  // ── RESTAURANTES ───────────────────────────────────────────────────────────
  {
    id: "restaurant_confirm",
    category: "Restaurantes",
    functionName: "buildRestaurantConfirmHtml",
    friendlyName: "Confirmación de reserva de restaurante",
    trigger: "Confirmación de reserva de restaurante",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "restaurant_payment_link",
    category: "Restaurantes",
    functionName: "buildRestaurantPaymentLinkHtml",
    friendlyName: "Link de pago de restaurante",
    trigger: "Generación de link de pago para reserva de restaurante",
    triggerType: "event",
    sendsToClient: true,
    sendsToAdmin: false,
    recipient: "client",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },

  // ── OPERACIONES INTERNAS ───────────────────────────────────────────────────
  {
    id: "tpv_ticket",
    category: "Operaciones internas",
    functionName: "buildTpvTicketHtml",
    friendlyName: "Ticket TPV / terminal de tarjeta",
    trigger: "Pago procesado por terminal de tarjeta",
    triggerType: "event",
    sendsToClient: false,
    sendsToAdmin: true,
    recipient: "admin",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "cash_open",
    category: "Operaciones internas",
    functionName: "buildCashOpenHtml",
    friendlyName: "Apertura de caja",
    trigger: "Apertura de sesión de caja registradora",
    triggerType: "event",
    sendsToClient: false,
    sendsToAdmin: true,
    recipient: "admin",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "cash_close",
    category: "Operaciones internas",
    functionName: "buildCashCloseHtml",
    friendlyName: "Cierre de caja",
    trigger: "Cierre de sesión de caja registradora",
    triggerType: "event",
    sendsToClient: false,
    sendsToAdmin: true,
    recipient: "admin",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },

  // ── ADMINISTRACIÓN ─────────────────────────────────────────────────────────
  {
    id: "invite",
    category: "Administración",
    functionName: "buildInviteHtml",
    friendlyName: "Invitación de usuario",
    trigger: "Invitación de nuevo usuario al sistema",
    triggerType: "event",
    sendsToClient: false,
    sendsToAdmin: false,
    recipient: "user",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
  {
    id: "password_reset",
    category: "Administración",
    functionName: "buildPasswordResetHtml",
    friendlyName: "Reset de contraseña",
    trigger: "Solicitud de recuperación de contraseña",
    triggerType: "event",
    sendsToClient: false,
    sendsToAdmin: false,
    recipient: "user",
    hasFunction: true,
    hasSubject: true,
    hasBody: true,
    isCronDriven: false,
    status: "ok",
  },
];

const CATEGORIES = Array.from(new Set(AUDIT_DATA.map((e) => e.category)));

const STATUS_CONFIG = {
  ok: { label: "OK", color: "text-green-400", bg: "bg-green-900/20", icon: "✓" },
  warning: { label: "Revisar", color: "text-yellow-400", bg: "bg-yellow-900/20", icon: "⚠" },
  unknown: { label: "Sin trigger", color: "text-gray-500", bg: "bg-gray-900/20", icon: "?" },
};

const RECIPIENT_CONFIG = {
  client: { label: "Cliente", color: "text-blue-300 bg-blue-900/30" },
  admin: { label: "Admin", color: "text-purple-300 bg-purple-900/30" },
  both: { label: "Ambos", color: "text-teal-300 bg-teal-900/30" },
  user: { label: "Usuario", color: "text-indigo-300 bg-indigo-900/30" },
};

const TRIGGER_CONFIG: Record<TriggerType, { label: string; color: string }> = {
  event: { label: "Evento", color: "text-cyan-400" },
  cron: { label: "Cron", color: "text-amber-400" },
  manual: { label: "Manual", color: "text-gray-400" },
  unknown: { label: "Desconocido", color: "text-red-400" },
};

function CheckMark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="text-green-400 text-sm">✓</span>
  ) : (
    <span className="text-red-400 text-sm">✗</span>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const sc = STATUS_CONFIG[entry.status];
  const rc = RECIPIENT_CONFIG[entry.recipient];
  const tc = TRIGGER_CONFIG[entry.triggerType];

  return (
    <tr className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors">
      {/* Category */}
      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{entry.category}</td>

      {/* Function + friendly name */}
      <td className="px-3 py-2 min-w-0">
        <div className="font-mono text-xs text-white">{entry.functionName}</div>
        <div className="text-xs text-gray-500 mt-0.5">{entry.friendlyName}</div>
      </td>

      {/* Trigger */}
      <td className="px-3 py-2">
        <div className={`text-xs font-medium ${tc.color}`}>{tc.label}</div>
        <div className="text-xs text-gray-400 mt-0.5 max-w-[200px] leading-relaxed">{entry.trigger}</div>
      </td>

      {/* Recipient */}
      <td className="px-3 py-2 text-center">
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${rc.color}`}>{rc.label}</span>
      </td>

      {/* Checks */}
      <td className="px-3 py-2 text-center">
        <CheckMark ok={entry.hasFunction} />
      </td>
      <td className="px-3 py-2 text-center">
        <CheckMark ok={entry.hasSubject} />
      </td>
      <td className="px-3 py-2 text-center">
        <CheckMark ok={entry.hasBody} />
      </td>
      <td className="px-3 py-2 text-center">
        {entry.isCronDriven ? (
          <span className="text-amber-400 text-sm" title={entry.cronSource}>⏱</span>
        ) : (
          <span className="text-gray-700 text-sm">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-2 text-center">
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>
          <span>{sc.icon}</span>
          <span>{sc.label}</span>
        </span>
        {entry.notes && (
          <div className="text-xs text-yellow-500 mt-1 max-w-[140px] leading-relaxed">{entry.notes}</div>
        )}
      </td>
    </tr>
  );
}

export default function EmailAuditTab() {
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = AUDIT_DATA.filter((e) => {
    if (filterCategory !== "all" && e.category !== filterCategory) return false;
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.functionName.toLowerCase().includes(q) ||
        e.friendlyName.toLowerCase().includes(q) ||
        e.trigger.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const total = AUDIT_DATA.length;
  const okCount = AUDIT_DATA.filter((e) => e.status === "ok").length;
  const warnCount = AUDIT_DATA.filter((e) => e.status === "warning").length;
  const cronCount = AUDIT_DATA.filter((e) => e.isCronDriven).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-white">Auditoría de plantillas de email</h2>
        <p className="text-sm text-gray-400 mt-1">
          Estado de las {total} funciones de plantilla definidas en{" "}
          <span className="font-mono text-gray-300">server/emailTemplates.ts</span>. Solo lectura.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-white">{total}</div>
          <div className="text-xs text-gray-500 mt-1">Plantillas totales</div>
        </div>
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-400">{okCount}</div>
          <div className="text-xs text-gray-500 mt-1">Sin incidencias</div>
        </div>
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-yellow-400">{warnCount}</div>
          <div className="text-xs text-gray-500 mt-1">Requieren revisión</div>
        </div>
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-amber-400">{cronCount}</div>
          <div className="text-xs text-gray-500 mt-1">Accionadas por cron</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar plantilla..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-white rounded px-3 py-1.5 w-48 focus:outline-none focus:border-[#444]"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-gray-300 rounded px-3 py-1.5 focus:outline-none"
        >
          <option value="all">Todas las categorías</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-gray-300 rounded px-3 py-1.5 focus:outline-none"
        >
          <option value="all">Todos los estados</option>
          <option value="ok">OK</option>
          <option value="warning">Revisar</option>
          <option value="unknown">Sin trigger</option>
        </select>
        {(filterCategory !== "all" || filterStatus !== "all" || search) && (
          <button
            onClick={() => { setFilterCategory("all"); setFilterStatus("all"); setSearch(""); }}
            className="text-xs text-gray-500 hover:text-white transition-colors px-2"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="bg-[#111] border-b border-[#2a2a2a]">
              <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Categoría</th>
              <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Función / Nombre</th>
              <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Trigger</th>
              <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium">Destinatario</th>
              <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium" title="Función definida">Fn</th>
              <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium" title="Subject definido">Subj</th>
              <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium" title="Body definido">Body</th>
              <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium" title="Accionada por cron">Cron</th>
              <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-600 text-sm">
                  Sin resultados para los filtros actuales
                </td>
              </tr>
            ) : (
              filtered.map((entry) => <AuditRow key={entry.id} entry={entry} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="border border-[#2a2a2a] rounded-lg p-3 text-xs text-gray-500 flex flex-wrap gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-green-400">✓</span> Sin incidencias
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-yellow-400">⚠</span> Función existe pero requiere atención
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-amber-400">⏱</span> Accionada automáticamente por cron
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-cyan-400">Evento</span> — trigger directo (tRPC / API)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-amber-400">Cron</span> — dispara el job programado
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">Manual</span> — envío manual desde CRM
        </div>
      </div>
    </div>
  );
}
