import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";

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
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 28 }}>{icon}</span>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>{label}</h3>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{description}</p>
        </div>
        {saving && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#f97316", fontWeight: 600 }}>Guardando...</span>
        )}
        {saved && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#22c55e", fontWeight: 600 }}>✓ Guardado</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 16 }}>
        {/* Columna izquierda: seleccionados */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ background: "#f97316", color: "#fff", borderRadius: 9999, padding: "1px 8px", fontSize: 11 }}>{selectedIds.length}</span>
            Productos seleccionados
          </div>
          {selectedExperiences.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#9ca3af", fontSize: 13, border: "2px dashed #e5e7eb", borderRadius: 8 }}>
              Sin productos seleccionados.<br />Añade desde la lista de la derecha.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {selectedExperiences.map((exp, idx) => (
                <div key={exp.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 10px" }}>
                  {exp.image1 ? (
                    <img src={exp.image1} alt={exp.title} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 44, height: 44, background: "#e5e7eb", borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🖼️</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.title}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{exp.basePrice}€</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <button onClick={() => moveUp(exp.id)} disabled={idx === 0} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 4, width: 22, height: 22, cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.4 : 1, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>▲</button>
                    <button onClick={() => moveDown(exp.id)} disabled={idx === selectedExperiences.length - 1} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 4, width: 22, height: 22, cursor: idx === selectedExperiences.length - 1 ? "not-allowed" : "pointer", opacity: idx === selectedExperiences.length - 1 ? 0.4 : 1, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>▼</button>
                  </div>
                  <button
                    onClick={() => toggleExperience(exp.id)}
                    style={{ background: "#fee2e2", border: "none", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Columna derecha: disponibles */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
            Productos disponibles
          </div>
          {availableExperiences.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              Todos los productos están seleccionados
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
              {availableExperiences.map((exp) => (
                <div key={exp.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
                  {exp.image1 ? (
                    <img src={exp.image1} alt={exp.title} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, background: "#e5e7eb", borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🖼️</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.title}</div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{exp.basePrice}€</div>
                  </div>
                  <button
                    onClick={() => toggleExperience(exp.id)}
                    style={{ background: "#f97316", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, color: "#fff", fontWeight: 600, flexShrink: 0 }}
                  >+ Añadir</button>
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
      <div style={{ padding: "0 0 40px 0" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>Módulos de la Home</h1>
          <p style={{ color: "#6b7280", marginTop: 4, fontSize: 14 }}>
            Selecciona qué productos aparecen en cada sección de la página principal. El orden de la lista determina el orden en la web.
          </p>
        </div>

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
