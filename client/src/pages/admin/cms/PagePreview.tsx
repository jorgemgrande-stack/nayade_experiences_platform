/**
 * Vista previa de una página de la web tal y como se verá al publicarla: el borrador con la cabecera, el pie y los
 * colores de la web, pintado con el mismo componente que la web pública (PageBlocksView). Se abre dentro del editor
 * (en un marco con el ancho de ordenador, tableta o móvil) o en una pestaña aparte. Solo para el equipo de la empresa.
 */
import PublicLayout from "@/components/PublicLayout";
import { PageBlocksView } from "@/components/site/PageBlocksView";
import { trpc } from "@/lib/trpc";

export default function PagePreview({ slug }: { slug: string }) {
  const q = trpc.cms.pagePreview.useQuery({ slug }, { retry: false, refetchOnWindowFocus: true });
  return (
    <PublicLayout>
      <div role="note" className="sticky top-20 z-40 px-4 py-2 text-center text-sm font-medium shadow-sm" style={{ background: "#fef3c7", color: "#78350f" }}>
        Vista previa: así se verá esta página cuando la publiques. Los enlaces y el formulario no funcionan aquí.
      </div>
      {q.isLoading ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !q.data ? (
        <p className="container py-16 text-center text-muted-foreground">No se ha encontrado la página.</p>
      ) : q.data.blocks.length === 0 ? (
        <p className="container py-16 text-center text-muted-foreground">La página está vacía. Añade algún bloque para verla aquí.</p>
      ) : (
        <PageBlocksView blocks={q.data.blocks} preview pageTitle={q.data.title} />
      )}
    </PublicLayout>
  );
}
