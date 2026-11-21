import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";

/** Ocultar la web de la empresa a los buscadores (empresa de demostración o web en preparación). */
export default function SearchIndexingToggle() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data } = trpc.config.getSearchIndexing.useQuery();
  const set = trpc.config.setSearchIndexing.useMutation({
    onSuccess: (r) => {
      utils.config.getSearchIndexing.invalidate();
      toast.success(r.off ? t("settingsGeneral.indexing.hidden") : t("settingsGeneral.indexing.visible"));
    },
    onError: (e) => toast.error(e.message),
  });
  if (!data?.available) return null;
  return (
    <div className="rounded-lg border p-4 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium font-display">{t("settingsGeneral.indexing.title")}</p>
        <p className="text-sm text-muted-foreground">
          {t("settingsGeneral.indexing.text")}
        </p>
      </div>
      <Switch
        checked={data.off}
        disabled={set.isPending}
        onCheckedChange={(off) => set.mutate({ off })}
        aria-label={t("settingsGeneral.indexing.title")}
      />
    </div>
  );
}
