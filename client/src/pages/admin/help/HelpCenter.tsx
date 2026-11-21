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
import { useI18n } from "@/i18n/I18nProvider";
import { CORE_RELEASED_AT, CORE_VERSION } from "@shared/version";

const LONG_DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

/** Versión de Elephant Core y su fecha; el commit desplegado solo llega a los administradores (lo decide el servidor). */
export function AboutCore() {
  const { t, format: f } = useI18n();
  const longDate = (d: string) => f.date(new Date(`${d}T12:00:00`), LONG_DATE);
  const info = trpc.system.version.useQuery(undefined, { staleTime: 30 * 60_000, retry: false });
  const version = info.data?.version ?? CORE_VERSION;
  const releasedAt = info.data?.releasedAt ?? CORE_RELEASED_AT;
  return (
    <section aria-labelledby="ayuda-acerca" className="rounded-xl border border-border bg-card p-5">
      <h2 id="ayuda-acerca" className="text-base font-semibold text-foreground">{t("help.about.title")}</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t("help.about.version")}</dt>
        <dd className="font-medium text-foreground">{version}</dd>
        {releasedAt ? (
          <>
            <dt className="text-muted-foreground">{t("help.about.releasedAt")}</dt>
            <dd className="text-foreground">{longDate(releasedAt)}</dd>
          </>
        ) : null}
        {info.data?.commit ? (
          <>
            <dt className="text-muted-foreground">{t("help.about.build")}</dt>
            <dd className="font-mono text-foreground">{info.data.commit}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function ContactCard({ topic }: { topic?: string }) {
  const { t } = useI18n();
  const contact = trpc.subscription.supportContact.useQuery(undefined, { staleTime: 10 * 60_000, retry: false });
  const tickets = trpc.support.available.useQuery(undefined, { staleTime: 10 * 60_000, retry: false });
  const mailto = supportMailto(contact.data?.email, topic);
  return (
    <section aria-labelledby="ayuda-contacto" className="rounded-xl border border-border bg-card p-5">
      <h2 id="ayuda-contacto" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <LifeBuoy className="w-5 h-5 text-primary" aria-hidden="true" />
        {t("help.contact.title")}
      </h2>
      {tickets.data && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-muted-foreground">{t("help.contact.ticketsText")}</p>
          <Button asChild>
            <Link href="/admin/soporte">{t("help.contact.ticketsButton")}</Link>
          </Button>
        </div>
      )}
      {mailto ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("help.contact.mailText")}
          </p>
          <Button asChild className="mt-3">
            <a href={mailto}>
              <Mail className="w-4 h-4 mr-1.5" aria-hidden="true" />
              {t("help.contact.mailButton")}
            </a>
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("help.contact.address")} <span className="font-medium text-foreground break-all">{contact.data?.email}</span>
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {contact.isLoading
            ? t("help.contact.loading")
            : t("help.contact.fallback")}
        </p>
      )}
    </section>
  );
}

function ArticleView({ article }: { article: HelpArticle }) {
  const { t } = useI18n();
  return (
    <article aria-labelledby="ayuda-articulo" className="space-y-5">
      <Link
        href="/admin/ayuda"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t("help.center.back")}
      </Link>
      <header>
        <h1 id="ayuda-articulo" className="text-2xl font-display font-bold text-foreground">{article.title}</h1>
        <p className="mt-2 text-muted-foreground">{article.summary}</p>
      </header>
      <section aria-labelledby="ayuda-pasos" className="rounded-xl border border-border bg-card p-5">
        <h2 id="ayuda-pasos" className="text-base font-semibold text-foreground">{t("help.center.steps")}</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-foreground marker:text-muted-foreground">
          {article.steps.map((s, i) => (
            <li key={i} className="pl-1 leading-relaxed">{s}</li>
          ))}
        </ol>
      </section>
      {article.notes?.length ? (
        <section aria-labelledby="ayuda-notas" className="rounded-xl border border-border bg-muted/40 p-5">
          <h2 id="ayuda-notas" className="text-base font-semibold text-foreground">{t("help.center.notes")}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-foreground">
            {article.notes.map((n, i) => (
              <li key={i} className="leading-relaxed">{n}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {article.links.length > 0 && (
        <nav aria-label={t("help.center.goToScreen")} className="flex flex-wrap gap-2">
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
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const searchId = useId();
  const results = useMemo(() => searchHelp(q, locale), [q, locale]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-display font-bold text-foreground">{t("help.center.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("help.center.subtitle")}</p>
      </header>
      <div className="max-w-md">
        <Label htmlFor={searchId} className="mb-1.5 block text-sm">{t("help.center.searchLabel")}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("help.center.searchPlaceholder")}
            className="pl-9"
            aria-describedby={`${searchId}-res`}
          />
        </div>
        <p id={`${searchId}-res`} role="status" aria-live="polite" className="mt-1.5 text-xs text-muted-foreground">
          {results.length === HELP_ARTICLES.length ? t("help.center.guides", { n: results.length }) : t("help.center.results", { n: results.length })}
        </p>
      </div>
      {results.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("help.center.noMatch")}</p>
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
  const { t, locale, format: f } = useI18n();
  const [, params] = useRoute("/admin/ayuda/:id");
  const article = getHelpArticle(params?.id, locale);
  const reviewed = f.date(new Date(`${HELP_REVIEWED_AT}T12:00:00`), LONG_DATE);
  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        {params?.id && !article ? (
          <div className="space-y-3">
            <h1 className="text-2xl font-display font-bold text-foreground">{t("help.center.notFoundTitle")}</h1>
            <p className="text-muted-foreground">{t("help.center.notFoundText")}</p>
            <Button asChild variant="outline">
              <Link href="/admin/ayuda">{t("help.center.seeAll")}</Link>
            </Button>
          </div>
        ) : article ? (
          <ArticleView article={article} />
        ) : (
          <ArticleList />
        )}
        {!params?.id && <AboutCore />}
        <p className="text-xs text-muted-foreground">{t("help.center.reviewed", { date: reviewed })}</p>
      </div>
    </AdminLayout>
  );
}
