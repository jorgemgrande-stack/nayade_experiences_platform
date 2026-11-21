import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, Euro, Info, MoreVertical, ListChecks } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PanelEmpty } from "@/components/admin/PanelStates";
import { Link } from "wouter";
import { useVocabulary } from "@/lib/vocabulary";
import { VariantIncludedServicesDialog } from "./EnrollmentCommerce";
import { useI18n } from "@/i18n/I18nProvider";


type FormState = {
  experienceId: number;
  name: string;
  description: string;
  priceModifier: string;
  priceType: "fixed" | "percentage" | "per_person";
  isRequired: boolean;
  sortOrder: string;
  validUntil: string;
};

const emptyForm = (): FormState => ({
  experienceId: 0,
  name: "",
  description: "",
  priceModifier: "",
  priceType: "per_person",
  isRequired: false,
  sortOrder: "0",
  validUntil: "",
});

export default function VariantsManager() {
  const [selectedExp, setSelectedExp] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [servicesFor, setServicesFor] = useState<{ id: number; name: string } | null>(null);
  const voc = useVocabulary();
  const { t, format } = useI18n();
  // Pyme: «producto o servicio»; instalación propia: «experiencia»
  const item = voc.licensed ? t("productsVariants.itemLower.licensed") : t("productsVariants.itemLower.own");
  const Item = voc.licensed ? t("productsVariants.itemUpper.licensed") : t("productsVariants.itemUpper.own");
  // Pyme sin reservas: el precio de la variante es el de cada unidad; «por persona» no aplica.
  const priceTypeLabels: Record<string, string> = voc.licensed
    ? { fixed: t("productsVariants.priceType.smeFixed"), per_person: t("productsVariants.priceType.smePerPerson"), percentage: t("productsVariants.priceType.smePercentage") }
    : { fixed: t("productsVariants.priceType.fixed"), per_person: t("productsVariants.priceType.perPerson"), percentage: t("productsVariants.priceType.percentage") };
  const amount = (v: string | null | undefined) => format.number(parseFloat(v ?? "0"), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const utils = trpc.useUtils();
  const { data: experiences, isLoading: loadingExp } = trpc.products.getAll.useQuery();
  const { data: allVariants, isLoading: loadingVariants } = trpc.products.getVariants.useQuery(
    selectedExp !== "all" ? { experienceId: parseInt(selectedExp) } : {}
  );

  const createMutation = trpc.products.createVariant.useMutation({
    onSuccess: () => {
      toast.success(t("productsVariants.toast.created"));
      utils.products.getVariants.invalidate();
      setOpen(false);
    },
    onError: (err) => toast.error(t("productsVariants.toast.createError", { message: err.message })),
  });

  const updateMutation = trpc.products.updateVariant.useMutation({
    onSuccess: () => {
      toast.success(t("productsVariants.toast.updated"));
      utils.products.getVariants.invalidate();
      setOpen(false);
    },
    onError: (err) => toast.error(t("productsVariants.toast.updateError", { message: err.message })),
  });

  const deleteMutation = trpc.products.deleteVariant.useMutation({
    onSuccess: () => {
      toast.success(t("productsVariants.toast.deleted"));
      utils.products.getVariants.invalidate();
      setDeleteConfirm(null);
    },
    onError: (err) => toast.error(t("productsVariants.toast.deleteError", { message: err.message })),
  });

  // Group variants by experienceId
  const variantsByExp = (allVariants ?? []).reduce<Record<number, typeof allVariants>>((acc, v) => {
    if (!acc[v.experienceId]) acc[v.experienceId] = [];
    acc[v.experienceId]!.push(v);
    return acc;
  }, {});

  const filtered = selectedExp === "all"
    ? experiences
    : experiences?.filter(e => String(e.id) === selectedExp);

  const openCreate = (expId?: number) => {
    setEditId(null);
    setForm({ ...emptyForm(), priceType: voc.catalog.defaultVariantPriceType, experienceId: expId ?? 0 });
    setOpen(true);
  };

  const openEdit = (v: NonNullable<typeof allVariants>[number]) => {
    setEditId(v.id);
    setForm({
      experienceId: v.experienceId,
      name: v.name,
      description: v.description ?? "",
      priceModifier: v.priceModifier ?? "0",
      priceType: v.priceType as "fixed" | "percentage" | "per_person",
      isRequired: v.isRequired ?? false,
      sortOrder: String(v.sortOrder ?? 0),
      validUntil: (v as { validUntil?: string | null }).validUntil ?? "",
    });
    setOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error(t("productsVariants.toast.nameRequired")); return; }
    if (!form.priceModifier || isNaN(parseFloat(form.priceModifier))) { toast.error(t("productsVariants.toast.priceInvalid")); return; }
    if (!editId && !form.experienceId) { toast.error(voc.licensed ? t("productsVariants.toast.selectItemLicensed") : t("productsVariants.toast.selectItemOwn")); return; }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      priceModifier: parseFloat(form.priceModifier).toFixed(2),
      priceType: form.priceType,
      isRequired: form.isRequired,
      sortOrder: parseInt(form.sortOrder) || 0,
      validUntil: form.validUntil || null,
    };

    if (editId) {
      updateMutation.mutate({ id: editId, ...payload });
    } else {
      createMutation.mutate({ experienceId: form.experienceId, ...payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <AdminLayout title={t("productsVariants.title")}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("productsVariants.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {voc.licensed ? t("productsVariants.intro.licensedDefine") : t("productsVariants.intro.ownDefine")} {voc.licensed ? t("productsVariants.intro.licensedChoose") : t("productsVariants.intro.ownChoose")}
          </p>
        </div>
        <div className="flex gap-3">
          <Select value={selectedExp} onValueChange={setSelectedExp}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={t("productsVariants.filterBy", { item })} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{voc.licensed ? t("productsVariants.allLicensed") : t("productsVariants.allOwn")}</SelectItem>
              {experiences?.map(e => (
                <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => openCreate()} className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> {t("productsVariants.newVariant")}
          </Button>
        </div>
      </div>

      {/* Info box */}
      <div className="mb-6 p-4 bg-info/10 border border-info/30 rounded-xl flex gap-3 text-sm text-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-info" />
        <div>
          <strong>{t("productsVariants.info.how")}</strong> {voc.licensed ? t("productsVariants.info.licensedAdd") : t("productsVariants.info.ownAdd")} {t("productsVariants.info.replaces")}
          <br />
          {voc.licensed
            ? <><strong>{t("productsVariants.info.types")}</strong> <em>{t("productsVariants.info.licensedTypes.price")}</em> {t("productsVariants.info.licensedTypes.priceText")} <em>{t("productsVariants.info.licensedTypes.pct")}</em> {t("productsVariants.info.licensedTypes.pctText")}</>
            : <><strong>{t("productsVariants.info.types")}</strong> <em>{t("productsVariants.info.ownTypes.fixed")}</em> {t("productsVariants.info.ownTypes.fixedText")} <em>{t("productsVariants.info.ownTypes.perPerson")}</em> {t("productsVariants.info.ownTypes.perPersonText")} <em>{t("productsVariants.info.ownTypes.pct")}</em> {t("productsVariants.info.ownTypes.pctText")}</>}
        </div>
      </div>

      {loadingExp || loadingVariants ? (
        <div className="text-center py-12 text-muted-foreground">{t("productsVariants.loading")}</div>
      ) : !experiences?.length ? (
        <PanelEmpty
          icon={<Tag className="w-6 h-6" />}
          title={t("productsVariants.empty.title")}
          description={t("productsVariants.empty.description")}
        >
          <Button asChild>
            <Link href="/admin/productos/experiencias">
              <Plus className="w-4 h-4 mr-2" /> {t("productsVariants.empty.cta")}
            </Link>
          </Button>
        </PanelEmpty>
      ) : (
        <div className="space-y-6">
          {filtered?.map((exp) => {
            const variants = variantsByExp[exp.id] ?? [];
            return (
              <div key={exp.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Tag className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-foreground">{exp.title}</span>
                    {!voc.licensed && <Badge variant="outline" className="text-xs">{exp.difficulty ?? "facil"}</Badge>}
                    {variants.length > 0 && (
                      <Badge className="text-xs bg-success/10 text-success border-success/40">
                        {t("productsVariants.variantCount", { n: variants.length })}
                      </Badge>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openCreate(exp.id)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> {t("productsVariants.addVariant")}
                  </Button>
                </div>

                {variants.length > 0 ? (
                  <div className="divide-y divide-border">
                    {variants.map((v) => (
                      <div key={v.id} className="px-5 py-3.5 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground text-sm">{v.name}</p>
                          {v.description && (
                            <p className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{v.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {priceTypeLabels[v.priceType] ?? v.priceType}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 text-primary font-bold text-base">
                          <Euro className="w-4 h-4" />
                          <span>{amount(v.priceModifier)}</span>
                          {v.priceType === "percentage" && <span className="text-sm font-normal text-muted-foreground">%</span>}
                        </div>
                        {v.isRequired && (
                          <Badge variant="secondary" className="text-xs">{t("productsVariants.required")}</Badge>
                        )}
                        <div className="flex gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" title={t("productsVariants.actions")}>
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => openEdit(v)}>
                                <Pencil className="w-3.5 h-3.5 mr-2" /> {t("productsVariants.edit")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setServicesFor({ id: v.id, name: v.name })}>
                                <ListChecks className="w-3.5 h-3.5 mr-2" /> {t("productsVariants.includedServices")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteConfirm(v.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> {t("productsVariants.remove")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-center text-muted-foreground text-sm">
                    {t("productsVariants.basePrice")} <strong className="text-primary">{format.currency(parseFloat(exp.basePrice))}</strong>
                    {" · "}
                    <button className="text-primary underline hover:no-underline" onClick={() => openCreate(exp.id)}>
                      {t("productsVariants.addPriceVariant")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!isPending) setOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? t("productsVariants.dialog.editTitle") : t("productsVariants.dialog.newTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editId && (
              <div>
                <Label>{Item} *</Label>
                <Select
                  value={form.experienceId ? String(form.experienceId) : ""}
                  onValueChange={(v) => setForm(f => ({ ...f, experienceId: parseInt(v) }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("productsVariants.dialog.selectItem", { item })} />
                  </SelectTrigger>
                  <SelectContent>
                    {experiences?.map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>{t("productsVariants.dialog.name")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={voc.catalog.variantExample}
              />
            </div>

            <div>
              <Label>{t("productsVariants.dialog.description")}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={voc.catalog.variantDescriptionExample}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("productsVariants.dialog.priceType")}</Label>
                <Select
                  value={form.priceType}
                  onValueChange={(v) => setForm(f => ({ ...f, priceType: v as FormState["priceType"] }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">{priceTypeLabels.fixed}</SelectItem>
                    {(voc.catalog.showPerPersonVariant || form.priceType === "per_person") && <SelectItem value="per_person">{priceTypeLabels.per_person}</SelectItem>}
                    <SelectItem value="percentage">{t("productsVariants.priceType.optionPercentage")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  {form.priceType === "percentage" ? t("productsVariants.dialog.percentage") : t("productsVariants.dialog.price")}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.priceModifier}
                  onChange={(e) => setForm(f => ({ ...f, priceModifier: e.target.value }))}
                  placeholder={form.priceType === "percentage" ? "10" : "25.00"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("productsVariants.dialog.sortOrder")}</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.sortOrder}
                  onChange={(e) => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                />
              </div>
              <div className="flex flex-col justify-end pb-1">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.isRequired}
                    onCheckedChange={(v) => setForm(f => ({ ...f, isRequired: v }))}
                    id="isRequired"
                  />
                  <Label htmlFor="isRequired" className="cursor-pointer">{t("productsVariants.dialog.mandatory")}</Label>
                </div>
              </div>
              <div className="col-span-2">
                <Label htmlFor="validUntil">{t("productsVariants.dialog.validUntil")}</Label>
                <Input id="validUntil" type="date" value={form.validUntil} onChange={(e) => setForm(f => ({ ...f, validUntil: e.target.value }))} />
                <p className="text-xs text-muted-foreground mt-1">{t("productsVariants.dialog.validUntilHelp")}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              {t("productsVariants.dialog.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? t("productsVariants.dialog.saving") : editId ? t("productsVariants.dialog.saveChanges") : t("productsVariants.dialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VariantIncludedServicesDialog variant={servicesFor} onClose={() => setServicesFor(null)} />

      {/* Delete confirmation */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("productsVariants.delete.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("productsVariants.delete.text")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t("productsVariants.delete.cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm !== null && deleteMutation.mutate({ id: deleteConfirm })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t("productsVariants.delete.deleting") : t("productsVariants.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
