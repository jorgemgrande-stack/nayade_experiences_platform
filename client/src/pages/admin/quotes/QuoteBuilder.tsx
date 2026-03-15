import { useState } from "react";
import { Plus, Trash2, Send, FileText, Euro, User, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type QuoteItem = {
  description: string;
  quantity: number;
  unitPrice: string;
  discount: string;
};

export default function QuoteBuilder() {
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [validDays, setValidDays] = useState("15");
  const [leadId, setLeadId] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([
    { description: "", quantity: 1, unitPrice: "", discount: "0" },
  ]);
  const [createdQuote, setCreatedQuote] = useState<any>(null);

  const { data: leads } = trpc.leads.getAll.useQuery({ limit: 100, offset: 0 });
  const { data: experiences } = trpc.products.getAll.useQuery();

  const createMutation = trpc.quotes.create.useMutation({
    onSuccess: (data) => {
      setCreatedQuote(data);
      toast.success("Presupuesto creado y enviado por email");
    },
    onError: () => toast.error("Error al crear el presupuesto"),
  });

  const addItem = () => setItems([...items, { description: "", quantity: 1, unitPrice: "", discount: "0" }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof QuoteItem, value: string | number) => {
    setItems(items.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  };

  const subtotal = items.reduce((sum, item) => {
    const price = parseFloat(item.unitPrice) || 0;
    const qty = item.quantity || 1;
    const disc = parseFloat(item.discount) || 0;
    return sum + price * qty * (1 - disc / 100);
  }, 0);
  const iva = subtotal * 0.21;
  const total = subtotal + iva;

  const handleSelectLead = (id: string) => {
    setLeadId(id);
    const lead = (leads ?? []).find((l) => String(l.id) === id);
    if (lead) {
      setClientName(lead.name);
      setClientEmail(lead.email);
      setClientPhone(lead.phone ?? "");
    }
  };

  const handleSelectExperience = (expId: string, itemIndex: number) => {
    const exp = (experiences ?? []).find((e) => String(e.id) === expId);
    if (exp) {
      updateItem(itemIndex, "description", exp.title);
      updateItem(itemIndex, "unitPrice", exp.basePrice);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !clientEmail) { toast.error("Nombre y email del cliente son obligatorios"); return; }
    if (items.some((i) => !i.description || !i.unitPrice)) { toast.error("Completa todos los items"); return; }

    createMutation.mutate({
      leadId: leadId ? parseInt(leadId) : 0,
      title: `Presupuesto para ${clientName}`,
      notes: notes || undefined,
      validUntil: new Date(Date.now() + parseInt(validDays) * 24 * 60 * 60 * 1000).toISOString(),
      items: items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice) || 0,
        total: (parseFloat(item.unitPrice) || 0) * item.quantity * (1 - (parseFloat(item.discount) || 0) / 100),
      })),
      subtotal: String(subtotal),
      tax: String(iva),
      total: String(total),
    });
  };

  if (createdQuote) {
    return (
      <AdminLayout title="Presupuesto Creado">
        <div className="max-w-lg mx-auto text-center py-12">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
            <FileText className="w-10 h-10 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">¡Presupuesto Enviado!</h2>
          <p className="text-muted-foreground mb-6">
            El presupuesto <strong>{createdQuote.quoteNumber}</strong> ha sido enviado a <strong>{clientEmail}</strong> con el link de pago.
          </p>
          <div className="bg-muted/50 rounded-xl p-5 mb-6 text-left space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Número:</span>
              <span className="font-semibold text-foreground">{createdQuote.quoteNumber}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-semibold text-accent">{parseFloat(createdQuote.totalAmount).toFixed(2)}€</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Link de pago:</span>
              <a href={createdQuote.paymentLink} target="_blank" rel="noopener noreferrer" className="text-accent underline text-xs truncate max-w-[200px]">
                {createdQuote.paymentLink}
              </a>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setCreatedQuote(null); setClientName(""); setClientEmail(""); setItems([{ description: "", quantity: 1, unitPrice: "", discount: "0" }]); }}>
              Nuevo Presupuesto
            </Button>
            <Button asChild className="flex-1 bg-gold-gradient text-white hover:opacity-90">
              <a href="/admin/presupuestos/lista">Ver Todos</a>
            </Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Nuevo Presupuesto">
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Client + Items */}
          <div className="lg:col-span-2 space-y-6">
            {/* Client Info */}
            <div className="bg-card rounded-2xl border border-border/50 p-6">
              <h3 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2">
                <User className="w-4 h-4 text-accent" />
                Datos del Cliente
              </h3>
              <div className="mb-4">
                <Label>Importar desde Lead</Label>
                <Select value={leadId} onValueChange={handleSelectLead}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar lead existente..." /></SelectTrigger>
                  <SelectContent>
                    {(leads ?? []).map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name} — {l.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="clientName">Nombre *</Label>
                  <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} required className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="clientEmail">Email *</Label>
                  <Input id="clientEmail" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} required className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="clientPhone">Teléfono</Label>
                  <Input id="clientPhone" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="validDays">Válido por (días)</Label>
                  <Input id="validDays" type="number" value={validDays} onChange={(e) => setValidDays(e.target.value)} className="mt-1" />
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="bg-card rounded-2xl border border-border/50 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
                  <Package className="w-4 h-4 text-accent" />
                  Conceptos del Presupuesto
                </h3>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Añadir Línea
                </Button>
              </div>

              <div className="space-y-4">
                {items.map((item, i) => (
                  <div key={i} className="border border-border/50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">Línea {i + 1}</span>
                      {items.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(i)} className="w-7 h-7 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Importar Experiencia</Label>
                      <Select onValueChange={(v) => handleSelectExperience(v, i)}>
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Seleccionar experiencia..." /></SelectTrigger>
                        <SelectContent>
                          {(experiences ?? []).map((e) => (
                            <SelectItem key={e.id} value={String(e.id)}>{e.title} — {parseFloat(e.basePrice).toFixed(0)}€</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Descripción *</Label>
                      <Input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} required className="mt-1 h-8 text-sm" placeholder="Descripción del servicio" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">Cantidad</Label>
                        <Input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(i, "quantity", parseInt(e.target.value) || 1)} className="mt-1 h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">Precio Unit. (€) *</Label>
                        <Input type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(i, "unitPrice", e.target.value)} required className="mt-1 h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">Descuento (%)</Label>
                        <Input type="number" min="0" max="100" value={item.discount} onChange={(e) => updateItem(i, "discount", e.target.value)} className="mt-1 h-8 text-sm" />
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold text-accent">
                      Subtotal: {((parseFloat(item.unitPrice) || 0) * item.quantity * (1 - (parseFloat(item.discount) || 0) / 100)).toFixed(2)}€
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-card rounded-2xl border border-border/50 p-6">
              <Label htmlFor="notes">Notas y Condiciones</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-2" rows={3} placeholder="Condiciones especiales, notas para el cliente..." />
            </div>
          </div>

          {/* Right: Summary */}
          <div className="space-y-5">
            <div className="bg-card rounded-2xl border border-border/50 p-6 sticky top-24">
              <h3 className="font-display font-semibold text-foreground mb-5 flex items-center gap-2">
                <Euro className="w-4 h-4 text-accent" />
                Resumen del Presupuesto
              </h3>
              <div className="space-y-3 mb-5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium text-foreground">{subtotal.toFixed(2)}€</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IVA (21%)</span>
                  <span className="font-medium text-foreground">{iva.toFixed(2)}€</span>
                </div>
                <div className="border-t border-border pt-3 flex justify-between">
                  <span className="font-semibold text-foreground">Total</span>
                  <span className="font-bold text-xl text-accent">{total.toFixed(2)}€</span>
                </div>
              </div>
              <div className="bg-muted/50 rounded-xl p-4 mb-5 text-xs text-muted-foreground space-y-1.5">
                <p>✓ Se generará un link de pago único</p>
                <p>✓ El cliente recibirá el presupuesto por email</p>
                <p>✓ Integración automática con GoHighLevel CRM</p>
                <p>✓ Seguimiento automático de aceptación</p>
              </div>
              <Button type="submit" disabled={createMutation.isPending} className="w-full bg-gold-gradient text-white hover:opacity-90 h-11 font-semibold">
                {createMutation.isPending ? "Creando..." : "Crear y Enviar Presupuesto"}
                <Send className="ml-2 w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </AdminLayout>
  );
}
