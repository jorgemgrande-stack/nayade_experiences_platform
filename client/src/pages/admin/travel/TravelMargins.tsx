import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Coins } from "lucide-react";
import { TravelNotInstalled, isTravelNotInstalled, pct } from "./travelShared";

const SCOPE_LABEL: Record<string, string> = { global: "Global", sede: "Sede", proveedor: "Proveedor" };
const toBp = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

export default function TravelMargins() {
  const utils = trpc.useUtils();
  const q = trpc.travel.listMarginRules.useQuery(undefined, { retry: (n, e) => !isTravelNotInstalled(e) && n < 2 });
  const suppliersQ = trpc.travel.listSuppliers.useQuery(undefined, { retry: false });
  const sitesQ = trpc.sites.list.useQuery(undefined, { retry: false });
  const [scope, setScope] = useState<"global" | "sede" | "proveedor">("global");
  const [key, setKey] = useState("");
  const [markup, setMarkup] = useState("20");
  const [commission, setCommission] = useState("0");
  const [active, setActive] = useState(true);
  const save = trpc.travel.saveMarginRule.useMutation({ onSuccess: () => { toast.success("Regla guardada"); void utils.travel.listMarginRules.invalidate(); }, onError: (e) => toast.error(e.message) });
  const supplierName = (id: string) => (suppliersQ.data ?? []).find((s) => String(s.id) === id)?.name ?? `Proveedor ${id}`;
  const sites = ((sitesQ.data as any)?.sites ?? []) as Array<{ siteId: string; name?: string }>;
  const rules = q.data ?? [];
  const global = rules.find((r) => r.scope === "global" && r.isActive);

  return (
    <AdminLayout title="Márgenes comerciales">
      <div className="space-y-5 max-w-full">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Coins className="h-6 w-6 shrink-0" /> Márgenes</h1>
          <p className="text-muted-foreground text-sm">
            Recargo sobre el coste neto (PVP = neto × (1 + recargo)) y comisión por defecto cuando el proveedor fija el PVP. Se aplica la regla más concreta: proveedor, después sede y después global; sin reglas, 20 % de recargo.
          </p>
        </div>
        {isTravelNotInstalled(q.error) ? <TravelNotInstalled /> : (
          <>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Nueva regla o cambio</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Ámbito</Label>
                    <Select value={scope} onValueChange={(v) => { setScope(v as typeof scope); setKey(""); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="global">Global</SelectItem><SelectItem value="sede">Sede</SelectItem><SelectItem value="proveedor">Proveedor</SelectItem></SelectContent>
                    </Select>
                  </div>
                  {scope === "proveedor" && (
                    <div className="space-y-1 col-span-2 lg:col-span-1">
                      <Label className="text-xs">Proveedor</Label>
                      <Select value={key} onValueChange={setKey}>
                        <SelectTrigger><SelectValue placeholder="Elige el proveedor" /></SelectTrigger>
                        <SelectContent>{(suppliersQ.data ?? []).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  {scope === "sede" && (
                    <div className="space-y-1 col-span-2 lg:col-span-1">
                      <Label className="text-xs">Sede</Label>
                      {sites.length ? (
                        <Select value={key} onValueChange={setKey}>
                          <SelectTrigger><SelectValue placeholder="Elige la sede" /></SelectTrigger>
                          <SelectContent>{sites.map((s) => <SelectItem key={s.siteId} value={s.siteId}>{s.name ?? s.siteId}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : <Input value={key} maxLength={63} onChange={(e) => setKey(e.target.value)} placeholder="Identificador de la sede" />}
                    </div>
                  )}
                  <div className="space-y-1"><Label className="text-xs">Recargo (%)</Label><Input inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Comisión (%)</Label><Input inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} /></div>
                  <label className="flex items-center gap-2 text-sm pb-2"><Switch checked={active} onCheckedChange={setActive} /> Activa</label>
                </div>
                <Button size="sm" disabled={save.isPending || (scope !== "global" && !key)} onClick={() => {
                  const m = toBp(markup), c = toBp(commission);
                  if (!Number.isFinite(m) || !Number.isFinite(c)) return toast.error("Porcentaje no válido");
                  save.mutate({ scope, scopeKey: scope === "global" ? "" : key, markupBp: m, commissionBp: c, isActive: active });
                }}>Guardar regla</Button>
                <p className="text-xs text-muted-foreground">Solo administración cambia los márgenes. Afectan a los servicios que se añadan o editen a partir de ahora.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-0">
                {rules.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">Sin reglas: se aplica el 20 % de recargo por defecto. Crea la regla global para fijar el tuyo.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[520px]">
                      <thead className="border-b border-border bg-muted/40 text-left"><tr><th className="p-3 font-medium">Ámbito</th><th className="p-3 font-medium">Aplica a</th><th className="p-3 font-medium">Recargo</th><th className="p-3 font-medium">Comisión</th><th className="p-3 font-medium">Estado</th></tr></thead>
                      <tbody>
                        {rules.map((r) => (
                          <tr key={r.id} className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/20" onClick={() => { setScope(r.scope); setKey(r.scopeKey); setMarkup(String(r.markupBp / 100)); setCommission(String(r.commissionBp / 100)); setActive(r.isActive); }}>
                            <td className="p-3">{SCOPE_LABEL[r.scope]}</td>
                            <td className="p-3">{r.scope === "global" ? "Todos" : r.scope === "proveedor" ? supplierName(r.scopeKey) : r.scopeKey}</td>
                            <td className="p-3">{pct(r.markupBp)}</td>
                            <td className="p-3">{pct(r.commissionBp)}</td>
                            <td className="p-3"><Badge variant={r.isActive ? "secondary" : "outline"}>{r.isActive ? "Activa" : "Hereda"}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            {!global && <p className="text-xs text-muted-foreground">Sin regla global activa: el recargo por defecto es el 20 %.</p>}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
