/**
 * Redes sociales del pie: red + dirección https de esa red. El valor se guarda como JSON en `site_footer_social`
 * junto al resto de «Cabecera y pie» (lo valida el servidor con las mismas reglas: https, dominio de la red).
 */
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkSocialUrl, parseFooterSocial, SOCIAL_LABELS, SOCIAL_MAX, SOCIAL_NETWORKS, type SocialNetwork } from "@shared/footer";

type Row = { network: SocialNetwork; url: string };

/** Lo guardado (texto JSON) en filas editables, sin descartar lo que aún se está escribiendo. */
export function rowsFromValue(value: string): Row[] {
  try {
    const raw = JSON.parse(value || "[]");
    if (Array.isArray(raw)) return raw.filter((r) => SOCIAL_NETWORKS.includes(r?.network)).map((r) => ({ network: r.network as SocialNetwork, url: String(r.url ?? "") }));
  } catch {
    /* vacío */
  }
  return parseFooterSocial(value);
}

export function FooterSocialEditor({ value, onChange }: { value: string; onChange: (json: string) => void }) {
  const rows = rowsFromValue(value);
  const commit = (next: Row[]) => onChange(JSON.stringify(next));
  const used = new Set(rows.map((r) => r.network));
  const free = SOCIAL_NETWORKS.filter((n) => !used.has(n));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Redes sociales del pie</span>
        <span className="text-xs text-muted-foreground">{rows.length} de {SOCIAL_MAX}</span>
      </div>
      {rows.length === 0 && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Sin redes sociales. Añade una y pega la dirección de tu perfil.</p>}
      {rows.map((r, i) => {
        const check = r.url.trim() ? checkSocialUrl(r.network, r.url) : null;
        const id = `social-${r.network}`;
        return (
          <div key={r.network} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-sm">{SOCIAL_LABELS[r.network]}</span>
              <Input
                id={id}
                aria-label={`Dirección de ${SOCIAL_LABELS[r.network]}`}
                aria-invalid={check ? !check.ok : undefined}
                aria-describedby={check && !check.ok ? `${id}-err` : undefined}
                inputMode="url"
                autoComplete="off"
                className="h-8"
                maxLength={300}
                placeholder="https://"
                value={r.url}
                onChange={(e) => commit(rows.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))}
              />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => commit(rows.filter((_, k) => k !== i))} aria-label={`Quitar ${SOCIAL_LABELS[r.network]}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {check && !check.ok && <p id={`${id}-err`} className="pl-[6.5rem] text-xs text-destructive">{check.error}</p>}
          </div>
        );
      })}
      {free.length > 0 && rows.length < SOCIAL_MAX && (
        <div className="flex flex-wrap gap-2 pt-1">
          {free.map((n) => (
            <Button key={n} type="button" variant="outline" size="sm" onClick={() => commit([...rows, { network: n, url: "" }])}>
              <Plus className="mr-1.5 h-4 w-4" /> {SOCIAL_LABELS[n]}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Cada enlace se abre en una pestaña nueva y debe ser https y de esa red. No se carga ningún script de las redes.</p>
    </div>
  );
}
