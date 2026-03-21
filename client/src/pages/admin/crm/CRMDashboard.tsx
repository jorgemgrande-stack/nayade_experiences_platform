import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Users,
  FileText,
  CalendarCheck,
  TrendingUp,
  Search,
  Plus,
  Eye,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Star,
  Phone,
  Mail,
  MessageSquare,
  ChevronRight,
  AlertTriangle,
  Download,
  RefreshCw,
  Trash2,
  Copy,
  Filter,
  ArrowUpRight,
  Banknote,
} from "lucide-react";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Tab = "leads" | "quotes" | "reservations";

type OpportunityStatus = "nueva" | "enviada" | "ganada" | "perdida";
type Priority = "baja" | "media" | "alta";
type QuoteStatus = "borrador" | "enviado" | "aceptado" | "rechazado" | "expirado" | "perdido";

// ─── BADGE HELPERS ────────────────────────────────────────────────────────────

function OpportunityBadge({ status }: { status: OpportunityStatus }) {
  const map: Record<OpportunityStatus, { label: string; className: string }> = {
    nueva: { label: "Nueva", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    enviada: { label: "Enviada", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    ganada: { label: "Ganada", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    perdida: { label: "Perdida", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const { label, className } = map[status] ?? map.nueva;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>{label}</span>;
}

function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const map: Record<QuoteStatus, { label: string; className: string }> = {
    borrador: { label: "Borrador", className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
    enviado: { label: "Enviado", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    aceptado: { label: "Aceptado", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    rechazado: { label: "Rechazado", className: "bg-red-500/15 text-red-400 border-red-500/30" },
    expirado: { label: "Expirado", className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    perdido: { label: "Perdido", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const { label, className } = map[status] ?? map.borrador;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>{label}</span>;
}

function PriorityDot({ priority }: { priority: Priority }) {
  const map: Record<Priority, string> = {
    baja: "bg-slate-400",
    media: "bg-amber-400",
    alta: "bg-red-400",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[priority] ?? "bg-slate-400"}`} title={priority} />;
}

// ─── COUNTER CARD ─────────────────────────────────────────────────────────────

function CounterCard({
  label,
  value,
  icon: Icon,
  active,
  onClick,
  color = "blue",
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  active?: boolean;
  onClick?: () => void;
  color?: "blue" | "amber" | "green" | "red" | "slate";
}) {
  const colorMap = {
    blue: "from-blue-600/20 to-blue-800/10 border-blue-500/20 text-blue-400",
    amber: "from-amber-600/20 to-amber-800/10 border-amber-500/20 text-amber-400",
    green: "from-emerald-600/20 to-emerald-800/10 border-emerald-500/20 text-emerald-400",
    red: "from-red-600/20 to-red-800/10 border-red-500/20 text-red-400",
    slate: "from-slate-600/20 to-slate-800/10 border-slate-500/20 text-slate-400",
  };
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col gap-2 p-4 rounded-xl border bg-gradient-to-br transition-all duration-200 text-left w-full
        ${colorMap[color]}
        ${active ? "ring-2 ring-offset-1 ring-offset-[#0d1526] ring-current scale-[1.02]" : "hover:scale-[1.01] hover:brightness-110"}
      `}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white/50 uppercase tracking-wider">{label}</span>
        <Icon className="w-4 h-4 opacity-60" />
      </div>
      <span className="text-2xl font-bold text-white">{value}</span>
    </button>
  );
}

// ─── LEAD DETAIL MODAL ────────────────────────────────────────────────────────

function LeadDetailModal({
  leadId,
  onClose,
  onConvert,
}: {
  leadId: number;
  onClose: () => void;
  onConvert: (leadId: number) => void;
}) {
  const [note, setNote] = useState("");
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.crm.leads.get.useQuery({ id: leadId });

  const addNote = trpc.crm.leads.addNote.useMutation({
    onSuccess: () => {
      toast.success("Nota añadida");
      setNote("");
      utils.crm.leads.get.invalidate({ id: leadId });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateStatus = trpc.crm.leads.update.useMutation({
    onSuccess: () => {
      toast.success("Estado actualizado");
      utils.crm.leads.get.invalidate({ id: leadId });
      utils.crm.leads.counters.invalidate();
    },
  });

  const markLost = trpc.crm.leads.markLost.useMutation({
    onSuccess: () => {
      toast.success("Lead marcado como perdido");
      utils.crm.leads.get.invalidate({ id: leadId });
      utils.crm.leads.counters.invalidate();
      onClose();
    },
  });

  if (isLoading) {
    return (
      <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  if (!data) return null;
  const { lead, activity, quotes: relatedQuotes } = data;

  return (
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-white">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center font-bold text-sm">
            {lead.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-bold">{lead.name}</div>
            <div className="text-sm text-white/50 font-normal">{lead.email}</div>
          </div>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* Status & Priority */}
        <div className="flex items-center gap-3 flex-wrap">
          <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} />
          <PriorityDot priority={lead.priority as Priority} />
          <span className="text-xs text-white/40 capitalize">{lead.priority} prioridad</span>
          <span className="text-xs text-white/30">·</span>
          <span className="text-xs text-white/40">{new Date(lead.createdAt).toLocaleDateString("es-ES")}</span>
        </div>

        {/* Contact info */}
        <div className="grid grid-cols-2 gap-3">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-sm text-white/70 hover:text-orange-400 transition-colors">
              <Phone className="w-3.5 h-3.5" /> {lead.phone}
            </a>
          )}
          <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-sm text-white/70 hover:text-orange-400 transition-colors">
            <Mail className="w-3.5 h-3.5" /> {lead.email}
          </a>
        </div>

        {/* Request details */}
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          {lead.selectedCategory && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Categoría</span>
              <span className="text-white font-medium">{lead.selectedCategory}</span>
            </div>
          )}
          {lead.selectedProduct && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Producto</span>
              <span className="text-white font-medium">{lead.selectedProduct}</span>
            </div>
          )}
          {lead.preferredDate && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Fecha preferida</span>
              <span className="text-white font-medium">{new Date(lead.preferredDate).toLocaleDateString("es-ES")}</span>
            </div>
          )}
          {(lead.numberOfAdults || lead.numberOfPersons) && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Personas</span>
              <span className="text-white font-medium">
                {lead.numberOfAdults ? `${lead.numberOfAdults} adultos` : ""}{lead.numberOfChildren ? ` + ${lead.numberOfChildren} niños` : ""}
                {!lead.numberOfAdults && lead.numberOfPersons ? `${lead.numberOfPersons} personas` : ""}
              </span>
            </div>
          )}
          {lead.message && (
            <div className="pt-2 border-t border-white/10">
              <p className="text-sm text-white/60 italic">"{lead.message}"</p>
            </div>
          )}
        </div>

        {/* Related quotes */}
        {relatedQuotes.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Presupuestos asociados</h4>
            <div className="space-y-2">
              {relatedQuotes.map((q) => (
                <div key={q.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-white">{q.quoteNumber}</span>
                    <span className="text-xs text-white/40 ml-2">{q.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <QuoteStatusBadge status={q.status as QuoteStatus} />
                    <span className="text-sm font-bold text-orange-400">{Number(q.total).toFixed(2)} €</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Notas internas</h4>
          {Array.isArray(lead.internalNotes) && lead.internalNotes.length > 0 ? (
            <div className="space-y-2 mb-3">
              {(lead.internalNotes as { text: string; authorName: string; createdAt: string }[]).map((n, i) => (
                <div key={i} className="bg-white/5 rounded-lg px-3 py-2">
                  <p className="text-sm text-white/80">{n.text}</p>
                  <p className="text-xs text-white/30 mt-1">{n.authorName} · {new Date(n.createdAt).toLocaleString("es-ES")}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/30 mb-3">Sin notas aún</p>
          )}
          <div className="flex gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Añadir nota interna..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm resize-none h-16"
            />
            <Button
              size="sm"
              onClick={() => addNote.mutate({ id: leadId, text: note })}
              disabled={!note.trim() || addNote.isPending}
              className="bg-orange-600 hover:bg-orange-700 text-white self-end"
            >
              <MessageSquare className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Change status */}
        <div>
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Cambiar estado</h4>
          <div className="flex gap-2 flex-wrap">
            {(["nueva", "enviada", "ganada", "perdida"] as OpportunityStatus[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                className={`border-white/15 text-white/70 hover:text-white text-xs capitalize ${lead.opportunityStatus === s ? "bg-white/10 text-white" : ""}`}
                onClick={() => updateStatus.mutate({ id: leadId, opportunityStatus: s })}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <DialogFooter className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          onClick={() => markLost.mutate({ id: leadId })}
        >
          <XCircle className="w-4 h-4 mr-1" /> Marcar perdido
        </Button>
        <Button
          size="sm"
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white"
          onClick={() => { onClose(); onConvert(leadId); }}
        >
          <FileText className="w-4 h-4 mr-1" /> Crear Presupuesto
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── QUOTE BUILDER MODAL ─────────────────────────────────────────────────────

function QuoteBuilderModal({
  leadId,
  onClose,
}: {
  leadId: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [conditions, setConditions] = useState("Presupuesto válido por 15 días. Sujeto a disponibilidad.");
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().split("T")[0];
  });
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState(21);
  const [items, setItems] = useState([
    { description: "", quantity: 1, unitPrice: 0, total: 0 },
  ]);

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        if (field === "quantity" || field === "unitPrice") {
          updated.total = Number(updated.quantity) * Number(updated.unitPrice);
        }
        return updated;
      })
    );
  };

  const convertToQuote = trpc.crm.leads.convertToQuote.useMutation({
    onSuccess: (data) => {
      toast.success(`Presupuesto ${data.quoteNumber} creado`);
      utils.crm.leads.counters.invalidate();
      utils.crm.quotes.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!title || items.some((i) => !i.description)) {
      toast.error("Completa el título y todos los conceptos");
      return;
    }
    convertToQuote.mutate({
      leadId,
      title,
      description,
      items,
      subtotal,
      discount: 0,
      taxRate,
      total,
      validUntil,
      notes,
      conditions,
    });
  };

  return (
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-orange-400" /> Nuevo Presupuesto
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Título del presupuesto *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Pack Aventura Acuática para 10 personas"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1"
            />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Válido hasta</Label>
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="bg-white/5 border-white/10 text-white mt-1"
            />
          </div>
          <div>
            <Label className="text-white/60 text-xs">IVA (%)</Label>
            <Select value={String(taxRate)} onValueChange={(v) => setTaxRate(Number(v))}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-white/10">
                <SelectItem value="0" className="text-white">0% (exento)</SelectItem>
                <SelectItem value="10" className="text-white">10%</SelectItem>
                <SelectItem value="21" className="text-white">21%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-white/60 text-xs">Conceptos *</Label>
            <Button
              size="sm"
              variant="ghost"
              className="text-orange-400 hover:text-orange-300 text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0 }])}
            >
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-5 bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                  placeholder="Descripción"
                  value={item.description}
                  onChange={(e) => updateItem(idx, "description", e.target.value)}
                />
                <Input
                  className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-center"
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                />
                <Input
                  className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-right"
                  type="number"
                  min={0}
                  step={0.01}
                  value={item.unitPrice}
                  onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                />
                <div className="col-span-2 text-right text-sm font-semibold text-orange-400">
                  {item.total.toFixed(2)} €
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="col-span-1 text-white/30 hover:text-red-400 p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="text-xs text-white/30 grid grid-cols-12 gap-2 mt-1 px-0">
            <span className="col-span-5" />
            <span className="col-span-2 text-center">Cant.</span>
            <span className="col-span-2 text-right">P.Unit.</span>
            <span className="col-span-2 text-right">Total</span>
          </div>
        </div>

        {/* Totals */}
        <div className="bg-white/5 rounded-xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm text-white/60">
            <span>Subtotal</span><span>{subtotal.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between text-sm text-white/60">
            <span>IVA ({taxRate}%)</span><span>{taxAmount.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between text-base font-bold text-white border-t border-white/10 pt-2 mt-2">
            <span>TOTAL</span><span className="text-orange-400 text-xl">{total.toFixed(2)} €</span>
          </div>
        </div>

        <div>
          <Label className="text-white/60 text-xs">Notas para el cliente</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Información adicional visible para el cliente..."
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1 resize-none h-16 text-sm"
          />
        </div>
        <div>
          <Label className="text-white/60 text-xs">Condiciones</Label>
          <Textarea
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            className="bg-white/5 border-white/10 text-white mt-1 resize-none h-12 text-sm"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={convertToQuote.isPending}
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white"
        >
          {convertToQuote.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FileText className="w-4 h-4 mr-1" />}
          Crear Presupuesto
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── QUOTE DETAIL MODAL ───────────────────────────────────────────────────────

function QuoteDetailModal({
  quoteId,
  onClose,
}: {
  quoteId: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.crm.quotes.get.useQuery({ id: quoteId });
  const [paymentLink, setPaymentLink] = useState("");
  const [showPaymentInput, setShowPaymentInput] = useState(false);

  const sendQuote = trpc.crm.quotes.send.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto enviado al cliente");
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendQuote = trpc.crm.quotes.resend.useMutation({
    onSuccess: () => toast.success("Presupuesto reenviado"),
    onError: (e) => toast.error(e.message),
  });

  const confirmPayment = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: (data) => {
      toast.success(`Pago confirmado · Factura ${data.invoiceNumber} generada`);
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const markLost = trpc.crm.quotes.markLost.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto marcado como perdido");
      utils.crm.quotes.counters.invalidate();
      onClose();
    },
  });

  const duplicate = trpc.crm.quotes.duplicate.useMutation({
    onSuccess: (d) => {
      toast.success(`Copia creada: ${d.quoteNumber}`);
      utils.crm.quotes.counters.invalidate();
      onClose();
    },
  });

  if (isLoading) {
    return (
      <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  if (!data) return null;
  const { quote, lead, invoices: relatedInvoices } = data;
  const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];

  return (
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500/20 to-orange-700/20 border border-orange-500/30 flex items-center justify-center">
            <FileText className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <div className="font-bold">{quote.quoteNumber}</div>
            <div className="text-sm text-white/50 font-normal">{lead?.name ?? "Cliente"}</div>
          </div>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <QuoteStatusBadge status={quote.status as QuoteStatus} />
          {quote.sentAt && <span className="text-xs text-white/40">Enviado {new Date(quote.sentAt).toLocaleDateString("es-ES")}</span>}
          {quote.viewedAt && <span className="text-xs text-emerald-400">Visto ✓</span>}
        </div>

        <div className="bg-white/5 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h3 className="font-semibold text-white text-sm">{quote.title}</h3>
            {quote.description && <p className="text-xs text-white/50 mt-0.5">{quote.description}</p>}
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-white/5">
                <th className="text-left px-4 py-2 text-xs text-white/40 font-medium">Concepto</th>
                <th className="text-center px-4 py-2 text-xs text-white/40 font-medium">Cant.</th>
                <th className="text-right px-4 py-2 text-xs text-white/40 font-medium">P.Unit.</th>
                <th className="text-right px-4 py-2 text-xs text-white/40 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-sm text-white/80">{item.description}</td>
                  <td className="px-4 py-2.5 text-sm text-white/60 text-center">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-sm text-white/60 text-right">{Number(item.unitPrice).toFixed(2)} €</td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-orange-400 text-right">{Number(item.total).toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-white/10 space-y-1">
            {Number(quote.discount) > 0 && (
              <div className="flex justify-between text-sm text-white/50">
                <span>Descuento</span><span>-{Number(quote.discount).toFixed(2)} €</span>
              </div>
            )}
            {Number(quote.tax) > 0 && (
              <div className="flex justify-between text-sm text-white/50">
                <span>IVA</span><span>{Number(quote.tax).toFixed(2)} €</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1">
              <span className="font-bold text-white">TOTAL</span>
              <span className="text-xl font-bold text-orange-400">{Number(quote.total).toFixed(2)} €</span>
            </div>
          </div>
        </div>

        {/* Invoices */}
        {relatedInvoices.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Facturas generadas</h4>
            {relatedInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-emerald-400">{inv.invoiceNumber}</span>
                  <span className="text-xs text-white/40 ml-2">{new Date(inv.issuedAt).toLocaleDateString("es-ES")}</span>
                </div>
                {inv.pdfUrl && (
                  <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 h-7 text-xs">
                      <Download className="w-3.5 h-3.5 mr-1" /> Descargar
                    </Button>
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Payment link input */}
        {showPaymentInput && (
          <div>
            <Label className="text-white/60 text-xs">Link de pago (opcional)</Label>
            <Input
              value={paymentLink}
              onChange={(e) => setPaymentLink(e.target.value)}
              placeholder="https://..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1 text-sm"
            />
          </div>
        )}
      </div>

      <DialogFooter className="flex gap-2 flex-wrap">
        {quote.status === "borrador" && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="border-white/15 text-white/60 text-xs"
              onClick={() => setShowPaymentInput(!showPaymentInput)}
            >
              <ArrowUpRight className="w-3.5 h-3.5 mr-1" /> {showPaymentInput ? "Sin link" : "Añadir link pago"}
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => sendQuote.mutate({ id: quoteId, paymentLinkUrl: paymentLink || undefined })}
              disabled={sendQuote.isPending}
            >
              <Send className="w-4 h-4 mr-1" /> Enviar al cliente
            </Button>
          </>
        )}
        {quote.status === "enviado" && (
          <>
            <Button size="sm" variant="outline" className="border-white/15 text-white/60 text-xs" onClick={() => resendQuote.mutate({ id: quoteId })}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reenviar
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => confirmPayment.mutate({ quoteId })}
              disabled={confirmPayment.isPending}
            >
              {confirmPayment.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              Confirmar Pago
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" className="text-white/40 hover:text-white text-xs" onClick={() => duplicate.mutate({ id: quoteId })}>
          <Copy className="w-3.5 h-3.5 mr-1" /> Duplicar
        </Button>
        {quote.status !== "aceptado" && (
          <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 text-xs" onClick={() => markLost.mutate({ id: quoteId })}>
            <XCircle className="w-3.5 h-3.5 mr-1" /> Perdido
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

// ─── MAIN CRM DASHBOARD ───────────────────────────────────────────────────────

export default function CRMDashboard() {
  const [tab, setTab] = useState<Tab>("leads");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [convertLeadId, setConvertLeadId] = useState<number | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<number | null>(null);

  const { data: leadCounters } = trpc.crm.leads.counters.useQuery();
  const { data: quoteCounters } = trpc.crm.quotes.counters.useQuery();
  const { data: resCounters } = trpc.crm.reservations.counters.useQuery();

  const leadsFilter = useMemo(() => ({
    opportunityStatus: filterStatus !== "all" && tab === "leads" ? (filterStatus as OpportunityStatus) : undefined,
    search: search || undefined,
    limit: 50,
    offset: 0,
  }), [filterStatus, search, tab]);

  const quotesFilter = useMemo(() => ({
    status: filterStatus !== "all" && tab === "quotes" ? (filterStatus as QuoteStatus) : undefined,
    search: search || undefined,
    limit: 50,
    offset: 0,
  }), [filterStatus, search, tab]);

  const resFilter = useMemo(() => ({
    status: filterStatus !== "all" && tab === "reservations" ? filterStatus : undefined,
    search: search || undefined,
    limit: 50,
    offset: 0,
  }), [filterStatus, search, tab]);

  const { data: leadsData, isLoading: leadsLoading } = trpc.crm.leads.list.useQuery(leadsFilter);
  const { data: quotesData, isLoading: quotesLoading } = trpc.crm.quotes.list.useQuery(quotesFilter);
  const { data: resData, isLoading: resLoading } = trpc.crm.reservations.list.useQuery(resFilter);

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setFilterStatus("all");
    setSearch("");
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[#080e1c] text-white">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-2xl font-bold text-white">CRM Comercial</h1>
              <p className="text-sm text-white/40 mt-0.5">Pipeline completo Lead → Presupuesto → Reserva → Factura</p>
            </div>
          </div>
        </div>

        {/* Top KPI strip */}
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <CounterCard label="Leads nuevos" value={leadCounters?.nueva ?? 0} icon={Users} color="blue" active={tab === "leads" && filterStatus === "nueva"} onClick={() => { handleTabChange("leads"); setFilterStatus("nueva"); }} />
          <CounterCard label="Leads enviados" value={leadCounters?.enviada ?? 0} icon={Send} color="amber" active={tab === "leads" && filterStatus === "enviada"} onClick={() => { handleTabChange("leads"); setFilterStatus("enviada"); }} />
          <CounterCard label="Ganados" value={leadCounters?.ganada ?? 0} icon={Star} color="green" active={tab === "leads" && filterStatus === "ganada"} onClick={() => { handleTabChange("leads"); setFilterStatus("ganada"); }} />
          <CounterCard label="Perdidos" value={leadCounters?.perdida ?? 0} icon={XCircle} color="red" active={tab === "leads" && filterStatus === "perdida"} onClick={() => { handleTabChange("leads"); setFilterStatus("perdida"); }} />
          <CounterCard label="Presup. borrador" value={quoteCounters?.borrador ?? 0} icon={FileText} color="slate" active={tab === "quotes" && filterStatus === "borrador"} onClick={() => { handleTabChange("quotes"); setFilterStatus("borrador"); }} />
          <CounterCard label="Presup. enviados" value={quoteCounters?.enviado ?? 0} icon={Clock} color="amber" active={tab === "quotes" && filterStatus === "enviado"} onClick={() => { handleTabChange("quotes"); setFilterStatus("enviado"); }} />
          <CounterCard label="Reservas hoy" value={resCounters?.hoy ?? 0} icon={CalendarCheck} color="green" active={tab === "reservations"} onClick={() => handleTabChange("reservations")} />
          <CounterCard label="Ingresos total" value={`${Number(resCounters?.ingresos ?? 0).toFixed(0)} €`} icon={Banknote} color="green" onClick={() => handleTabChange("reservations")} />
        </div>

        {/* Tabs */}
        <div className="px-6">
          <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
            {([
              { key: "leads", label: "Leads", icon: Users, count: leadCounters?.total },
              { key: "quotes", label: "Presupuestos", icon: FileText, count: quoteCounters?.enviado },
              { key: "reservations", label: "Reservas", icon: CalendarCheck, count: resCounters?.confirmadas },
            ] as const).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  ${tab === key ? "bg-orange-600 text-white shadow-lg shadow-orange-900/30" : "text-white/50 hover:text-white hover:bg-white/5"}`}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === key ? "bg-white/20 text-white" : "bg-white/10 text-white/60"}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Search & filter */}
        <div className="px-6 py-4 flex gap-3 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${tab === "leads" ? "leads" : tab === "quotes" ? "presupuestos" : "reservas"}...`}
              className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
            />
          </div>
          {filterStatus !== "all" && (
            <Button size="sm" variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 text-xs" onClick={() => setFilterStatus("all")}>
              <Filter className="w-3.5 h-3.5 mr-1" /> Limpiar filtro
            </Button>
          )}
        </div>

        {/* Table */}
        <div className="px-6 pb-8">
          {tab === "leads" && (
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8 bg-white/5">
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Producto</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden lg:table-cell">Fecha pref.</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden sm:table-cell">Recibido</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsLoading ? (
                    <tr><td colSpan={6} className="text-center py-12 text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !leadsData?.length ? (
                    <tr><td colSpan={6} className="text-center py-12 text-white/30 text-sm">No hay leads {filterStatus !== "all" ? `con estado "${filterStatus}"` : ""}</td></tr>
                  ) : leadsData.map((lead) => (
                    <tr key={lead.id} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <PriorityDot priority={lead.priority as Priority} />
                          <div>
                            <div className="text-sm font-medium text-white">{lead.name}</div>
                            <div className="text-xs text-white/40">{lead.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-white/60">{lead.selectedProduct || lead.selectedCategory || "—"}</div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-sm text-white/50">{lead.preferredDate ? new Date(lead.preferredDate).toLocaleDateString("es-ES") : "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-white/40">{new Date(lead.createdAt).toLocaleDateString("es-ES")}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-white/50 hover:text-white h-7 px-2 text-xs"
                            onClick={() => setSelectedLeadId(lead.id)}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" /> Ver
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-orange-400 hover:text-orange-300 h-7 px-2 text-xs"
                            onClick={() => setConvertLeadId(lead.id)}
                          >
                            <FileText className="w-3.5 h-3.5 mr-1" /> Presupuesto
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "quotes" && (
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8 bg-white/5">
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Referencia</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Título</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Total</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden sm:table-cell">Creado</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {quotesLoading ? (
                    <tr><td colSpan={6} className="text-center py-12 text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !quotesData?.length ? (
                    <tr><td colSpan={6} className="text-center py-12 text-white/30 text-sm">No hay presupuestos {filterStatus !== "all" ? `con estado "${filterStatus}"` : ""}</td></tr>
                  ) : quotesData.map((quote) => (
                    <tr key={quote.id} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-sm font-mono font-medium text-orange-400">{quote.quoteNumber}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-white/70 truncate max-w-[200px]">{quote.title}</div>
                      </td>
                      <td className="px-4 py-3">
                        <QuoteStatusBadge status={quote.status as QuoteStatus} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-white">{Number(quote.total).toFixed(2)} €</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-white/40">{new Date(quote.createdAt).toLocaleDateString("es-ES")}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-white/50 hover:text-white h-7 px-2 text-xs"
                          onClick={() => setSelectedQuoteId(quote.id)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "reservations" && (
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8 bg-white/5">
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Producto</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Importe</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden sm:table-cell">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {resLoading ? (
                    <tr><td colSpan={5} className="text-center py-12 text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !resData?.length ? (
                    <tr><td colSpan={5} className="text-center py-12 text-white/30 text-sm">No hay reservas</td></tr>
                  ) : resData.map((res) => (
                    <tr key={res.id} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-white">{res.customerName}</div>
                        <div className="text-xs text-white/40">{res.customerEmail}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-white/60 truncate max-w-[200px]">{res.productName}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                          res.status === "paid" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                          res.status === "pending_payment" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                          "bg-slate-500/15 text-slate-400 border-slate-500/30"
                        }`}>
                          {res.status === "paid" ? "Pagado" : res.status === "pending_payment" ? "Pendiente" : res.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-white">{((res.amountPaid ?? 0) / 100).toFixed(2)} €</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-white/40">{new Date(res.createdAt).toLocaleDateString("es-ES")}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <Dialog open={selectedLeadId !== null} onOpenChange={(o) => !o && setSelectedLeadId(null)}>
        {selectedLeadId !== null && (
          <LeadDetailModal
            leadId={selectedLeadId}
            onClose={() => setSelectedLeadId(null)}
            onConvert={(id) => setConvertLeadId(id)}
          />
        )}
      </Dialog>

      <Dialog open={convertLeadId !== null} onOpenChange={(o) => !o && setConvertLeadId(null)}>
        {convertLeadId !== null && (
          <QuoteBuilderModal
            leadId={convertLeadId}
            onClose={() => setConvertLeadId(null)}
          />
        )}
      </Dialog>

      <Dialog open={selectedQuoteId !== null} onOpenChange={(o) => !o && setSelectedQuoteId(null)}>
        {selectedQuoteId !== null && (
          <QuoteDetailModal
            quoteId={selectedQuoteId}
            onClose={() => setSelectedQuoteId(null)}
          />
        )}
      </Dialog>
    </DashboardLayout>
  );
}
