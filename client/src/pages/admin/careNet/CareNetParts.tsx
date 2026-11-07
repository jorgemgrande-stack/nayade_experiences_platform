/**
 * Piezas comunes de Care Net · bonos y reservas: cabecera, buscador de clientes del CRM, selector de caja abierta del
 * TPV, estado de un bono con tonos por significado y diálogo de venta de un bono (cobro con el TPV del Core).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelLoading, toastError } from "@/components/admin/PanelStates";
import { TONE_BADGE, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { CARE_NET_CAPABILITY, PURCHASE_STATE_LABELS, formatEur, type PurchaseState } from "@shared/careNet";

export const RESERVAS_PATH = "/admin/care-net/reservas";
export const BONOS_PATH = "/admin/care-net/bonos";
export const CLIENTES_PATH = "/admin/care-net/clientes";

export const PURCHASE_TONE: Record<PurchaseState, Tone> = { pending: "warning", active: "success", exhausted: "neutral", expired: "danger", cancelled: "neutral" };

export function useCareWrite() {
  const sub = usePanelSubscription();
  const { user } = useAuth();
  return { canWrite: sub.canWrite(CARE_NET_CAPABILITY), isAdmin: (user as { role?: string } | null)?.role === "admin" };
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-foreground">{title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PurchaseBadge({ state }: { state: PurchaseState }) {
  return <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", TONE_BADGE[PURCHASE_TONE[state]])}>{PURCHASE_STATE_LABELS[state]}</span>;
}

export const fmtDate = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Madrid" }) : "—");

export const newRequestKey = (): string => {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
  }
};

/** Buscador de clientes del CRM (nombre, correo o teléfono). */
export function ClientPicker({ value, onChange }: { value: { id: number; name: string } | null; onChange: (c: { id: number; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const res = trpc.careNet.searchClients.useQuery({ q }, { enabled: q.trim().length >= 2 });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="min-w-0 break-words text-foreground">{value.name}</span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Cambiar</Button>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Buscar cliente" placeholder="Nombre, correo o teléfono" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim().length >= 2 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-border">
          {(res.data ?? []).map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onChange({ id: c.id, name: c.name })}>
                <span className="text-foreground">{c.name}</span> <span className="text-xs text-muted-foreground">{c.email}</span>
              </button>
            </li>
          ))}
          {res.data && res.data.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              Sin resultados. <Link href="/admin/crm/clientes" className="underline">Da de alta al cliente en el CRM</Link>.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Caja abierta del TPV para cobrar (o el aviso para abrirla). Devuelve la sesión elegida. */
export function useOpenCash() {
  const registers = trpc.tpv.getRegisterStatus.useQuery(undefined, { retry: false });
  const open = (registers.data ?? []).filter((r) => r.openSession);
  const [chosen, setChosen] = useState("");
  const sessionId = chosen || (open.length === 1 ? String(open[0].openSession!.id) : "");
  const picker = registers.isLoading ? (
    <PanelLoading label="Buscando cajas abiertas…" className="py-2" />
  ) : registers.isError ? (
    <p className="text-sm text-foreground">Para cobrar necesitas acceso a la caja (TPV).</p>
  ) : open.length === 0 ? (
    <p className="text-sm text-foreground">No hay ninguna caja abierta. <Link href="/admin/tpv" className="underline">Abre la caja en el TPV</Link> y vuelve aquí.</p>
  ) : (
    <div className="space-y-1.5">
      <Label htmlFor="care-cash">Caja</Label>
      <Select value={sessionId} onValueChange={setChosen}>
        <SelectTrigger id="care-cash"><SelectValue placeholder="Elige la caja" /></SelectTrigger>
        <SelectContent>{open.map((r) => <SelectItem key={r.id} value={String(r.openSession!.id)}>{r.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  return { sessionId: sessionId ? Number(sessionId) : null, picker };
}

const METHODS = [["card", "Tarjeta"], ["cash", "Efectivo"], ["bizum", "Bizum"], ["other", "Otro"]] as const;

/** Venta de un bono a un cliente del CRM, cobrada con el TPV del Core. */
export function SellPackDialog({ initialPackId, initialClient, onClose }: { initialPackId?: number; initialClient?: { id: number; name: string } | null; onClose: () => void }) {
  const packs = trpc.careNet.listPacks.useQuery({});
  const utils = trpc.useUtils();
  const [packId, setPackId] = useState(initialPackId ? String(initialPackId) : "");
  const [client, setClient] = useState<{ id: number; name: string } | null>(initialClient ?? null);
  const [method, setMethod] = useState<(typeof METHODS)[number][0]>("card");
  const requestKey = useMemo(newRequestKey, []);
  const cash = useOpenCash();
  const pack = (packs.data ?? []).find((p) => String(p.id) === packId) ?? null;
  const sell = trpc.careNet.sellPack.useMutation({
    onSuccess: (r) => {
      toast.success(r.replayed ? "Este bono ya estaba vendido" : `Bono vendido a ${r.purchase.clientName}`);
      utils.careNet.clientsWithPacks.invalidate();
      utils.careNet.clientPacks.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vender un bono</DialogTitle>
          <DialogDescription>Se cobra como venta del TPV en la caja elegida; el bono empieza a contar desde hoy.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="care-sell-pack">Bono</Label>
            <Select value={packId} onValueChange={setPackId}>
              <SelectTrigger id="care-sell-pack"><SelectValue placeholder="Elige el bono" /></SelectTrigger>
              <SelectContent>{(packs.data ?? []).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name} · {p.sessions} sesiones · {formatEur(p.price)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <ClientPicker value={client} onChange={setClient} />
          </div>
          {cash.picker}
          <div className="space-y-1.5">
            <Label htmlFor="care-sell-method">Forma de pago</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger id="care-sell-method"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {pack && <p className="text-sm text-foreground">Total: <strong>{formatEur(pack.price)}</strong> · caduca a los {pack.validityDays} días</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!pack || !client || !cash.sessionId || sell.isPending}
            onClick={() => sell.mutate({ packId: pack!.id, clientId: client!.id, sessionId: cash.sessionId!, payments: [{ method, amount: pack!.price }], requestKey })}
          >
            {sell.isPending ? "Cobrando…" : "Cobrar y vender"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
