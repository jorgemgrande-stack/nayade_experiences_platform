/**
 * Centro de ayuda del panel (/admin/ayuda y /admin/ayuda/:id).
 *
 * El contenido vive en shared/helpCenter.ts (versionado y revisable). El canal de contacto es un
 * enlace de correo configurable (subscription.supportContact); si no hay ninguno configurado, no
 * se inventa una dirección. No se prometen horarios ni tiempos de respuesta.
 */
import { useId, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ChevronRight, LifeBuoy, Mail, Search } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { HELP_ARTICLES, HELP_REVIEWED_AT, getHelpArticle, searchHelp, supportMailto, type HelpArticle } from "@shared/helpCenter";

const reviewed = new Date(`${HELP_REVIEWED_AT}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

function ContactCard({ topic }: { topic?: string }) {
  const contact = trpc.subscription.supportContact.useQuery(undefined, { staleTime: 10 * 60_000, retry: false });
  const tickets = trpc.support.available.useQuery(undefined, { staleTime: 10 * 60_000, retry: false });
  const mailto = supportMailto(contact.data?.email, topic);
  return (
    <section aria-labelledby="ayuda-contacto" className="rounded-xl border border-border bg-card p-5">
      <h2 id="ayuda-contacto" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <LifeBuoy className="w-5 h-5 text-primary" aria-hidden="true" />
        ¿No encuentras lo que buscas?
      </h2>
      {tickets.data && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-muted-foreground">Abre una incidencia y sigue las respuestas del equipo desde el panel; también te avisamos por correo.</p>
          <Button asChild>
            <Link href="/admin/soporte">Abrir o ver mis incidencias</Link>
          </Button>
        </div>
      )}
      {mailto ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Escríbenos contando qué intentabas hacer y en qué pantalla estabas. No incluyas contraseñas ni datos de tarjetas.
          </p>
          <Button asChild className="mt-3">
            <a href={mailto}>
              <Mail className="w-4 h-4 mr-1.5" aria-hidden="true" />
              Escribir a soporte
            </a>
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Dirección de soporte: <span className="font-medium text-foreground break-all">{contact.data?.email}</span>
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {contact.isLoading
            ? "Cargando el canal de contacto…"
            : "Si necesitas ayuda con algo que no aparece aquí, contacta con tu interlocutor de Elephant Source."}
        </p>
      )}
    </section>
  );
}

function ArticleView({ article }: { article: HelpArticle }) {
  return (
    <article aria-labelledby="ayuda-articulo" className="space-y-5">
      <Link
        href="/admin/ayuda"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Volver al centro de ayuda
      </Link>
      <header>
        <h1 id="ayuda-articulo" className="text-2xl font-display font-bold text-foreground">{article.title}</h1>
        <p className="mt-2 text-muted-foreground">{article.summary}</p>
      </header>
      <section aria-labelledby="ayuda-pasos" className="rounded-xl border border-border bg-card p-5">
        <h2 id="ayuda-pasos" className="text-base font-semibold text-foreground">Pasos</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-foreground marker:text-muted-foreground">
          {article.steps.map((s, i) => (
            <li key={i} className="pl-1 leading-relaxed">{s}</li>
          ))}
        </ol>
      </section>
      {article.notes?.length ? (
        <section aria-labelledby="ayuda-notas" className="rounded-xl border border-border bg-muted/40 p-5">
          <h2 id="ayuda-notas" className="text-base font-semibold text-foreground">A tener en cuenta</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-foreground">
            {article.notes.map((n, i) => (
              <li key={i} className="leading-relaxed">{n}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {article.links.length > 0 && (
        <nav aria-label="Ir a la pantalla" className="flex flex-wrap gap-2">
          {article.links.map((l) => (
            <Button key={l.href} asChild variant="outline" size="sm">
              <Link href={l.href}>
                {l.label}
                <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
              </Link>
            </Button>
          ))}
        </nav>
      )}
      <ContactCard topic={article.title} />
    </article>
  );
}

function ArticleList() {
  const [q, setQ] = useState("");
  const searchId = useId();
  const results = useMemo(() => searchHelp(q), [q]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-display font-bold text-foreground">Centro de ayuda</h1>
        <p className="mt-1 text-muted-foreground">Guías breves para las tareas habituales del panel.</p>
      </header>
      <div className="max-w-md">
        <Label htmlFor={searchId} className="mb-1.5 block text-sm">Buscar en la ayuda</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Por ejemplo: factura, usuarios, contraseña"
            className="pl-9"
            aria-describedby={`${searchId}-res`}
          />
        </div>
        <p id={`${searchId}-res`} role="status" aria-live="polite" className="mt-1.5 text-xs text-muted-foreground">
          {results.length === HELP_ARTICLES.length ? `${results.length} guías` : `${results.length} ${results.length === 1 ? "resultado" : "resultados"}`}
        </p>
      </div>
      {results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay guías que coincidan con la búsqueda. Prueba con otra palabra.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {results.map((a) => (
            <li key={a.id}>
              <Link
                href={`/admin/ayuda/${a.id}`}
                className="group block h-full rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-foreground">{a.title}</span>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{a.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ContactCard />
    </div>
  );
}

export default function HelpCenter() {
  const [, params] = useRoute("/admin/ayuda/:id");
  const article = getHelpArticle(params?.id);
  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        {params?.id && !article ? (
          <div className="space-y-3">
            <h1 className="text-2xl font-display font-bold text-foreground">Guía no encontrada</h1>
            <p className="text-muted-foreground">Esta guía no existe o ha cambiado de nombre.</p>
            <Button asChild variant="outline">
              <Link href="/admin/ayuda">Ver todas las guías</Link>
            </Button>
          </div>
        ) : article ? (
          <ArticleView article={article} />
        ) : (
          <ArticleList />
        )}
        <p className="text-xs text-muted-foreground">Contenido revisado el {reviewed}.</p>
      </div>
    </AdminLayout>
  );
}
