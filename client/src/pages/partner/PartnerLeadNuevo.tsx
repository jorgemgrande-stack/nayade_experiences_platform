import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import PartnerLayout from "./PartnerLayout";
import ActivityModal, { ActivityEntry, ModalState, getFamilyForSlug } from "@/components/ActivityModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, X, CheckCircle, Users, Loader2 } from "lucide-react";

export default function PartnerLeadNuevo() {
  const [, navigate] = useLocation();
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    name: "", email: "", phone: "",
    preferredDate: "", adults: "1", children: "0", comments: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [selectedActivities, setSelectedActivities] = useState<ActivityEntry[]>([]);
  const [modalState, setModalState] = useState<ModalState>({
    open: false, experienceId: 0, experienceTitle: "", family: "", slug: "",
  });

  const totalPersons = (parseInt(form.adults) || 1) + (parseInt(form.children) || 0);

  const { data: experiences } = trpc.public.getExperiences.useQuery({ limit: 50 });

  const createLead = trpc.partners.createLead.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (e) => toast.error("Error al enviar el lead: " + e.message),
  });

  const openModal = useCallback((exp: { id: number; title: string; slug: string }) => {
    setModalState({ open: true, experienceId: exp.id, experienceTitle: exp.title, family: getFamilyForSlug(exp.slug), slug: exp.slug });
  }, []);

  const handleModalConfirm = useCallback((entry: ActivityEntry) => {
    setSelectedActivities(prev => {
      const idx = prev.findIndex(a => a.experienceId === entry.experienceId);
      if (idx >= 0) { const u = [...prev]; u[idx] = entry; return u; }
      return [...prev, entry];
    });
    setModalState(s => ({ ...s, open: false }));
    setErrors(p => ({ ...p, activities: "" }));
  }, []);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim() || form.name.trim().length < 2) e.name = "Introduce el nombre del cliente";
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email no válido";
    if (!form.preferredDate) e.preferredDate = "Selecciona una fecha aproximada";
    if (selectedActivities.length === 0) e.activities = "Selecciona al menos una experiencia";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    createLead.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      preferredDate: form.preferredDate || undefined,
      numberOfAdults: parseInt(form.adults) || 1,
      numberOfChildren: parseInt(form.children) || 0,
      comments: form.comments.trim() || undefined,
      selectedCategory: "Experiencias",
      selectedProduct: selectedActivities.map(a => a.experienceTitle).join(", "),
      activitiesJson: selectedActivities,
    });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  if (submitted) {
    return (
      <PartnerLayout bgImage="/images/partner/bg-dashboard_2.png">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <CheckCircle className="w-14 h-14 text-green-500 mb-5" />
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">¡Lead enviado!</h2>
          <p className="text-gray-500 mb-6">El equipo de Nayade Experiences se pondrá en contacto con el cliente.</p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setSubmitted(false); setForm({ name:"",email:"",phone:"",preferredDate:"",adults:"1",children:"0",comments:"" }); setSelectedActivities([]); }}>
              Enviar otro
            </Button>
            <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate("/partner/dashboard")}>
              Ver mis leads
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
          <h1 className="text-2xl font-semibold text-gray-800">Nuevo lead</h1>
          <p className="text-gray-500 text-sm mt-1">Captura una oportunidad comercial para un huésped o cliente</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Datos del cliente */}
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-medium text-gray-700 text-sm uppercase tracking-wide">Datos del cliente</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm text-gray-600">Nombre <span className="text-red-400">*</span></Label>
                <Input value={form.name} onChange={set("name")} placeholder="Nombre completo" className="mt-1" />
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
              </div>
              <div>
                <Label className="text-sm text-gray-600">Email <span className="text-red-400">*</span></Label>
                <Input value={form.email} onChange={set("email")} type="email" placeholder="cliente@email.com" className="mt-1" />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
              </div>
              <div>
                <Label className="text-sm text-gray-600">Teléfono</Label>
                <Input value={form.phone} onChange={set("phone")} placeholder="+34 600 000 000" className="mt-1" />
              </div>
            </div>
          </div>

          {/* Detalles de la visita */}
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-medium text-gray-700 text-sm uppercase tracking-wide">Detalles de la visita</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <Label className="text-sm text-gray-600">Fecha aproximada <span className="text-red-400">*</span></Label>
                <Input value={form.preferredDate} onChange={set("preferredDate")} type="date" className="mt-1" />
                {errors.preferredDate && <p className="text-red-500 text-xs mt-1">{errors.preferredDate}</p>}
              </div>
              <div>
                <Label className="text-sm text-gray-600">Adultos</Label>
                <Input value={form.adults} onChange={set("adults")} type="number" min="1" max="100" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm text-gray-600">Niños</Label>
                <Input value={form.children} onChange={set("children")} type="number" min="0" max="50" className="mt-1" />
              </div>
            </div>
          </div>

          {/* Selección de experiencias */}
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-medium text-gray-700 text-sm uppercase tracking-wide">Experiencias de interés <span className="text-red-400">*</span></h2>

            {/* Actividades ya añadidas */}
            {selectedActivities.length > 0 && (
              <div className="space-y-2">
                {selectedActivities.map(a => (
                  <div key={a.experienceId} className="flex items-center justify-between bg-orange-50 border border-orange-100 rounded-lg px-4 py-2.5">
                    <div>
                      <span className="text-sm font-medium text-orange-800">{a.experienceTitle}</span>
                      <span className="text-xs text-orange-500 ml-2">· {a.participants} persona{a.participants !== 1 ? "s" : ""}</span>
                    </div>
                    <button type="button" onClick={() => setSelectedActivities(p => p.filter(x => x.experienceId !== a.experienceId))}
                      className="text-orange-400 hover:text-orange-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Grid de experiencias */}
            {experiences && experiences.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {experiences.map((exp: any) => {
                  const added = selectedActivities.some(a => a.experienceId === exp.id);
                  return (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => openModal({ id: exp.id, title: exp.title, slug: exp.slug ?? "" })}
                      className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                        added
                          ? "border-orange-300 bg-orange-50 text-orange-700"
                          : "border-gray-200 hover:border-orange-200 hover:bg-orange-50/50 text-gray-600"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">{exp.title}</span>
                        {added
                          ? <CheckCircle className="w-3.5 h-3.5 text-orange-500 flex-shrink-0 ml-1" />
                          : <Plus className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 ml-1" />
                        }
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando experiencias…
              </div>
            )}
            {errors.activities && <p className="text-red-500 text-xs">{errors.activities}</p>}
          </div>

          {/* Notas */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <Label className="text-sm text-gray-600">Notas adicionales</Label>
            <Textarea
              value={form.comments}
              onChange={set("comments")}
              placeholder="Preferencias del cliente, restricciones, contexto…"
              className="mt-1 resize-none"
              rows={3}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white px-8" disabled={createLead.isPending}>
              {createLead.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Enviar lead
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/partner/dashboard")} className="text-gray-500">
              Cancelar
            </Button>
          </div>
        </form>
      </div>

      <ActivityModal
        modal={modalState}
        totalPersons={totalPersons}
        onClose={() => setModalState(s => ({ ...s, open: false }))}
        onConfirm={handleModalConfirm}
      />
    </PartnerLayout>
  );
}
