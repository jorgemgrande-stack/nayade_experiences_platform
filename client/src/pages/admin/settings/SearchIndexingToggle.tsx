import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/** Ocultar la web de la empresa a los buscadores (empresa de demostración o web en preparación). */
export default function SearchIndexingToggle() {
  const utils = trpc.useUtils();
  const { data } = trpc.config.getSearchIndexing.useQuery();
  const set = trpc.config.setSearchIndexing.useMutation({
    onSuccess: (r) => {
      utils.config.getSearchIndexing.invalidate();
      toast.success(r.off ? "La web queda oculta a los buscadores" : "La web vuelve a ser visible en los buscadores");
    },
    onError: (e) => toast.error(e.message),
  });
  if (!data?.available) return null;
  return (
    <div className="rounded-lg border p-4 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium font-display">Ocultar la web en los buscadores</p>
        <p className="text-sm text-muted-foreground">
          Para una web de demostración o aún en preparación: Google y el resto de buscadores no la indexan ni la muestran en sus resultados. La web sigue abierta para quien tenga el enlace.
        </p>
      </div>
      <Switch
        checked={data.off}
        disabled={set.isPending}
        onCheckedChange={(off) => set.mutate({ off })}
        aria-label="Ocultar la web en los buscadores"
      />
    </div>
  );
}
