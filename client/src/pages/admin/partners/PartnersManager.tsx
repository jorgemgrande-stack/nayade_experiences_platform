import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, Edit2, RefreshCw, KeyRound, ToggleLeft, ToggleRight,
  Copy, Check, ChevronDown, ChevronUp, Package, Handshake,
  Mail, Phone, User, Link2, ShieldCheck, ShieldOff, Trash2,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Partner {
  id: number;
  name: string;
  slug: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  isActive: boolean;
  canSendQuotes: boolean;
  canRedeemDirectly: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface AllowedProduct {
  id: number;
  partnerId: number;
  productId: number;
  productType: string;
  canQuote: boolean;
  canRedeem: boolean;
  createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} className="ml-2 text-gray-400 hover:text-orange-400 transition-colors">
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: "green" | "red" | "orange" | "gray" | "blue" }) {
  const colors = {
    green:  "bg-green-500/20 text-green-300 border border-green-500/30",
    red:    "bg-red-500/20 text-red-300 border border-red-500/30",
    orange: "bg-orange-500/20 text-orange-300 border border-orange-500/30",
    gray:   "bg-gray-500/20 text-gray-400 border border-gray-500/30",
    blue:   "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

// ─── Modal Crear Partner ───────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "", slug: "",
    contactName: "", contactEmail: "", contactPhone: "",
    canSendQuotes: true, canRedeemDirectly: false,
  });
  const [newKey, setNewKey] = useState<string | null>(null);

  const createMutation = trpc.partners.create.useMutation({
    onSuccess: (res) => {
      setNewKey(res.accessKey);
      onCreated();
    },
    onError: (e) => toast.error("Error al crear partner: " + e.message),
  });

  function slugify(v: string) {
    return v.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }

  function handleNameChange(v: string) {
    setForm(f => ({ ...f, name: v, slug: slugify(v) }));
  }

  function submit() {
    if (!form.name || !form.slug) return toast.error("Nombre y slug son obligatorios");
    createMutation.mutate({
      name: form.name,
      slug: form.slug,
      contactName: form.contactName || undefined,
      contactEmail: form.contactEmail || undefined,
      contactPhone: form.contactPhone || undefined,
      canSendQuotes: form.canSendQuotes,
      canRedeemDirectly: form.canRedeemDirectly,
    });
  }

  if (newKey) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="bg-[#0d1526] border-gray-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-green-400 flex items-center gap-2">
              <Check className="w-5 h-5" /> Partner creado
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              Guarda esta clave de acceso ahora — <span className="text-orange-400 font-semibold">no se volverá a mostrar.</span>
            </p>
            <div className="bg-[#1a2540] rounded-lg p-3 flex items-center justify-between gap-2 border border-orange-500/30">
              <code className="text-orange-300 text-xs break-all font-mono">{newKey}</code>
              <CopyButton text={newKey} />
            </div>
            <p className="text-xs text-gray-500">
              Comparte esta clave solo con el partner. Se usa junto al slug para autenticar cada petición desde su landing.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={onClose} className="bg-orange-500 hover:bg-orange-600 text-white">
              Entendido, ya la guardé
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0d1526] border-gray-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="w-5 h-5 text-orange-400" /> Nuevo Partner
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-gray-300 text-sm">Nombre del partner *</Label>
              <Input
                value={form.name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="Hotel El Pinar"
                className="bg-[#1a2540] border-gray-600 text-white mt-1"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-gray-300 text-sm">Slug (URL) *</Label>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-gray-500 text-sm">/partner/</span>
                <Input
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))}
                  placeholder="hotel-el-pinar"
                  className="bg-[#1a2540] border-gray-600 text-white"
                />
              </div>
            </div>
            <div>
              <Label className="text-gray-300 text-sm">Nombre contacto</Label>
              <Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
                placeholder="Ana García" className="bg-[#1a2540] border-gray-600 text-white mt-1" />
            </div>
            <div>
              <Label className="text-gray-300 text-sm">Teléfono contacto</Label>
              <Input value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
                placeholder="+34 600 000 000" className="bg-[#1a2540] border-gray-600 text-white mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-gray-300 text-sm">Email contacto</Label>
              <Input value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
                placeholder="contacto@hotel.com" className="bg-[#1a2540] border-gray-600 text-white mt-1" />
            </div>
          </div>

          <div className="border-t border-gray-700 pt-3 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Permisos</p>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm text-white">Puede generar presupuestos</p>
                <p className="text-xs text-gray-500">El partner puede crear presupuestos para sus clientes</p>
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, canSendQuotes: !f.canSendQuotes }))}
                className={`w-11 h-6 rounded-full transition-colors ${form.canSendQuotes ? "bg-orange-500" : "bg-gray-600"}`}
              >
                <span className={`block w-5 h-5 bg-white rounded-full transition-transform mx-0.5 ${form.canSendQuotes ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm text-white">Puede canjear directamente</p>
                <p className="text-xs text-gray-500">El partner puede registrar reservas sin pago</p>
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, canRedeemDirectly: !f.canRedeemDirectly }))}
                className={`w-11 h-6 rounded-full transition-colors ${form.canRedeemDirectly ? "bg-orange-500" : "bg-gray-600"}`}
              >
                <span className={`block w-5 h-5 bg-white rounded-full transition-transform mx-0.5 ${form.canRedeemDirectly ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-gray-400">Cancelar</Button>
          <Button onClick={submit} disabled={createMutation.isPending} className="bg-orange-500 hover:bg-orange-600 text-white">
            {createMutation.isPending ? "Creando..." : "Crear partner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal Editar Partner ──────────────────────────────────────────────────────

function EditModal({ partner, onClose, onSaved }: { partner: Partner; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: partner.name,
    contactName: partner.contactName ?? "",
    contactEmail: partner.contactEmail ?? "",
    contactPhone: partner.contactPhone ?? "",
    canSendQuotes: partner.canSendQuotes,
    canRedeemDirectly: partner.canRedeemDirectly,
  });

  const updateMutation = trpc.partners.update.useMutation({
    onSuccess: () => { toast.success("Partner actualizado"); onSaved(); onClose(); },
    onError: (e) => toast.error("Error: " + e.message),
  });

  function submit() {
    if (!form.name) return toast.error("El nombre es obligatorio");
    updateMutation.mutate({
      id: partner.id,
      name: form.name,
      contactName: form.contactName || undefined,
      contactEmail: form.contactEmail || undefined,
      contactPhone: form.contactPhone || undefined,
      canSendQuotes: form.canSendQuotes,
      canRedeemDirectly: form.canRedeemDirectly,
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0d1526] border-gray-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-orange-400" /> Editar: {partner.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-[#1a2540] rounded px-3 py-2 text-xs text-gray-500 flex items-center gap-2">
            <Link2 className="w-3 h-3" /> Slug permanente: <span className="text-gray-300 font-mono">{partner.slug}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-gray-300 text-sm">Nombre *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="bg-[#1a2540] border-gray-600 text-white mt-1" />
            </div>
            <div>
              <Label className="text-gray-300 text-sm">Nombre contacto</Label>
              <Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
                className="bg-[#1a2540] border-gray-600 text-white mt-1" />
            </div>
            <div>
              <Label className="text-gray-300 text-sm">Teléfono</Label>
              <Input value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
                className="bg-[#1a2540] border-gray-600 text-white mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-gray-300 text-sm">Email</Label>
              <Input value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
                className="bg-[#1a2540] border-gray-600 text-white mt-1" />
            </div>
          </div>
          <div className="border-t border-gray-700 pt-3 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Permisos</p>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-white">Puede generar presupuestos</span>
              <button type="button" onClick={() => setForm(f => ({ ...f, canSendQuotes: !f.canSendQuotes }))}
                className={`w-11 h-6 rounded-full transition-colors ${form.canSendQuotes ? "bg-orange-500" : "bg-gray-600"}`}>
                <span className={`block w-5 h-5 bg-white rounded-full transition-transform mx-0.5 ${form.canSendQuotes ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-white">Puede canjear directamente</span>
              <button type="button" onClick={() => setForm(f => ({ ...f, canRedeemDirectly: !f.canRedeemDirectly }))}
                className={`w-11 h-6 rounded-full transition-colors ${form.canRedeemDirectly ? "bg-orange-500" : "bg-gray-600"}`}>
                <span className={`block w-5 h-5 bg-white rounded-full transition-transform mx-0.5 ${form.canRedeemDirectly ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-gray-400">Cancelar</Button>
          <Button onClick={submit} disabled={updateMutation.isPending} className="bg-orange-500 hover:bg-orange-600 text-white">
            {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Panel Productos Permitidos ────────────────────────────────────────────────

function ProductsPanel({ partner, onClose }: { partner: Partner; onClose: () => void }) {
  const { data, refetch } = trpc.partners.getById.useQuery({ id: partner.id });
  const allowedProducts: AllowedProduct[] = data?.allowedProducts ?? [];

  const [addType, setAddType] = useState<"experience" | "pack">("experience");
  const [addId, setAddId] = useState("");
  const [addCanQuote, setAddCanQuote] = useState(true);
  const [addCanRedeem, setAddCanRedeem] = useState(false);

  const setProductsMutation = trpc.partners.setAllowedProducts.useMutation({
    onSuccess: () => { toast.success("Productos actualizados"); refetch(); },
    onError: (e) => toast.error("Error: " + e.message),
  });

  function addProduct() {
    const pid = parseInt(addId);
    if (!pid) return toast.error("ID de producto inválido");
    if (allowedProducts.some(p => p.productId === pid && p.productType === addType)) {
      return toast.error("Ese producto ya está en la lista");
    }
    const updated = [
      ...allowedProducts.map(p => ({
        productId: p.productId,
        productType: p.productType as "experience" | "pack",
        canQuote: p.canQuote,
        canRedeem: p.canRedeem,
      })),
      { productId: pid, productType: addType, canQuote: addCanQuote, canRedeem: addCanRedeem },
    ];
    setProductsMutation.mutate({ partnerId: partner.id, products: updated });
    setAddId("");
  }

  function removeProduct(productId: number, productType: string) {
    const updated = allowedProducts
      .filter(p => !(p.productId === productId && p.productType === productType))
      .map(p => ({
        productId: p.productId,
        productType: p.productType as "experience" | "pack",
        canQuote: p.canQuote,
        canRedeem: p.canRedeem,
      }));
    setProductsMutation.mutate({ partnerId: partner.id, products: updated });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0d1526] border-gray-700 text-white max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-400" /> Productos — {partner.name}
          </DialogTitle>
        </DialogHeader>

        {/* Lista actual */}
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {allowedProducts.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">Sin productos asignados todavía.</p>
          )}
          {allowedProducts.map(p => (
            <div key={`${p.productType}-${p.productId}`}
              className="flex items-center justify-between bg-[#1a2540] rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge color={p.productType === "experience" ? "blue" : "orange"}>
                  {p.productType === "experience" ? "Exp" : "Pack"}
                </Badge>
                <span className="text-white text-sm font-mono">#{p.productId}</span>
                <div className="flex gap-1">
                  {p.canQuote && <Badge color="green">Presupuesto</Badge>}
                  {p.canRedeem && <Badge color="orange">Canje</Badge>}
                </div>
              </div>
              <button onClick={() => removeProduct(p.productId, p.productType)}
                className="text-red-400 hover:text-red-300 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Añadir producto */}
        <div className="border-t border-gray-700 pt-3 space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Añadir producto</p>
          <div className="flex gap-2">
            <select
              value={addType}
              onChange={e => setAddType(e.target.value as "experience" | "pack")}
              className="bg-[#1a2540] border border-gray-600 text-white text-sm rounded px-2 py-1.5"
            >
              <option value="experience">Experiencia</option>
              <option value="pack">Pack</option>
            </select>
            <Input
              value={addId}
              onChange={e => setAddId(e.target.value)}
              placeholder="ID del producto"
              className="bg-[#1a2540] border-gray-600 text-white"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
              <input type="checkbox" checked={addCanQuote} onChange={e => setAddCanQuote(e.target.checked)}
                className="accent-orange-500" />
              Presupuesto
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
              <input type="checkbox" checked={addCanRedeem} onChange={e => setAddCanRedeem(e.target.checked)}
                className="accent-orange-500" />
              Canje directo
            </label>
            <Button onClick={addProduct} disabled={setProductsMutation.isPending} size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white ml-auto">
              <Plus className="w-4 h-4 mr-1" /> Añadir
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-gray-400">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tarjeta de Partner ────────────────────────────────────────────────────────

function PartnerCard({
  partner, onEdit, onRefresh,
}: {
  partner: Partner;
  onEdit: (p: Partner) => void;
  onRefresh: () => void;
}) {
  const [showProducts, setShowProducts] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const toggleMutation = trpc.partners.toggleActive.useMutation({
    onSuccess: () => onRefresh(),
    onError: (e) => toast.error("Error: " + e.message),
  });

  const regenMutation = trpc.partners.regenerateKey.useMutation({
    onSuccess: (res) => setNewKey(res.accessKey),
    onError: (e) => toast.error("Error al regenerar clave: " + e.message),
  });

  return (
    <>
      <div className="bg-[#0d1526] border border-gray-700/50 rounded-xl p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <Handshake className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold">{partner.name}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-gray-500 text-xs font-mono">/partner/{partner.slug}</span>
                <CopyButton text={`/partner/${partner.slug}`} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge color={partner.isActive ? "green" : "red"}>
              {partner.isActive ? "Activo" : "Inactivo"}
            </Badge>
          </div>
        </div>

        {/* Permisos */}
        <div className="flex flex-wrap gap-1.5">
          {partner.canSendQuotes && <Badge color="blue"><ShieldCheck className="w-3 h-3" /> Presupuestos</Badge>}
          {partner.canRedeemDirectly && <Badge color="orange"><ShieldCheck className="w-3 h-3" /> Canje directo</Badge>}
          {!partner.canSendQuotes && !partner.canRedeemDirectly &&
            <Badge color="gray"><ShieldOff className="w-3 h-3" /> Sin permisos</Badge>}
        </div>

        {/* Contacto */}
        {(partner.contactName || partner.contactEmail || partner.contactPhone) && (
          <div className="bg-[#1a2540] rounded-lg p-2.5 space-y-1">
            {partner.contactName && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <User className="w-3 h-3" /> {partner.contactName}
              </div>
            )}
            {partner.contactEmail && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Mail className="w-3 h-3" /> {partner.contactEmail}
              </div>
            )}
            {partner.contactPhone && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Phone className="w-3 h-3" /> {partner.contactPhone}
              </div>
            )}
          </div>
        )}

        {/* Acciones */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline"
            className="border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 h-7 text-xs"
            onClick={() => onEdit(partner)}>
            <Edit2 className="w-3 h-3 mr-1" /> Editar
          </Button>
          <Button size="sm" variant="outline"
            className="border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 h-7 text-xs"
            onClick={() => setShowProducts(true)}>
            <Package className="w-3 h-3 mr-1" /> Productos
          </Button>
          <Button size="sm" variant="outline"
            className={`border-gray-600 h-7 text-xs ${partner.isActive ? "text-red-400 hover:text-red-300" : "text-green-400 hover:text-green-300"}`}
            onClick={() => toggleMutation.mutate({ id: partner.id, isActive: !partner.isActive })}
            disabled={toggleMutation.isPending}>
            {partner.isActive
              ? <><ToggleLeft className="w-3 h-3 mr-1" /> Desactivar</>
              : <><ToggleRight className="w-3 h-3 mr-1" /> Activar</>}
          </Button>
          <Button size="sm" variant="outline"
            className="border-gray-600 text-gray-400 hover:text-orange-300 hover:border-orange-500/50 h-7 text-xs"
            onClick={() => {
              if (confirm("¿Generar nueva clave? La clave actual quedará inválida.")) {
                regenMutation.mutate({ id: partner.id });
              }
            }}
            disabled={regenMutation.isPending}>
            <RefreshCw className="w-3 h-3 mr-1" /> Nueva clave
          </Button>
        </div>
      </div>

      {/* Modal nueva clave */}
      {newKey && (
        <Dialog open onOpenChange={() => setNewKey(null)}>
          <DialogContent className="bg-[#0d1526] border-gray-700 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-orange-400 flex items-center gap-2">
                <KeyRound className="w-5 h-5" /> Nueva clave generada
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-gray-300">
                Copia esta clave ahora — <span className="text-orange-400 font-semibold">no se volverá a mostrar.</span>
              </p>
              <div className="bg-[#1a2540] rounded-lg p-3 flex items-center gap-2 border border-orange-500/30">
                <code className="text-orange-300 text-xs break-all font-mono flex-1">{newKey}</code>
                <CopyButton text={newKey} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setNewKey(null)} className="bg-orange-500 hover:bg-orange-600 text-white">
                Entendido
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Panel productos */}
      {showProducts && (
        <ProductsPanel partner={partner} onClose={() => setShowProducts(false)} />
      )}
    </>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function PartnersManager() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);

  const { data: partners = [], refetch, isLoading } = trpc.partners.list.useQuery();

  const activeCount = partners.filter(p => p.isActive).length;

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Cabecera */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Handshake className="w-7 h-7 text-orange-400" />
              Landing Partners
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Hoteles y colaboradores que generan presupuestos desde su landing privada
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white">
            <Plus className="w-4 h-4 mr-2" /> Nuevo partner
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Partners totales", value: partners.length, color: "text-white" },
            { label: "Activos", value: activeCount, color: "text-green-400" },
            { label: "Inactivos", value: partners.length - activeCount, color: "text-red-400" },
          ].map(s => (
            <div key={s.label} className="bg-[#0d1526] border border-gray-700/50 rounded-xl p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-gray-500 text-xs mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Lista */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : partners.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Handshake className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg">No hay partners configurados</p>
            <p className="text-sm mt-1">Crea el primero para empezar</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {partners.map(p => (
              <PartnerCard
                key={p.id}
                partner={p as Partner}
                onEdit={setEditingPartner}
                onRefresh={refetch}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { refetch(); }}
        />
      )}

      {editingPartner && (
        <EditModal
          partner={editingPartner}
          onClose={() => setEditingPartner(null)}
          onSaved={() => refetch()}
        />
      )}
    </AdminLayout>
  );
}
