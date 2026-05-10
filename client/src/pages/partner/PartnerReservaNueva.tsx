import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import PartnerLayout from "./PartnerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle, Loader2, Users, Calendar, Euro, Search } from "lucide-react";

export default function PartnerReservaNueva() {
  const [, navigate] = useLocation();
  const [submitted, setSubmitted] = useState(false);
  const [submittedData, setSubmittedData] = useState<{ reservationNumber: string } | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedProductName, setSelectedProductName] = useState("");
  const [selectedBasePrice, setSelectedBasePrice] = useState(0);
  const [selectedPricingType, setSelectedPricingType] = useState<"per_person" | "per_unit">("per_person");

  const [form, setForm] = useState({
    customerName: "", customerEmail: "", customerPhone: "",
    bookingDate: "", people: "1",
    amountTotal: "0", notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  const { data: partner } = trpc.partners.getMyPartner.useQuery();
  const { data: allProducts, isError: productsError } = trpc.partners.getAvailableProducts.useQuery();

  const experiences = useMemo(() => {
    if (!allProducts) return [];
    if (!search) return allProducts;
    return allProducts.filter((e: any) => e.title.toLowerCase().includes(search.toLowerCase()));
  }, [allProducts, search]);

  const people = parseInt(form.people) || 1;

  function selectProduct(exp: any) {
    setSelectedProductId(exp.id);
    setSelectedProductName(exp.title);
    const base = parseFloat(exp.basePrice ?? "0");
    const type = exp.pricingType ?? "per_person";
    setSelectedBasePrice(base);
    setSelectedPricingType(type);
    const auto = type === "per_person" ? base * people : base;
    setForm(p => ({ ...p, amountTotal: auto.toFixed(2) }));
    setErrors(p => ({ ...p, product: "" }));
  }

  function recalcAmount(newPeople: number) {
    if (!selectedProductId) return;
    const auto = selectedPricingType === "per_person" ? selectedBasePrice * newPeople : selectedBasePrice;
    setForm(p => ({ ...p, amountTotal: auto.toFixed(2) }));
  }

  const createReservation = trpc.partners.createReservation.useMutation({
    onSuccess: (data) => {
      setSubmittedData({ reservationNumber: data.reservationNumber ?? "" });
      setSubmitted(true);
    },
    onError: (e) => toast.error("Error al crear la reserva: " + e.message),
  });

  function validate() {
    const e: Record<string, string> = {};
    if (!form.customerName.trim() || form.customerName.length < 2) e.customerName = "Introduce el nombre del huésped";
    if (!form.customerEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail)) e.customerEmail = "Email no válido";
    if (!selectedProductId) e.product = "Selecciona una experiencia";
    if (!form.bookingDate) e.bookingDate = "Selecciona la fecha de la actividad";
    if (!form.amountTotal || parseFloat(form.amountTotal) < 0) e.amountTotal = "Introduce el importe";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    createReservation.mutate({
      customerName: form.customerName.trim(),
      customerEmail: form.customerEmail.trim(),
      customerPhone: form.customerPhone.trim() || undefined,
      productId: selectedProductId!,
      productName: selectedProductName,
      bookingDate: form.bookingDate,
      people: parseInt(form.people) || 1,
      amountTotal: parseFloat(form.amountTotal) || 0,
      notes: form.notes.trim() || undefined,
    });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setForm(p => ({ ...p, [k]: val }));
    if (k === "people") recalcAmount(parseInt(val) || 1);
  };

  if (!partner?.canCreateReservations) {
    return (
      <PartnerLayout bgImage="/images/partner/bg-dashboard_3.png">
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <p className="text-gray-500">Tu cuenta no tiene permiso para crear reservas directas.</p>
          <p className="text-gray-400 text-sm mt-1">Contacta con el administrador de Nayade Experiences.</p>
        </div>
      </PartnerLayout>
    );
  }

  if (submitted && submittedData) {
    return (
      <PartnerLayout bgImage="/images/partner/bg-dashboard_3.png">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <CheckCircle className="w-14 h-14 text-green-500 mb-5" />
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">¡Reserva creada!</h2>
          <p className="text-gray-500 mb-1">
            Nº <span className="font-mono font-semibold text-gray-700">{submittedData.reservationNumber}</span>
          </p>
          <p className="text-gray-400 text-sm mb-8">
            La reserva está confirmada y el equipo operativo ya la tiene disponible.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setSubmitted(false); setSelectedProductId(null); setForm({ customerName:"",customerEmail:"",customerPhone:"",bookingDate:"",people:"1",amountTotal:"0",notes:"" }); }}>
              Nueva reserva
            </Button>
            <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate("/partner/dashboard")}>
              Ver mis reservas
            </Button>
          </div>
        </div>
      </PartnerLayout>
    );
  }

  return (
    <PartnerLayout>
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Nueva reserva directa</h1>
          <p className="text-white/50 text-sm mt-1">Crea una reserva confirmada para un huésped. Quedará registrada bajo {partner?.name}.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Datos del huésped */}
          <div className="bg-white/[0.07] rounded-xl border border-white/[0.10] p-6 space-y-4">
            <h2 className="font-medium text-white/50 text-[11px] uppercase tracking-wider">Datos del huésped</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm text-white/60">Nombre <span className="text-red-400">*</span></Label>
                <Input value={form.customerName} onChange={set("customerName")} placeholder="Nombre completo" className="mt-1 bg-white/[0.06] border-white/[0.12] text-white placeholder:text-white/25" />
                {errors.customerName && <p className="text-red-400 text-xs mt-1">{errors.customerName}</p>}
              </div>
              <div>
                <Label className="text-sm text-white/60">Email <span className="text-red-400">*</span></Label>
                <Input value={form.customerEmail} onChange={set("customerEmail")} type="email" placeholder="huesped@email.com" className="mt-1 bg-white/[0.06] border-white/[0.12] text-white placeholder:text-white/25" />
                {errors.customerEmail && <p className="text-red-400 text-xs mt-1">{errors.customerEmail}</p>}
              </div>
              <div>
                <Label className="text-sm text-white/60">Teléfono</Label>
                <Input value={form.customerPhone} onChange={set("customerPhone")} placeholder="+34 600 000 000" className="mt-1 bg-white/[0.06] border-white/[0.12] text-white placeholder:text-white/25" />
              </div>
            </div>
          </div>

          {/* Selección de actividad */}
          <div className="bg-white/[0.07] rounded-xl border border-white/[0.10] p-6 space-y-4">
            <h2 className="font-medium text-white/50 text-[11px] uppercase tracking-wider">Actividad <span className="text-red-400">*</span></h2>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar actividad…" className="pl-9 bg-white/[0.06] border-white/[0.12] text-white placeholder:text-white/25" />
            </div>
            {productsError ? (
              <div className="text-red-400 text-sm">Error al cargar actividades. Recarga la página.</div>
            ) : !allProducts ? (
              <div className="flex items-center gap-2 text-white/30 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Cargando actividades…</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {experiences.map((exp: any) => {
                  const selected = selectedProductId === exp.id;
                  const price = parseFloat(exp.basePrice ?? "0");
                  const type = exp.pricingType ?? "per_person";
                  return (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => selectProduct(exp)}
                      className={`text-left px-4 py-3 rounded-lg border transition-all ${
                        selected
                          ? "border-orange-400/70 bg-orange-500/15 ring-1 ring-orange-400/30"
                          : "border-white/[0.12] hover:border-orange-400/40 hover:bg-orange-500/10"
                      }`}
                    >
                      <p className={`text-sm font-medium ${selected ? "text-orange-300" : "text-white/75"}`}>{exp.title}</p>
                      {price > 0 && (
                        <p className="text-xs text-white/35 mt-0.5">
                          {price.toFixed(2)}€ {type === "per_person" ? "/persona" : "/unidad"}
                        </p>
                      )}
                    </button>
                  );
                })}
                {experiences.length === 0 && (
                  <p className="text-white/30 text-sm col-span-2 py-2">No hay actividades disponibles.</p>
                )}
              </div>
            )}
            {errors.product && <p className="text-red-400 text-xs">{errors.product}</p>}
          </div>

          {/* Detalles del servicio */}
          <div className="bg-white/[0.07] rounded-xl border border-white/[0.10] p-6 space-y-4">
            <h2 className="font-medium text-white/50 text-[11px] uppercase tracking-wider">Detalles del servicio</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <Label className="text-sm text-white/60 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Fecha <span className="text-red-400">*</span>
                </Label>
                <Input value={form.bookingDate} onChange={set("bookingDate")} type="date" className="mt-1 bg-white/[0.06] border-white/[0.12] text-white" />
                {errors.bookingDate && <p className="text-red-400 text-xs mt-1">{errors.bookingDate}</p>}
              </div>
              <div>
                <Label className="text-sm text-white/60 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Personas
                </Label>
                <Input value={form.people} onChange={set("people")} type="number" min="1" max="200" className="mt-1 bg-white/[0.06] border-white/[0.12] text-white" />
              </div>
              <div>
                <Label className="text-sm text-white/60 flex items-center gap-1.5">
                  <Euro className="w-3.5 h-3.5" /> Importe total (€) <span className="text-red-400">*</span>
                </Label>
                <Input value={form.amountTotal} onChange={set("amountTotal")} type="number" step="0.01" min="0" className="mt-1 bg-white/[0.06] border-white/[0.12] text-white" />
                {selectedProductId && selectedBasePrice > 0 && (
                  <p className="text-xs text-white/35 mt-1">
                    Precio base: {selectedBasePrice.toFixed(2)}€{selectedPricingType === "per_person" ? " × " + people + " = " + (selectedBasePrice * people).toFixed(2) + "€" : ""}
                  </p>
                )}
                {errors.amountTotal && <p className="text-red-400 text-xs mt-1">{errors.amountTotal}</p>}
              </div>
            </div>
            <div>
              <Label className="text-sm text-white/60">Notas internas</Label>
              <Textarea value={form.notes} onChange={set("notes")} placeholder="Preferencias del huésped, condiciones especiales…" className="mt-1 resize-none bg-white/[0.06] border-white/[0.12] text-white placeholder:text-white/25" rows={2} />
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-5 py-3 text-xs text-blue-300/80">
            Esta reserva quedará confirmada automáticamente y facturada a <strong>{partner?.fiscalName ?? partner?.name}</strong> en el ciclo de facturación correspondiente.
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white px-8" disabled={createReservation.isPending}>
              {createReservation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Confirmar reserva
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/partner/dashboard")} className="text-white/40 hover:text-white/70">
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </PartnerLayout>
  );
}
