/**
 * /comunidad — comunidades de la persona y las abiertas o con solicitud a las que puede unirse.
 */
import { Link } from "wouter";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/errorMessage";
import { MEMBER_ROLE_LABELS, VISIBILITY_SHORT } from "@shared/communities";
import CommunityLayout, { CommunityNotice, isUnlicensed } from "./CommunityLayout";

function Cover({ url, color }: { url: string | null; color: string | null }) {
  return <div className="h-20 bg-slate-200" style={url ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" } : color ? { background: color } : undefined} aria-hidden="true" />;
}

export default function MyCommunities() {
  const utils = trpc.useUtils();
  const q = trpc.communities.member.mine.useQuery(undefined, { retry: false });
  const join = trpc.communities.member.join.useMutation({
    onSuccess: (r) => {
      toast.success(r.status === "active" ? "Te has unido a la comunidad" : "Solicitud enviada: te avisaremos cuando la aprueben");
      utils.communities.member.mine.invalidate();
    },
    onError: (e) => toastError(e),
  });

  return (
    <CommunityLayout>
      {q.isLoading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : q.isError ? (
        isUnlicensed(q.error) ? (
          <CommunityNotice title="Comunidades no disponibles" text="Esta empresa no tiene activadas las comunidades." />
        ) : (
          <CommunityNotice title="No se han podido cargar las comunidades" text={q.error.message} action={<Button variant="outline" onClick={() => q.refetch()}>Reintentar</Button>} />
        )
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="mine-title" className="space-y-3">
            <h1 id="mine-title" className="text-2xl font-bold text-slate-900">Mis comunidades</h1>
            {q.data!.mine.length === 0 ? (
              <p className="text-sm text-slate-600">Todavía no perteneces a ninguna comunidad.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {q.data!.mine.map((x) => (
                  <li key={x.community.id}>
                    <Link href={`/comunidad/${x.community.slug}`} className="block overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-[var(--portal-accent)]">
                      <Cover url={x.community.coverImageUrl} color={x.community.accentColor} />
                      <div className="p-4">
                        <h2 className="font-semibold text-slate-900">{x.community.name}</h2>
                        <p className="text-sm text-slate-600">
                          <Users className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{x.activeMembers} {x.activeMembers === 1 ? "miembro" : "miembros"}
                          {x.status === "pending" ? " · Solicitud pendiente" : x.role && x.role !== "member" ? ` · ${MEMBER_ROLE_LABELS[x.role]}` : ""}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {q.data!.available.length > 0 && (
            <section aria-labelledby="avail-title" className="space-y-3">
              <h2 id="avail-title" className="text-lg font-semibold text-slate-900">Otras comunidades</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {q.data!.available.map((x) => (
                  <li key={x.community.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <Cover url={x.community.coverImageUrl} color={x.community.accentColor} />
                    <div className="space-y-2 p-4">
                      <h3 className="font-semibold text-slate-900">{x.community.name}</h3>
                      {x.community.description && <p className="line-clamp-3 text-sm text-slate-600">{x.community.description}</p>}
                      <p className="text-xs text-slate-500">{VISIBILITY_SHORT[x.community.visibility]} · {x.activeMembers} {x.activeMembers === 1 ? "miembro" : "miembros"}</p>
                      <Button size="sm" disabled={join.isPending} onClick={() => join.mutate({ communityId: x.community.id })}>
                        {x.community.visibility === "open" ? "Unirme" : "Solicitar unirme"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </CommunityLayout>
  );
}
