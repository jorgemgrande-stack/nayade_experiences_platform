import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, ShieldCheck } from "lucide-react";

interface ProviderField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  options?: string[];
  set: boolean;
  display: string | null;
}
interface Provider {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  fields: ProviderField[];
}

function ProviderCard({ p, onChanged }: { p: Provider; onChanged: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = trpc.integrations.save.useMutation();
  const clear = trpc.integrations.clear.useMutation();
  const test = trpc.integrations.test.useMutation();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const dirty = Object.values(vals).some((x) => x !== "");

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b border-border/50">
        <div className="flex items-center gap-2">
          {p.configured ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Circle className="w-4 h-4 text-muted-foreground/40" />}
          <div>
            <h3 className="text-sm font-semibold">{p.name}</h3>
            <p className="text-xs text-muted-foreground">{p.description}</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{p.configured ? "Configurada" : "Sin configurar"}</span>
      </div>

      <form
        className="p-5 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const values: Record<string, string> = {};
          for (const [k, x] of Object.entries(vals)) if (x !== "") values[k] = x;
          try {
            await save.mutateAsync({ provider: p.id, values });
            setVals({});
            setResult(null);
            toast.success(`${p.name}: guardado`);
            onChanged();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "No se pudo guardar");
          }
        }}
      >
        {p.fields.map((f) => (
          <label key={f.key} className="block space-y-1">
            <span className="text-sm font-medium flex items-center gap-2">
              {f.label}
              {f.secret && <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" aria-label="Cifrado" />}
            </span>
            {f.options ? (
              <select
                className="w-full h-10 rounded-lg border border-border/60 bg-background px-3 text-sm"
                value={vals[f.key] ?? f.display ?? ""}
                onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="w-full h-10 rounded-lg border border-border/60 bg-background px-3 text-sm"
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                placeholder={f.set ? (f.secret ? `${f.display} (déjalo en blanco para conservarlo)` : (f.display ?? "")) : ""}
                value={vals[f.key] ?? ""}
                onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              />
            )}
          </label>
        ))}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={!dirty || save.isPending}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {save.isPending ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            disabled={!p.configured || test.isPending}
            className="h-10 px-4 rounded-lg border border-border/60 text-sm disabled:opacity-50"
            onClick={async () => {
              try {
                setResult(await test.mutateAsync({ provider: p.id }));
              } catch (err) {
                setResult({ ok: false, message: err instanceof Error ? err.message : "Error" });
              }
            }}
          >
            {test.isPending ? "Probando…" : "Probar conexión"}
          </button>
          {p.configured && (
            <button
              type="button"
              className="h-10 px-4 rounded-lg text-sm text-red-500"
              onClick={async () => {
                if (!window.confirm(`¿Eliminar la configuración de ${p.name}?`)) return;
                await clear.mutateAsync({ provider: p.id });
                setResult(null);
                toast.success(`${p.name}: eliminado`);
                onChanged();
              }}
            >
              Eliminar
            </button>
          )}
        </div>
        {result && <p className={`text-sm ${result.ok ? "text-emerald-600" : "text-red-500"}`}>{result.message}</p>}
      </form>
    </div>
  );
}

export default function Integrations() {
  const avail = trpc.integrations.available.useQuery();
  const list = trpc.integrations.list.useQuery(undefined, { enabled: avail.data?.available === true });

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Integraciones</h1>
          <p className="text-sm text-muted-foreground">
            Credenciales de tus servicios externos. Se guardan cifradas y nunca se muestran de nuevo.
          </p>
        </div>

        {avail.isLoading || (avail.data?.available && list.isLoading) ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !avail.data?.available ? (
          <div className="bg-card border border-border/50 rounded-2xl p-5 text-sm text-muted-foreground">
            La configuración de integraciones por empresa está disponible en la plataforma multiempresa. En esta instalación
            las integraciones se gestionan en la configuración del servidor.
          </div>
        ) : (
          ((list.data ?? []) as Provider[]).map((p) => <ProviderCard key={p.id} p={p} onChanged={() => list.refetch()} />)
        )}
      </div>
    </AdminLayout>
  );
}
