import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Search, Building2, Users, Edit2, ToggleLeft, ToggleRight,
  ChevronRight, Mail, Phone, X, Check, AlertCircle, UserPlus, Trash2,
  CreditCard, RefreshCw, KeyRound, Send, Eye, EyeOff,
  ClipboardList, CalendarDays, TrendingUp, Euro, BellRing, Megaphone,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Tab = "partners" | "detail";

type Partner = {
  id: number;
  name: string;
  slug: string;
  fiscalName?: string | null;
  nif?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  billingEmail?: string | null;
  canCreateReservations: boolean;
  canCreateLeads: boolean;
  allowedReservationProductIds?: number[] | null | unknown;
  allowedLeadProductIds?: number[] | null | unknown;
  commissionType: string;
  commissionValue?: string | null;
  billingEnabled: boolean;
  billingPeriod: string;
  monthlyQuota?: number | null;
  isActive: boolean;
  notes?: string | null;
  createdAt: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMMISSION_LABELS: Record<string, string> = {
  none: "Sin comisión",
  fixed_lead: "Fija por lead",
  fixed_reservation: "Fija por reserva",
  percent: "Porcentual",
  per_product: "Por producto",
  manual: "Manual",
};

const BILLING_PERIOD_LABELS: Record<string, string> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  manual: "Manual",
};

// ─── Formulario de partner ────────────────────────────────────────────────────

type PartnerFormData = {
  name: string;
  fiscalName: string;
  nif: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  billingEmail: string;
  canCreateReservations: boolean;
  canCreateLeads: boolean;
  allowedReservationProductIds: number[];
  commissionType: string;
  commissionValue: string;
  billingEnabled: boolean;
  billingPeriod: string;
  monthlyQuota: string;
  notes: string;
};

const EMPTY_FORM: PartnerFormData = {
  name: "", fiscalName: "", nif: "", address: "", city: "", postalCode: "",
  country: "ES", contactName: "", contactEmail: "", contactPhone: "",
  billingEmail: "", canCreateReservations: false, canCreateLeads: true,
  allowedReservationProductIds: [],
  commissionType: "none", commissionValue: "", billingEnabled: false,
  billingPeriod: "monthly", monthlyQuota: "", notes: "",
};

function PartnerForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<PartnerFormData>;
  onSave: (data: PartnerFormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<PartnerFormData>({ ...EMPTY_FORM, ...initial });
  const set = (k: keyof PartnerFormData, v: any) => setForm(f => ({ ...f, [k]: v }));
  const { data: allProducts = [] } = trpc.partners.adminGetAllProducts.useQuery();

  function toggleProduct(id: number) {
    setForm(f => ({
      ...f,
      allowedReservationProductIds: f.allowedReservationProductIds.includes(id)
        ? f.allowedReservationProductIds.filter(x => x !== id)
        : [...f.allowedReservationProductIds, id],
    }));
  }

  return (
    <div className="space-y-6">
      {/* Identificación */}
      <section>
        <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider mb-3">Identificación</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Nombre del partner *</label>
            <Input value={form.name} onChange={e => set("name", e.target.value)}
              placeholder="Hotel Nayade" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Razón social fiscal</label>
            <Input value={form.fiscalName} onChange={e => set("fiscalName", e.target.value)}
              placeholder="Hotel Nayade S.L." className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">NIF / CIF</label>
            <Input value={form.nif} onChange={e => set("nif", e.target.value)}
              placeholder="B12345678" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Ciudad</label>
            <Input value={form.city} onChange={e => set("city", e.target.value)}
              placeholder="Albacete" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-foreground/50 mb-1 block">Dirección</label>
            <Input value={form.address} onChange={e => set("address", e.target.value)}
              placeholder="Calle Mayor 1" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
        </div>
      </section>

      {/* Contacto */}
      <section>
        <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider mb-3">Contacto</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Persona de contacto</label>
            <Input value={form.contactName} onChange={e => set("contactName", e.target.value)}
              placeholder="Ana García" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Email de contacto</label>
            <Input type="email" value={form.contactEmail} onChange={e => set("contactEmail", e.target.value)}
              placeholder="contacto@hotel.com" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Teléfono</label>
            <Input value={form.contactPhone} onChange={e => set("contactPhone", e.target.value)}
              placeholder="+34 600 000 000" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Email de facturación</label>
            <Input type="email" value={form.billingEmail} onChange={e => set("billingEmail", e.target.value)}
              placeholder="facturas@hotel.com" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
        </div>
      </section>

      {/* Capacidades */}
      <section>
        <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider mb-3">Capacidades</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.canCreateLeads}
              onChange={e => set("canCreateLeads", e.target.checked)}
              className="w-4 h-4 rounded border-foreground/30" />
            <span className="text-sm text-foreground">
              Puede crear oportunidades comerciales (leads)
              <span className="text-xs text-foreground/40 ml-1">— Situación 2</span>
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.canCreateReservations}
              onChange={e => set("canCreateReservations", e.target.checked)}
              className="w-4 h-4 rounded border-foreground/30" />
            <span className="text-sm text-foreground">
              Puede crear reservas directas confirmadas
              <span className="text-xs text-foreground/40 ml-1">— Situación 1</span>
            </span>
          </label>

          {/* Selector de productos permitidos */}
          {(form.canCreateReservations || form.canCreateLeads) && (
            <div className="ml-1 mt-2 p-3 bg-foreground/[0.04] border border-foreground/[0.10] rounded-xl space-y-2">
              <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">
                Productos permitidos para reservar
                <span className="ml-2 font-normal text-foreground/30 normal-case">(vacío = todos)</span>
              </p>
              {allProducts.length === 0 ? (
                <p className="text-xs text-foreground/30">Cargando productos…</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
                  {allProducts.map((p: any) => {
                    const checked = form.allowedReservationProductIds.includes(p.id);
                    return (
                      <label key={p.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all text-xs ${
                        checked
                          ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                          : "border-foreground/[0.10] text-foreground/50 hover:border-foreground/20"
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProduct(p.id)}
                          className="accent-orange-500 shrink-0"
                        />
                        <span className="truncate">{p.title}</span>
                        {p.basePrice && (
                          <span className="ml-auto shrink-0 text-foreground/30">{parseFloat(p.basePrice).toFixed(0)}€</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
              {form.allowedReservationProductIds.length > 0 && (
                <p className="text-[10px] text-orange-400/70">
                  {form.allowedReservationProductIds.length} producto{form.allowedReservationProductIds.length !== 1 ? "s" : ""} seleccionado{form.allowedReservationProductIds.length !== 1 ? "s" : ""}
                  {" "}— los demás no estarán disponibles para este partner
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Facturación */}
      <section>
        <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider mb-3">Facturación agrupada</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.billingEnabled}
              onChange={e => set("billingEnabled", e.target.checked)}
              className="w-4 h-4 rounded border-foreground/30" />
            <span className="text-sm text-foreground">Activar facturación agrupada por período</span>
          </label>
          {form.billingEnabled && (
            <div className="ml-7">
              <label className="text-xs text-foreground/50 mb-1 block">Periodicidad</label>
              <select value={form.billingPeriod} onChange={e => set("billingPeriod", e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-foreground/[0.12] bg-foreground/[0.05] text-white w-full sm:w-auto">
                {Object.entries(BILLING_PERIOD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Comisiones */}
      <section>
        <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider mb-3">
          Comisiones <span className="text-xs font-normal text-foreground/30">(preparado para futuro)</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Tipo de comisión</label>
            <select value={form.commissionType} onChange={e => set("commissionType", e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-foreground/[0.12] bg-foreground/[0.05] text-white w-full">
              {Object.entries(COMMISSION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          {form.commissionType !== "none" && (
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">
                Valor {form.commissionType === "percent" ? "(%)" : "(€)"}
              </label>
              <Input type="number" value={form.commissionValue} onChange={e => set("commissionValue", e.target.value)}
                placeholder="0.00" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
            </div>
          )}
        </div>
      </section>

      {/* Cupos y notas */}
      <section>
        <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider mb-3">Opciones adicionales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Cupo mensual <span className="text-foreground/30">(vacío = sin límite)</span></label>
            <Input type="number" value={form.monthlyQuota} onChange={e => set("monthlyQuota", e.target.value)}
              placeholder="Sin límite" className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <label className="text-xs text-foreground/50 mb-1 block">Notas internas</label>
            <Input value={form.notes} onChange={e => set("notes", e.target.value)}
              placeholder="Observaciones..." className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
        </div>
      </section>

      {/* Acciones */}
      <div className="flex justify-end gap-2 pt-2 border-t border-foreground/[0.08]">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button onClick={() => onSave(form)} disabled={saving || !form.name.trim()}
          className="bg-orange-600 hover:bg-orange-700 text-white">
          {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
          Guardar
        </Button>
      </div>
    </div>
  );
}

// ─── Panel de usuarios del partner ───────────────────────────────────────────

function PartnerUsersPanel({ partnerId, partnerName }: { partnerId: number; partnerName: string }) {
  const utils = trpc.useUtils();
  const { data: users, isLoading } = trpc.partners.listUsers.useQuery({ partnerId });

  const inviteMut = trpc.partners.inviteUser.useMutation({
    onSuccess: () => {
      utils.partners.listUsers.invalidate();
      setShowInvite(false);
      setInviteForm({ name: "", email: "", role: "partner_user" });
      toast.success("Invitación enviada", { description: "El usuario recibirá un email con el enlace de activación." });
    },
    onError: (e) => toast.error("Error al invitar: " + e.message),
  });

  const resendMut = trpc.partners.inviteUser.useMutation({
    onSuccess: () => {
      utils.partners.listUsers.invalidate();
      toast.success("Invitación reenviada", { description: "Se ha generado un nuevo enlace de activación." });
    },
    onError: (e) => toast.error("Error al reenviar: " + e.message),
  });

  const setPasswordMut = trpc.admin.setUserPassword.useMutation({
    onSuccess: () => {
      setPasswordTarget(null);
      setNewPassword("");
      setShowPwd(false);
      toast.success("Contraseña actualizada correctamente");
    },
    onError: (e) => toast.error("Error al cambiar contraseña: " + e.message),
  });

  const removeMut = trpc.partners.removeUser.useMutation({
    onSuccess: () => { utils.partners.listUsers.invalidate(); toast.success("Usuario desvinculado"); },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: "", email: "", role: "partner_user" });
  const [passwordTarget, setPasswordTarget] = useState<{ id: number; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider">Usuarios / Recepcionistas</h3>
        <Button size="sm" onClick={() => setShowInvite(true)}
          className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-8">
          <UserPlus className="w-3.5 h-3.5 mr-1" /> Invitar
        </Button>
      </div>

      {showInvite && (
        <div className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-xl p-4 space-y-3">
          <p className="text-xs text-foreground/50">Nuevo recepcionista para <strong>{partnerName}</strong></p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="Nombre" value={inviteForm.name}
              onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm" />
            <Input placeholder="Email" type="email" value={inviteForm.email}
              onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm" />
            <select value={inviteForm.role}
              onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}
              className="px-3 py-2 text-sm rounded-lg border border-foreground/[0.12] bg-foreground/[0.05] text-white">
              <option value="partner_user">Recepcionista</option>
              <option value="partner_admin">Admin del partner</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowInvite(false)}>Cancelar</Button>
            <Button size="sm"
              onClick={() => inviteMut.mutate({ partnerId, name: inviteForm.name, email: inviteForm.email, role: inviteForm.role as any })}
              disabled={inviteMut.isPending || !inviteForm.name || !inviteForm.email}
              className="bg-orange-600 hover:bg-orange-700 text-white text-xs">
              {inviteMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Enviar invitación"}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-6"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-foreground/30" /></div>
      ) : !users?.length ? (
        <div className="text-center py-8 text-foreground/30 text-sm">Sin usuarios vinculados todavía</div>
      ) : (
        <div className="divide-y divide-foreground/[0.08]">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-3 py-3">
              <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-orange-400">{(u.name ?? "?")[0].toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{u.name ?? "—"}</div>
                <div className="text-xs text-foreground/40 truncate">{u.email ?? "—"}</div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                u.role === "partner_admin"
                  ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
                  : "bg-blue-500/15 text-blue-400 border-blue-500/30"
              }`}>
                {u.role === "partner_admin" ? "Admin" : "Recepcionista"}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                u.inviteAccepted
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-400 border-amber-500/30"
              }`}>
                {u.inviteAccepted ? "Activo" : "Pendiente"}
              </span>

              {/* Reenviar invitación (solo si pendiente) */}
              {!u.inviteAccepted && (
                <Button size="sm" variant="ghost"
                  title="Reenviar enlace de activación"
                  className="text-foreground/30 hover:text-blue-400 h-7 w-7 p-0"
                  disabled={resendMut.isPending}
                  onClick={() => resendMut.mutate({ partnerId, name: u.name ?? "", email: u.email ?? "", role: u.role as any })}>
                  <Send className="w-3.5 h-3.5" />
                </Button>
              )}

              {/* Cambiar contraseña */}
              <Button size="sm" variant="ghost"
                title="Cambiar contraseña"
                className="text-foreground/30 hover:text-violet-400 h-7 w-7 p-0"
                onClick={() => { setPasswordTarget({ id: u.id, name: u.name ?? u.email ?? "usuario" }); setNewPassword(""); setShowPwd(false); }}>
                <KeyRound className="w-3.5 h-3.5" />
              </Button>

              {/* Desvincular */}
              <Button size="sm" variant="ghost"
                title="Desvincular usuario"
                className="text-foreground/30 hover:text-red-400 h-7 w-7 p-0"
                onClick={() => { if (confirm("¿Desvincular usuario?")) removeMut.mutate({ userId: u.id }); }}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal cambiar contraseña ── */}
      <Dialog open={!!passwordTarget} onOpenChange={(open) => { if (!open) { setPasswordTarget(null); setNewPassword(""); setShowPwd(false); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-violet-600" />
              Cambiar contraseña — {passwordTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="partner-new-password" className="text-sm text-gray-600">
              Nueva contraseña (mínimo 8 caracteres)
            </Label>
            <div className="relative">
              <Input
                id="partner-new-password"
                type={showPwd ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPwd(v => !v)}
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPasswordTarget(null); setNewPassword(""); setShowPwd(false); }}>
              Cancelar
            </Button>
            <Button
              onClick={() => passwordTarget && setPasswordMut.mutate({ userId: passwordTarget.id, password: newPassword })}
              disabled={newPassword.length < 8 || setPasswordMut.isPending}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {setPasswordMut.isPending ? "Guardando..." : "Guardar contraseña"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Panel de operaciones del partner (leads + reservas) ─────────────────────

const LEAD_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  nuevo:      { label: "Nuevo",      color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  contactado: { label: "Contactado", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  en_proceso: { label: "En proceso", color: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  convertido: { label: "Convertido", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  perdido:    { label: "Perdido",    color: "bg-red-500/15 text-red-400 border-red-500/30" },
};

const RES_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDIENTE_CONFIRMACION: { label: "Pendiente",  color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  CONFIRMADA:             { label: "Confirmada", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  EN_CURSO:               { label: "En curso",   color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  FINALIZADA:             { label: "Finalizada", color: "bg-gray-500/15 text-gray-400 border-gray-500/30" },
  NO_SHOW:                { label: "No show",    color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  ANULADA:                { label: "Anulada",    color: "bg-red-500/15 text-red-400 border-red-500/30" },
};

function StatusBadgeOp({ label, color }: { label: string; color: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${color}`}>
      {label}
    </span>
  );
}

function PartnerOperationsPanel({ partnerId }: { partnerId: number }) {
  const [tab, setTab] = useState<"leads" | "reservas">("leads");

  const { data: leads = [], isLoading: leadsLoading } = trpc.partners.adminListLeads.useQuery({ partnerId });
  const { data: reservas = [], isLoading: resLoading } = trpc.partners.adminListReservations.useQuery({ partnerId });

  const totalLeads = leads.length;
  const totalReservas = reservas.length;
  const totalFact = reservas.reduce((acc, r) => acc + (r.amountTotal ?? 0), 0);

  return (
    <div className="space-y-3">
      {/* KPIs rápidos */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-blue-400">{totalLeads}</div>
          <div className="text-[10px] text-blue-400/70 uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1">
            <TrendingUp className="w-3 h-3" /> Leads enviados
          </div>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-emerald-400">{totalReservas}</div>
          <div className="text-[10px] text-emerald-400/70 uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1">
            <CalendarDays className="w-3 h-3" /> Reservas
          </div>
        </div>
        <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-violet-400">{(totalFact / 100).toFixed(2)} €</div>
          <div className="text-[10px] text-violet-400/70 uppercase tracking-wider mt-0.5 flex items-center justify-center gap-1">
            <Euro className="w-3 h-3" /> Facturado total
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-foreground/[0.08]">
        <button
          onClick={() => setTab("leads")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
            tab === "leads"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-foreground/40 hover:text-foreground/70"
          }`}
        >
          <ClipboardList className="w-3.5 h-3.5 inline mr-1.5" />
          Leads ({totalLeads})
        </button>
        <button
          onClick={() => setTab("reservas")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
            tab === "reservas"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-foreground/40 hover:text-foreground/70"
          }`}
        >
          <CalendarDays className="w-3.5 h-3.5 inline mr-1.5" />
          Reservas ({totalReservas})
        </button>
      </div>

      {/* Tabla de leads */}
      {tab === "leads" && (
        leadsLoading ? (
          <div className="text-center py-6"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-foreground/30" /></div>
        ) : leads.length === 0 ? (
          <div className="text-center py-8 text-foreground/30 text-sm">Sin leads todavía</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-foreground/[0.08]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-foreground/[0.08] bg-foreground/[0.03]">
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Fecha</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Cliente</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Contacto</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Categoría</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(l => {
                  const st = LEAD_STATUS_LABELS[l.status] ?? { label: l.status, color: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
                  return (
                    <tr key={l.id} className="border-b border-foreground/[0.06] hover:bg-foreground/[0.03] transition-colors">
                      <td className="px-3 py-2 text-foreground/50">
                        {l.createdAt ? new Date(l.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">{l.name}</td>
                      <td className="px-3 py-2 text-foreground/50">
                        <div>{l.email}</div>
                        {l.phone && <div className="text-foreground/30">{l.phone}</div>}
                      </td>
                      <td className="px-3 py-2 text-foreground/50">{l.selectedCategory ?? "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadgeOp {...st} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Tabla de reservas */}
      {tab === "reservas" && (
        resLoading ? (
          <div className="text-center py-6"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-foreground/30" /></div>
        ) : reservas.length === 0 ? (
          <div className="text-center py-8 text-foreground/30 text-sm">Sin reservas todavía</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-foreground/[0.08]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-foreground/[0.08] bg-foreground/[0.03]">
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Ref.</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Fecha reserva</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Cliente</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Producto</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Importe</th>
                  <th className="text-left px-3 py-2 text-foreground/40 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {reservas.map(r => {
                  const st = RES_STATUS_LABELS[r.statusReservation ?? ""] ?? { label: r.status, color: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
                  return (
                    <tr key={r.id} className="border-b border-foreground/[0.06] hover:bg-foreground/[0.03] transition-colors">
                      <td className="px-3 py-2 text-foreground/40 font-mono">{r.reservationNumber ?? `#${r.id}`}</td>
                      <td className="px-3 py-2 text-foreground/50">{r.bookingDate ?? "—"}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{r.customerName}</td>
                      <td className="px-3 py-2 text-foreground/60 max-w-[140px] truncate">{r.productName}</td>
                      <td className="px-3 py-2 font-semibold text-violet-400">{((r.amountTotal ?? 0) / 100).toFixed(2)} €</td>
                      <td className="px-3 py-2">
                        <StatusBadgeOp {...st} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ─── Panel de notas/avisos al partner ────────────────────────────────────────

type Announcement = { id: string; text: string; isNew: boolean; createdAt: string; expiresAt?: string | null };

const DURATION_OPTIONS = [
  { value: "0",    label: "Perpetua (sin caducidad)" },
  { value: "1",    label: "1 día" },
  { value: "3",    label: "3 días" },
  { value: "7",    label: "7 días" },
  { value: "15",   label: "15 días" },
  { value: "30",   label: "30 días" },
];

function PartnerAnnouncementsPanel({ partnerId }: { partnerId: number }) {
  const utils = trpc.useUtils();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newText, setNewText] = useState("");
  const [newDuration, setNewDuration] = useState("0");

  const { data: partnerData } = trpc.partners.get.useQuery({ id: partnerId });

  // Cargar anuncios del partner cuando llegan datos
  if (partnerData && !loaded) {
    const ann = (partnerData as any).announcements;
    setAnnouncements(Array.isArray(ann) ? ann : []);
    setLoaded(true);
  }

  const saveMut = trpc.partners.adminSaveAnnouncements.useMutation({
    onSuccess: () => {
      utils.partners.get.invalidate();
      toast.success("Notas guardadas");
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  function addNote() {
    if (!newText.trim()) return;
    const expiresAt = newDuration === "0"
      ? null
      : new Date(Date.now() + parseInt(newDuration) * 24 * 60 * 60 * 1000).toISOString();
    const note: Announcement = { id: crypto.randomUUID(), text: newText.trim(), isNew: true, createdAt: new Date().toISOString(), expiresAt };
    const updated = [...announcements, note];
    setAnnouncements(updated);
    saveMut.mutate({ partnerId, announcements: updated });
    setNewText("");
    setNewDuration("0");
  }

  function removeNote(id: string) {
    const updated = announcements.filter(a => a.id !== id);
    setAnnouncements(updated);
    saveMut.mutate({ partnerId, announcements: updated });
  }

  function toggleNew(id: string) {
    const updated = announcements.map(a => a.id === id ? { ...a, isNew: !a.isNew } : a);
    setAnnouncements(updated);
    saveMut.mutate({ partnerId, announcements: updated });
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-amber-400" />
        Notas / Avisos al partner
        <span className="text-xs font-normal text-foreground/30 normal-case">(aparecen en modal al acceder al portal)</span>
      </h3>

      {/* Nota nueva */}
      <div className="flex flex-col gap-2">
        <Input
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addNote()}
          placeholder="Ej: Las actividades acuáticas están suspendidas hoy por mal tiempo"
          className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm"
        />
        <div className="flex gap-2">
          <select
            value={newDuration}
            onChange={e => setNewDuration(e.target.value)}
            className="flex-1 bg-foreground/[0.05] border border-foreground/[0.12] text-white/70 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          >
            {DURATION_OPTIONS.map(o => (
              <option key={o.value} value={o.value} className="bg-[#0f1e35] text-white">{o.label}</option>
            ))}
          </select>
          <Button size="sm" onClick={addNote} disabled={!newText.trim() || saveMut.isPending}
            className="bg-amber-500 hover:bg-amber-600 text-white shrink-0">
            <Plus className="w-3.5 h-3.5 mr-1" /> Añadir
          </Button>
        </div>
      </div>

      {/* Lista de notas */}
      {announcements.length === 0 ? (
        <p className="text-xs text-foreground/30 italic">Sin notas activas para este partner</p>
      ) : (
        <div className="space-y-2">
          {announcements.map(a => (
            <div key={a.id} className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/80">{a.text}</p>
                <p className="text-[10px] text-foreground/30 mt-1">
                  {new Date(a.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {a.expiresAt
                    ? <span className="ml-2 text-orange-400/60">· caduca {new Date(a.expiresAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</span>
                    : <span className="ml-2 text-foreground/20">· perpetua</span>
                  }
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => toggleNew(a.id)}
                  title={a.isNew ? "Marcar como leída" : "Marcar como nueva"}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
                    a.isNew
                      ? "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                      : "bg-foreground/[0.08] text-foreground/30 border-foreground/20 hover:bg-foreground/[0.15]"
                  }`}
                >
                  {a.isNew ? "🔴 Nueva" : "Leída"}
                </button>
                <button onClick={() => removeNote(a.id)}
                  className="text-foreground/20 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PartnersManager() {
  const utils = trpc.useUtils();
  const { data: partners, isLoading } = trpc.partners.list.useQuery();

  const createMut = trpc.partners.create.useMutation({
    onSuccess: () => { utils.partners.list.invalidate(); setShowCreate(false); toast.success("Partner creado correctamente"); },
    onError: (e) => toast.error("Error al crear partner: " + e.message),
  });
  const updateMut = trpc.partners.update.useMutation({
    onSuccess: () => { utils.partners.list.invalidate(); utils.partners.get.invalidate(); setEditingId(null); toast.success("Partner actualizado"); },
    onError: (e) => toast.error("Error al actualizar: " + e.message),
  });
  const toggleMut = trpc.partners.toggleActive.useMutation({
    onSuccess: () => utils.partners.list.invalidate(),
  });

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = (partners ?? []).filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.contactEmail ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const selectedPartner = (partners ?? []).find(p => p.id === selectedId);

  const buildFormInitial = (p: Partner): Partial<PartnerFormData> => ({
    name: p.name,
    fiscalName: p.fiscalName ?? "",
    nif: p.nif ?? "",
    address: p.address ?? "",
    city: p.city ?? "",
    postalCode: p.postalCode ?? "",
    country: p.country,
    contactName: p.contactName ?? "",
    contactEmail: p.contactEmail ?? "",
    contactPhone: p.contactPhone ?? "",
    billingEmail: p.billingEmail ?? "",
    canCreateReservations: p.canCreateReservations,
    canCreateLeads: p.canCreateLeads,
    allowedReservationProductIds: (p.allowedReservationProductIds as number[] | null) ?? [],
    commissionType: p.commissionType,
    commissionValue: p.commissionValue ?? "",
    billingEnabled: p.billingEnabled,
    billingPeriod: p.billingPeriod,
    monthlyQuota: p.monthlyQuota?.toString() ?? "",
    notes: p.notes ?? "",
  });

  const handleCreate = (data: PartnerFormData) => {
    createMut.mutate({
      name: data.name,
      fiscalName: data.fiscalName || undefined,
      nif: data.nif || undefined,
      address: data.address || undefined,
      city: data.city || undefined,
      postalCode: data.postalCode || undefined,
      country: data.country,
      contactName: data.contactName || undefined,
      contactEmail: data.contactEmail || undefined,
      contactPhone: data.contactPhone || undefined,
      billingEmail: data.billingEmail || undefined,
      canCreateReservations: data.canCreateReservations,
      canCreateLeads: data.canCreateLeads,
      allowedReservationProductIds: data.allowedReservationProductIds.length > 0 ? data.allowedReservationProductIds : undefined,
      commissionType: data.commissionType as any,
      commissionValue: data.commissionValue || undefined,
      billingEnabled: data.billingEnabled,
      billingPeriod: data.billingPeriod as any,
      monthlyQuota: data.monthlyQuota ? parseInt(data.monthlyQuota) : undefined,
      notes: data.notes || undefined,
    });
  };

  const handleUpdate = (data: PartnerFormData) => {
    if (!editingId) return;
    updateMut.mutate({
      id: editingId,
      name: data.name,
      fiscalName: data.fiscalName || null,
      nif: data.nif || null,
      address: data.address || null,
      city: data.city || null,
      postalCode: data.postalCode || null,
      country: data.country,
      contactName: data.contactName || null,
      contactEmail: data.contactEmail || null,
      contactPhone: data.contactPhone || null,
      billingEmail: data.billingEmail || null,
      canCreateReservations: data.canCreateReservations,
      canCreateLeads: data.canCreateLeads,
      allowedReservationProductIds: data.allowedReservationProductIds.length > 0 ? data.allowedReservationProductIds : null,
      commissionType: data.commissionType as any,
      commissionValue: data.commissionValue || null,
      billingEnabled: data.billingEnabled,
      billingPeriod: data.billingPeriod as any,
      monthlyQuota: data.monthlyQuota ? parseInt(data.monthlyQuota) : null,
      notes: data.notes || null,
    });
  };

  return (
    <AdminLayout title="Partners / Colaboradores">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">Partners / Colaboradores</h1>
              <p className="text-xs text-foreground/50 mt-0.5">Gestión de hoteles, agencias y colaboradores externos</p>
            </div>
            <Button onClick={() => setShowCreate(true)}
              className="bg-orange-600 hover:bg-orange-700 text-white">
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo partner
            </Button>
          </div>
        </div>

        <div className="flex h-[calc(100vh-9rem)]">
          {/* Lista izquierda */}
          <div className="w-80 border-r border-foreground/[0.08] flex flex-col">
            <div className="p-3 border-b border-foreground/[0.08]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar partner..." className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="w-5 h-5 animate-spin text-foreground/30" />
                </div>
              ) : !filtered.length ? (
                <div className="text-center py-12 text-foreground/30 text-sm">
                  {search ? "Sin resultados" : "No hay partners todavía"}
                </div>
              ) : (
                filtered.map(p => (
                  <button key={p.id}
                    onClick={() => { setSelectedId(p.id); setEditingId(null); }}
                    className={`w-full text-left px-4 py-3 border-b border-foreground/[0.06] hover:bg-foreground/[0.04] transition-colors ${selectedId === p.id ? "bg-orange-500/10 border-l-2 border-l-orange-500" : ""}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${p.isActive ? "bg-emerald-400" : "bg-foreground/20"}`} />
                      <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                    </div>
                    {p.contactEmail && (
                      <div className="text-xs text-foreground/40 mt-0.5 ml-4 truncate">{p.contactEmail}</div>
                    )}
                    <div className="flex gap-1 mt-1.5 ml-4">
                      {p.canCreateReservations && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Reservas</span>
                      )}
                      {p.canCreateLeads && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">Leads</span>
                      )}
                      {p.billingEnabled && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20">Facturación</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Panel derecho */}
          <div className="flex-1 overflow-y-auto">
            {/* Crear nuevo partner */}
            {showCreate && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-foreground">Nuevo partner</h2>
                  <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <PartnerForm
                  onSave={handleCreate}
                  onCancel={() => setShowCreate(false)}
                  saving={createMut.isPending}
                />
              </div>
            )}

            {/* Detalle del partner seleccionado */}
            {!showCreate && selectedPartner && (
              <div className="p-6 space-y-6">
                {/* Cabecera */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-foreground">{selectedPartner.name}</h2>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        selectedPartner.isActive
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : "bg-foreground/[0.08] text-foreground/40 border-foreground/20"
                      }`}>
                        {selectedPartner.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    {selectedPartner.nif && <p className="text-xs text-foreground/40 mt-0.5">NIF: {selectedPartner.nif}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline"
                      className="border-foreground/20 text-foreground/60 hover:text-foreground text-xs"
                      onClick={() => toggleMut.mutate({ id: selectedPartner.id, active: !selectedPartner.isActive })}
                      disabled={toggleMut.isPending}>
                      {selectedPartner.isActive ? <ToggleRight className="w-3.5 h-3.5 mr-1 text-emerald-400" /> : <ToggleLeft className="w-3.5 h-3.5 mr-1" />}
                      {selectedPartner.isActive ? "Desactivar" : "Activar"}
                    </Button>
                    <Button size="sm" variant="outline"
                      className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 text-xs"
                      onClick={() => setEditingId(selectedPartner.id)}>
                      <Edit2 className="w-3.5 h-3.5 mr-1" /> Editar
                    </Button>
                  </div>
                </div>

                {/* Editar inline */}
                {editingId === selectedPartner.id && (
                  <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4">Editar partner</h3>
                    <PartnerForm
                      initial={buildFormInitial(selectedPartner as Partner)}
                      onSave={handleUpdate}
                      onCancel={() => setEditingId(null)}
                      saving={updateMut.isPending}
                    />
                  </div>
                )}

                {/* Info */}
                {editingId !== selectedPartner.id && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Contacto */}
                    <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4">
                      <h3 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-3">Contacto</h3>
                      <div className="space-y-2">
                        {selectedPartner.contactName && (
                          <div className="text-sm text-foreground">{selectedPartner.contactName}</div>
                        )}
                        {selectedPartner.contactEmail && (
                          <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                            <Mail className="w-3 h-3" /> {selectedPartner.contactEmail}
                          </div>
                        )}
                        {selectedPartner.contactPhone && (
                          <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                            <Phone className="w-3 h-3" /> {selectedPartner.contactPhone}
                          </div>
                        )}
                        {selectedPartner.billingEmail && selectedPartner.billingEmail !== selectedPartner.contactEmail && (
                          <div className="flex items-center gap-1.5 text-xs text-violet-400/80">
                            <CreditCard className="w-3 h-3" /> {selectedPartner.billingEmail}
                            <span className="text-foreground/30">(facturación)</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Capacidades */}
                    <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4">
                      <h3 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-3">Capacidades</h3>
                      <div className="space-y-2">
                        <div className={`flex items-center gap-2 text-sm ${selectedPartner.canCreateLeads ? "text-emerald-400" : "text-foreground/30"}`}>
                          {selectedPartner.canCreateLeads ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                          Crear oportunidades (leads)
                        </div>
                        <div className={`flex items-center gap-2 text-sm ${selectedPartner.canCreateReservations ? "text-emerald-400" : "text-foreground/30"}`}>
                          {selectedPartner.canCreateReservations ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                          Reservas directas confirmadas
                        </div>
                        <div className={`flex items-center gap-2 text-sm ${selectedPartner.billingEnabled ? "text-violet-400" : "text-foreground/30"}`}>
                          {selectedPartner.billingEnabled ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                          Facturación agrupada
                          {selectedPartner.billingEnabled && (
                            <span className="text-xs text-foreground/40">({BILLING_PERIOD_LABELS[selectedPartner.billingPeriod]})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-foreground/50">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Comisión: {COMMISSION_LABELS[selectedPartner.commissionType]}
                          {selectedPartner.commissionValue && ` (${selectedPartner.commissionValue})`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Usuarios del partner */}
                <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4">
                  <PartnerUsersPanel partnerId={selectedPartner.id} partnerName={selectedPartner.name} />
                </div>

                {/* Operaciones (leads + reservas) */}
                <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider mb-4">
                    Operaciones generadas
                  </h3>
                  <PartnerOperationsPanel partnerId={selectedPartner.id} />
                </div>

                {/* Notas internas (admin) */}
                {selectedPartner.notes && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                    <p className="text-xs text-amber-400/70 font-semibold uppercase tracking-wider mb-1">Notas internas</p>
                    <p className="text-sm text-foreground/70">{selectedPartner.notes}</p>
                  </div>
                )}

                {/* Notas visibles al partner */}
                <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4">
                  <PartnerAnnouncementsPanel partnerId={selectedPartner.id} />
                </div>
              </div>
            )}

            {/* Estado vacío */}
            {!showCreate && !selectedPartner && (
              <div className="flex flex-col items-center justify-center h-full text-foreground/30">
                <Building2 className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">Selecciona un partner para ver su detalle</p>
                <p className="text-xs mt-1">o crea uno nuevo con el botón superior</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
