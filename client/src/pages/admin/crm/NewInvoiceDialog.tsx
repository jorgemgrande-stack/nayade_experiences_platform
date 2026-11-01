/**
 * Diálogo «Nueva factura»: factura libre, sin venta, reserva, caja ni presupuesto previos.
 * Cliente existente o datos escritos a mano; líneas con concepto, cantidad, precio y tipo de IVA. Los precios se
 * escriben con IVA incluido (por defecto, como en productos y presupuestos) o sin IVA; con IVA al 0 % se pide
 * el motivo de la exención, que figura en la factura.
 * Los importes se calculan con la misma regla que usa el servidor al emitir (shared/directInvoice).
 */
import React, { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { computeDirectInvoice, convertUnitPrice, DIRECT_INVOICE_TAX_RATES, EXEMPTION_REASON_SUGGESTIONS, parseAmount, validateNewInvoice, type DirectInvoiceTaxRate, type InvoiceClientDraft as ClientDraft, type InvoiceFormErrors as Errors, type InvoiceLineDraft as LineDraft } from "@shared/directInvoice";
import { normalizeTaxId } from "@shared/formValidation";


const emptyLine = (): LineDraft => ({ description: "", quantity: "1", unitPrice: "", taxRate: 21, exemptionReason: "" });
const emptyClient = (): ClientDraft => ({ name: "", nif: "", email: "", phone: "", address: "" });
const money = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
export default function NewInvoiceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: () => void }) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [client, setClient] = useState<ClientDraft>(emptyClient);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  // Como el resto del producto: precios con IVA incluido salvo que se elija lo contrario
  const [pricesIncludeTax, setPricesIncludeTax] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const utils = trpc.useUtils();

  const clientsQuery = trpc.crm.clients.list.useQuery({ search: search.trim() || undefined, limit: 20, offset: 0 }, { enabled: open && mode === "existing" });
  const clientOptions = clientsQuery.data?.items ?? [];

  const amounts = useMemo(() => {
    const valid = lines
      .map((l) => ({ description: l.description, quantity: parseAmount(l.quantity), unitPrice: parseAmount(l.unitPrice), taxRate: l.taxRate, exemptionReason: l.exemptionReason }))
      .filter((l) => l.quantity > 0 && l.unitPrice >= 0);
    return computeDirectInvoice(valid, { pricesIncludeTax });
  }, [lines, pricesIncludeTax]);

  const reset = () => {
    setMode("existing");
    setSearch("");
    setClientId(null);
    setClient(emptyClient());
    setLines([emptyLine()]);
    setPricesIncludeTax(true);
    setErrors({});
  };

  // Al cambiar de modo, los precios escritos se convierten para que el total no cambie
  const switchPrices = (include: boolean) => {
    if (include === pricesIncludeTax) return;
    setLines((ls) => ls.map((l) => {
      const p = parseAmount(l.unitPrice);
      return Number.isFinite(p) ? { ...l, unitPrice: String(convertUnitPrice(p, l.taxRate, include)).replace(".", ",") } : l;
    }));
    setPricesIncludeTax(include);
  };

  const create = trpc.crm.invoices.createDirect.useMutation({
    onSuccess: (data) => {
      toast.success(`Factura ${data.invoiceNumber} emitida`);
      utils.crm.invoices.listAll.invalidate();
      reset();
      onOpenChange(false);
      onCreated?.();
    },
    onError: (e) => toastError(e),
  });

  const submit = () => {
    const e = validateNewInvoice(mode, clientId, client, lines);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (!(amounts.total > 0)) {
      setErrors({ lines: "El total de la factura debe ser mayor que cero" });
      return;
    }
    create.mutate({
      ...(mode === "existing"
        ? { clientId: clientId! }
        : { client: { name: client.name.trim(), nif: client.nif.trim() ? normalizeTaxId(client.nif) : undefined, email: client.email.trim() || undefined, phone: client.phone.trim() || undefined, address: client.address.trim() || undefined } }),
      pricesIncludeTax,
      lines: lines.map((l) => ({ description: l.description.trim(), quantity: parseAmount(l.quantity), unitPrice: parseAmount(l.unitPrice), taxRate: l.taxRate, ...(l.taxRate === 0 ? { exemptionReason: (l.exemptionReason ?? "").trim() } : {}) })),
    });
  };

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const err = (k: string) => (errors[k] ? <p className="text-xs text-red-400 mt-1">{errors[k]}</p> : null);
  const fieldClass = "bg-foreground/[0.05] border-foreground/[0.15] text-white";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-[#0d1526] border-foreground/[0.12] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Nueva factura</DialogTitle>
        </DialogHeader>

        <section className="space-y-3">
          <div className="flex gap-2">
            {(["existing", "new"] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setErrors({}); }}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${mode === m ? "bg-orange-600 text-white border-orange-600" : "bg-foreground/[0.05] text-foreground/60 border-foreground/[0.12]"}`}>
                {m === "existing" ? "Cliente guardado" : "Cliente nuevo"}
              </button>
            ))}
          </div>

          {mode === "existing" ? (
            <div>
              <Label htmlFor="ni-search" className="text-foreground/70">Buscar cliente</Label>
              <Input id="ni-search" className={fieldClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, empresa o correo" />
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-foreground/[0.12] divide-y divide-foreground/[0.08]">
                {clientsQuery.isLoading && <p className="p-2 text-xs text-foreground/50">Cargando clientes…</p>}
                {!clientsQuery.isLoading && clientOptions.length === 0 && <p className="p-2 text-xs text-foreground/50">No hay clientes con ese nombre. Puedes escribir sus datos en «Cliente nuevo».</p>}
                {clientOptions.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setClientId(c.id); setErrors((e) => ({ ...e, clientId: "" })); }}
                    className={`w-full text-left px-3 py-2 text-sm ${clientId === c.id ? "bg-orange-600/30" : "hover:bg-foreground/[0.06]"}`}>
                    <span className="font-medium">{c.company || c.name}</span>
                    <span className="text-foreground/50 text-xs ml-2">{[c.nif, c.email].filter(Boolean).join(" · ")}</span>
                  </button>
                ))}
              </div>
              {err("clientId")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Label htmlFor="ni-name" className="text-foreground/70">Nombre o razón social *</Label>
                <Input id="ni-name" className={fieldClass} value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} />
                {err("name")}
              </div>
              <div>
                <Label htmlFor="ni-nif" className="text-foreground/70">NIF</Label>
                <Input id="ni-nif" className={fieldClass} value={client.nif} onChange={(e) => setClient({ ...client, nif: e.target.value })} />
                {err("nif")}
              </div>
              <div>
                <Label htmlFor="ni-email" className="text-foreground/70">Correo electrónico</Label>
                <Input id="ni-email" type="email" className={fieldClass} value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} />
                {err("email")}
              </div>
              <div>
                <Label htmlFor="ni-phone" className="text-foreground/70">Teléfono</Label>
                <Input id="ni-phone" className={fieldClass} value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} />
                {err("phone")}
              </div>
              <div>
                <Label htmlFor="ni-address" className="text-foreground/70">Dirección</Label>
                <Input id="ni-address" className={fieldClass} value={client.address} onChange={(e) => setClient({ ...client, address: e.target.value })} />
              </div>
            </div>
          )}
        </section>

        <section className="space-y-2 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground/80">Conceptos</h3>
            <div className="flex gap-2" role="radiogroup" aria-label="Cómo escribes los precios">
              {([true, false] as const).map((inc) => (
                <button key={String(inc)} type="button" role="radio" aria-checked={pricesIncludeTax === inc} onClick={() => switchPrices(inc)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border ${pricesIncludeTax === inc ? "bg-orange-600 text-white border-orange-600" : "bg-foreground/[0.05] text-foreground/60 border-foreground/[0.12]"}`}>
                  {inc ? "Precios con IVA incluido" : "Precios sin IVA"}
                </button>
              ))}
            </div>
          </div>
          <datalist id="ni-exemption-reasons">
            {EXEMPTION_REASON_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
          </datalist>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-12 sm:col-span-5">
                <Label htmlFor={`ni-desc-${i}`} className="text-xs text-foreground/60">Concepto</Label>
                <Input id={`ni-desc-${i}`} className={fieldClass} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                {err(`line${i}.description`)}
              </div>
              <div className="col-span-3 sm:col-span-2">
                <Label htmlFor={`ni-qty-${i}`} className="text-xs text-foreground/60">Cantidad</Label>
                <Input id={`ni-qty-${i}`} inputMode="decimal" className={fieldClass} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                {err(`line${i}.quantity`)}
              </div>
              <div className="col-span-4 sm:col-span-2">
                <Label htmlFor={`ni-price-${i}`} className="text-xs text-foreground/60">{pricesIncludeTax ? "Precio con IVA" : "Precio sin IVA"}</Label>
                <Input id={`ni-price-${i}`} inputMode="decimal" className={fieldClass} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} placeholder="0,00" />
                {err(`line${i}.unitPrice`)}
              </div>
              <div className="col-span-3 sm:col-span-2">
                <Label htmlFor={`ni-tax-${i}`} className="text-xs text-foreground/60">IVA</Label>
                <select id={`ni-tax-${i}`} className="w-full h-9 rounded-md px-2 text-sm bg-[#0d1526] border border-foreground/[0.15] text-white"
                  value={l.taxRate} onChange={(e) => setLine(i, { taxRate: Number(e.target.value) as DirectInvoiceTaxRate })}>
                  {DIRECT_INVOICE_TAX_RATES.map((r) => <option key={r} value={r}>{r} %</option>)}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1 pt-5">
                <Button type="button" variant="ghost" size="sm" aria-label="Quitar línea" disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="text-foreground/60">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              {l.taxRate === 0 && (
                <div className="col-span-12">
                  <Label htmlFor={`ni-exempt-${i}`} className="text-xs text-foreground/60">Motivo de la exención (IVA 0 %) *</Label>
                  <Input id={`ni-exempt-${i}`} list="ni-exemption-reasons" className={fieldClass} value={l.exemptionReason ?? ""} onChange={(e) => setLine(i, { exemptionReason: e.target.value })} placeholder="Elige uno o escribe el motivo" />
                  {err(`line${i}.exemptionReason`)}
                </div>
              )}
            </div>
          ))}
          {err("lines")}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])} className="border-foreground/[0.15] text-foreground/70">
            <Plus className="w-4 h-4 mr-1" /> Añadir línea
          </Button>
        </section>

        <section className="mt-4 ml-auto w-full sm:w-72 text-sm space-y-1">
          {amounts.taxBreakdown.map((b) => (
            <div key={b.rate} className="flex justify-between text-foreground/70">
              <span>Base {b.rate} % · IVA {money(b.amount)}</span>
              <span>{money(b.base)}</span>
            </div>
          ))}
          <div className="flex justify-between text-foreground/70"><span>Base imponible</span><span>{money(amounts.subtotal)}</span></div>
          <div className="flex justify-between text-foreground/70"><span>IVA</span><span>{money(amounts.taxAmount)}</span></div>
          <div className="flex justify-between font-semibold text-white border-t border-foreground/[0.12] pt-1"><span>Total</span><span>{money(amounts.total)}</span></div>
        </section>

        <p className="text-xs text-foreground/50 mt-2">Al emitirla, la factura recibe el siguiente número de tu serie de facturas y ya no se puede borrar. Si hay un error, se corrige con un abono.</p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onOpenChange(false); }} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
          <Button size="sm" onClick={submit} disabled={create.isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
            {create.isPending && <RefreshCw className="w-4 h-4 animate-spin mr-1" />}
            Emitir factura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
