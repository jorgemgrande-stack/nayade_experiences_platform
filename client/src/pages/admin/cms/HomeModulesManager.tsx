import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { LayoutGrid, CheckCircle, Loader2, ArrowUp, ArrowDown, X, Plus } from "lucide-react";

// ─── Constantes de módulos disponibles ───────────────────────────────────────
const HOME_MODULES = [
  {
    key: "experiences_featured",
    label: "Nuestras Experiencias",
    description: "Productos que aparecen en la sección principal de experiencias de la home",
    icon: "🏄",
  },
  {
    key: "packs_day",
    label: "Packs de Día Completo",
    description: "Productos que aparecen en la sección de packs de la home",
    icon: "📦",
  },
];

// ─── Componente de selección para un módulo ───────────────────────────────────
function ModuleEditor({ moduleKey, label, description, icon }: { moduleKey: string; label: string; description: string; icon: string }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: allExperiences } = trpc.products.getAll.useQuery();
  const { data: moduleItems, refetch } = trpc.homeModules.getModule.useQuery({ moduleKey });

  const setModule = trpc.homeModules.setModule.useMutation({
    onSuccess: () => {
      refetch();
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: () => setSaving(false),
  });

  const selectedIds: number[] = moduleItems?.map((i) => i.experienceId) ?? [];

  const toggleExperience = (id: number) => {
    const newIds = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    setSaving(true);
    setSaved(false);
    setModule.mutate({ moduleKey, experienceIds: newIds });
  };

  const moveUp = (id: number) => {
    const idx = selectedIds.indexOf(id);
    if (idx <= 0) return;
    const newIds = [...selectedIds];
    [newIds[idx - 1], newIds[idx]] = [newIds[idx], newIds[idx - 1]];
    setSaving(true);
    setModule.mutate({ moduleKey, experienceIds: newIds });
  };

  const moveDown = (id: number) => {
    const idx = selectedIds.indexOf(id);
    if (idx < 0 || idx >= selectedIds.length - 1) return;
    const newIds = [...selectedIds];
    [newIds[idx], newIds[idx + 1]] = [newIds[idx + 1], newIds[idx]];
    setSaving(true);
    setModule.mutate({ moduleKey, experienceIds: newIds });
  };

  type Exp = NonNullable<typeof allExperiences>[number];
  const selectedExperiences = selectedIds
    .map((id) => allExperiences?.find((e: Exp) => e.id === id))
    .filter(Boolean) as Exp[];

  const availableExperiences = allExperiences?.filter((e: Exp) => !selectedIds.includes(e.id) && e.isActive) ?? [];

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-5">
      {/* Header del módulo */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-white m-0">{label}</h3>
          <p className="text-xs text-white/40 mt-0.5">{description}</p>
        </div>
        {saving && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
            <Loader2 className="w-3 h-3 animate-spin" /> Guardando...
          </span>
        )}
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
            <CheckCircle className="w-3 h-3" /> Guardado
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Columna izquierda: seleccionados */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="bg-orange-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">
              {selectedIds.length}
            </span>
            <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">
              Productos seleccionados
            </span>
          </div>
          {selectedExperiences.length === 0 ? (
            <div className="py-8 text-center text-white/30 text-xs border-2 border-dashed border-white/10 rounded-lg">
              Sin productos seleccionados.<br />Añade desde la lista de la derecha.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {selectedExperiences.map((exp, idx) => (
                <div key={exp.id} className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg p-2">
                  {exp.image1 ? (
                    <img src={exp.image1} alt={exp.title} className="w-10 h-10 object-cover rounded-md shrink-0" />
                  ) : (
                    <div className="w-10 h-10 bg-white/10 rounded-md shrink-0 flex items-center justify-center text-base">🖼️</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{exp.title}</div>
                    <div className="text-[10px] text-white/40">{exp.basePrice}€</div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => moveUp(exp.id)}
                      disabled={idx === 0}
                      className="w-6 h-6 rounded border border-white/20 flex items-center justify-center text-white/50 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => moveDown(exp.id)}
                      disabled={idx === selectedExperiences.length - 1}
                      className="w-6 h-6 rounded border border-white/20 flex items-center justify-center text-white/50 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    onClick={() => toggleExperience(exp.id)}
                    className="w-7 h-7 bg-red-500/20 border border-red-500/30 rounded-md flex items-center justify-center text-red-400 hover:bg-red-500/30 transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Columna derecha: disponibles */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">
              Productos disponibles
            </span>
          </div>
          {availableExperiences.length === 0 ? (
            <div className="py-8 text-center text-white/30 text-xs">
              Todos los productos están seleccionados
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
              {availableExperiences.map((exp) => (
                <div key={exp.id} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-2 hover:bg-white/8 transition-colors">
                  {exp.image1 ? (
                    <img src={exp.image1} alt={exp.title} className="w-10 h-10 object-cover rounded-md shrink-0" />
                  ) : (
                    <div className="w-10 h-10 bg-white/10 rounded-md shrink-0 flex items-center justify-center text-base">🖼️</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white/80 truncate">{exp.title}</div>
                    <div className="text-[10px] text-white/40">{exp.basePrice}€</div>
                  </div>
                  <button
                    onClick={() => toggleExperience(exp.id)}
                    className="flex items-center gap-1 bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-semibold rounded-md px-2.5 py-1.5 transition-colors shrink-0"
                  >
                    <Plus className="w-3 h-3" /> Añadir
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function HomeModulesManager() {
  return (
    <AdminLayout title="Módulos de la Home">
      <div className="px-6 py-6">
        {/* Page header */}
        <div className="flex items-center gap-3 mb-6 pb-5 border-b border-white/10">
          <div className="p-2.5 rounded-xl bg-orange-500/15 border border-orange-500/25">
            <LayoutGrid className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-none">Módulos de la Home</h1>
            <p className="text-xs text-white/40 mt-1">
              Selecciona qué productos aparecen en cada sección de la página principal. El orden de la lista determina el orden en la web.
            </p>
          </div>
        </div>

        {/* Módulos */}
        {HOME_MODULES.map((mod) => (
          <ModuleEditor
            key={mod.key}
            moduleKey={mod.key}
            label={mod.label}
            description={mod.description}
            icon={mod.icon}
          />
        ))}
      </div>
    </AdminLayout>
  );
}
