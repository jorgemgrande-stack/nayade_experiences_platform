import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, MapPin, MoreVertical, Copy, PowerOff, Power, ChevronUp, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PanelEmpty, PanelError } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { useVocabulary } from "@/lib/vocabulary";
import { useI18n } from "@/i18n/I18nProvider";

interface LocationForm {
  name: string;
  slug: string;
  description: string;
  address: string;
  mapUrl: string;
  imageUrl: string;
}

const emptyForm: LocationForm = { name: "", slug: "", description: "", address: "", mapUrl: "", imageUrl: "" };

export default function LocationsManager() {
  const voc = useVocabulary();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<LocationForm>(emptyForm);
  const [localOrder, setLocalOrder] = useState<number[]>([]);

  const utils = trpc.useUtils();
  const { data: locations, isLoading, isError, error, refetch } = trpc.products.getLocations.useQuery();

  const createMut = trpc.products.createLocation.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); toast.success(t("productsLocations.toast.created")); setOpen(false); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.products.updateLocation.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); toast.success(t("productsLocations.toast.updated")); setOpen(false); setEditId(null); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.products.deleteLocation.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); toast.success(t("productsLocations.toast.deactivated")); },
    onError: (e) => toast.error(e.message),
  });
  const hardDeleteMut = trpc.products.hardDeleteLocation.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); toast.success(t("productsLocations.toast.removed")); },
    onError: (e) => toast.error(e.message),
  });
  const toggleActiveMut = trpc.products.toggleLocationActive.useMutation({
    onSuccess: (_, vars) => { utils.products.getLocations.invalidate(); toast.success(vars.isActive ? t("productsLocations.toast.activated") : t("productsLocations.toast.deactivated")); },
    onError: (e) => toast.error(e.message),
  });
  const cloneMut = trpc.products.cloneLocation.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); toast.success(t("productsLocations.toast.cloned")); },
    onError: (e) => toast.error(e.message),
  });
  const reorderMut = trpc.products.reorderLocations.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); },
    onError: () => toast.error(t("productsLocations.toast.orderError")),
  });

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (loc: NonNullable<typeof locations>[0]) => {
    setEditId(loc.id);
    setForm({ name: loc.name, slug: loc.slug, description: loc.description ?? "", address: loc.address ?? "", mapUrl: "", imageUrl: loc.imageUrl ?? "" });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name || !form.slug) { toast.error(t("productsLocations.toast.required")); return; }
    if (editId) updateMut.mutate({ id: editId, name: form.name, description: form.description, imageUrl: form.imageUrl || undefined });
    else createMut.mutate({ name: form.name, slug: form.slug, description: form.description, address: form.address || undefined, imageUrl: form.imageUrl || undefined });
  };

  const toSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const sortedLocations = (() => {
    const list = locations ?? [];
    if (localOrder.length === list.length && localOrder.length > 0) {
      const map = new Map(list.map(l => [l.id, l]));
      return localOrder.map(id => map.get(id)).filter(Boolean) as typeof list;
    }
    return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  })();

  const moveLoc = (index: number, direction: "up" | "down") => {
    const current = localOrder.length > 0 ? localOrder : sortedLocations.map(l => l.id);
    const newOrder = [...current];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    setLocalOrder(newOrder);
    reorderMut.mutate({ items: newOrder.map((id, i) => ({ id, sortOrder: i })) });
  };

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <PanelPageHeader
        icon={<MapPin />}
        title={t("productsLocations.title")}
        description={isError ? undefined : t("productsLocations.count", { n: locations?.length ?? 0 })}
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> {t("productsLocations.newLocation")}
          </Button>
        }
      />

      {isLoading ? (
        <div role="status" className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : isError ? (
        <PanelError error={error} onRetry={() => refetch()} title={t("productsLocations.loadError")} />
      ) : sortedLocations.length === 0 ? (
        <PanelEmpty
          icon={<MapPin className="w-6 h-6" />}
          title={t("productsLocations.empty.title")}
          description={t("productsLocations.empty.description")}
        >
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" /> {t("productsLocations.empty.cta")}
          </Button>
        </PanelEmpty>
      ) : (
        <div className="space-y-3">
          {sortedLocations.map((loc, idx) => (
            <div key={loc.id} className="bg-card border border-border rounded-xl p-4 sm:p-5 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-3">
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <button onClick={() => moveLoc(idx, "up")} disabled={idx === 0 || reorderMut.isPending} className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed" title={t("productsLocations.up")}>
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                </button>
                <span className="text-xs font-mono text-muted-foreground">{idx + 1}</span>
                <button onClick={() => moveLoc(idx, "down")} disabled={idx === sortedLocations.length - 1 || reorderMut.isPending} className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed" title={t("productsLocations.down")}>
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <MapPin className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0 basis-40">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="font-semibold text-foreground break-words min-w-0">{loc.name}</p>
                  <StatusBadge tone={loc.isActive ? "success" : "neutral"}>{loc.isActive ? t("productsLocations.active") : t("productsLocations.inactive")}</StatusBadge>
                </div>
                {loc.address && <p className="text-sm text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{loc.address}</p>}
                {loc.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{loc.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0 ml-auto">
                <Button size="sm" variant="outline" onClick={() => openEdit(loc)}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> {t("productsLocations.edit")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="px-2">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => toggleActiveMut.mutate({ id: loc.id, isActive: !loc.isActive })}>
                      {loc.isActive
                        ? <><PowerOff className="w-3.5 h-3.5 mr-2" /> {t("productsLocations.deactivate")}</>
                        : <><Power className="w-3.5 h-3.5 mr-2" /> {t("productsLocations.activate")}</>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => cloneMut.mutate({ id: loc.id })}>
                      <Copy className="w-3.5 h-3.5 mr-2" /> {t("productsLocations.clone")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={async () => { if ((await confirmAction({ description: t("productsLocations.confirmRemove"), destructive: true }))) hardDeleteMut.mutate({ id: loc.id }); }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> {t("productsLocations.remove")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? t("productsLocations.dialog.editTitle") : t("productsLocations.dialog.newTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>{t("productsLocations.dialog.name")}</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value, slug: editId ? f.slug : toSlug(e.target.value) }))} placeholder={voc.catalog.locationExample} />
            </div>
            <div>
              <Label>{voc.licensed ? t("productsLocations.dialog.slugLicensed") : t("productsLocations.dialog.slug")}</Label>
              <Input value={form.slug} onChange={(e) => setForm(f => ({ ...f, slug: toSlug(e.target.value) }))} placeholder={voc.licensed ? "tienda-principal" : "embarcadero-principal"} />
              {voc.licensed && <p className="text-xs text-muted-foreground mt-1">{t("productsLocations.dialog.slugHelp")}</p>}
            </div>
            <div>
              <Label>{t("productsLocations.dialog.address")}</Label>
              <Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} placeholder={t("productsLocations.dialog.addressPlaceholder")} />
            </div>
            <div>
              <Label>{t("productsLocations.dialog.description")}</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div>
              <Label>{t("productsLocations.dialog.mapLink")}</Label>
              <Input value={form.mapUrl} onChange={(e) => setForm(f => ({ ...f, mapUrl: e.target.value }))} placeholder="https://maps.google.com/..." />
            </div>
            <div>
              <Label>{t("productsLocations.dialog.imageLink")}</Label>
              <Input value={form.imageUrl} onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("productsLocations.dialog.cancel")}</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>
              {editId ? t("productsLocations.dialog.save") : t("productsLocations.dialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
