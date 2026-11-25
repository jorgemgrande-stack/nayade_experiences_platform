/**
 * Aula privada del alumno (Elephant LMS): /mi-formacion. Cuenta individual del Core (rol de cliente), nunca un enlace
 * público. Mis cursos → índice del curso (módulos y lecciones, con lo no contratado bloqueado) → lección (texto, vídeo,
 * audio, PDF y enlaces) con progreso. Los recursos se piden a /api/learning/resource/<id>, que comprueba la matrícula en
 * cada apertura: aquí no hay ninguna URL permanente de contenido.
 * Responsive, en alemán y español (selector ?lang= o idioma de la web), con la identidad de la empresa.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { CheckCircle2, ChevronLeft, ExternalLink, FileText, Loader2, Lock, PlayCircle, Languages } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSiteLocale } from "@/hooks/useSiteLocale";
import { usePortalLook } from "../employee/usePortalLook";
import { aulaText, contentNotice, fillAula, formatAccessDate, formatAulaPrice, resolveAulaLocale, withLang, type AulaLocale, type AulaText } from "@shared/learningText";
import { moduleAccessNotice } from "@shared/learning";

const BASE = "/mi-formacion";
/** Vista previa de administración: mismas pantallas, sin matrícula ni progreso (ruta propia, solo administradores). */
const PREVIEW_BASE = "/admin/formacion/vista-previa";

const LANG_KEY = "aula-lang";
const readStored = () => { try { return window.sessionStorage.getItem(LANG_KEY); } catch { return null; } };

/**
 * Idioma de la INTERFAZ del aula. Se lee de la URL con `useSearch` (así el cambio de idioma vuelve a pintar la página aunque la ruta
 * no cambie), se recuerda en la sesión y se arrastra en todos los enlaces internos (`href`): cambiar de idioma no hace perder la
 * lección ni el curso. El idioma del CONTENIDO es el del curso y no se traduce (ver `contentNotice`).
 */
function useAulaLocale(): { locale: AulaLocale; t: AulaText; setLang: (l: AulaLocale) => void; href: (path: string) => string } {
  const site = useSiteLocale();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { locale, explicit } = resolveAulaLocale({ fromUrl: new URLSearchParams(search).get("lang"), stored: typeof window === "undefined" ? null : readStored(), site: site.locale });
  return {
    locale,
    t: aulaText(locale),
    href: (path) => withLang(path, explicit),
    setLang: (l) => {
      try { window.sessionStorage.setItem(LANG_KEY, l); } catch { /* sin almacenamiento: queda en la URL */ }
      navigate(withLang(location + (search ? `?${search}` : ""), l), { replace: true });
    },
  };
}

/** Aviso cuando el curso está en otro idioma que la interfaz: se muestra el contenido original, sin traducciones inventadas. */
function ContentNotice({ courseLanguage, locale }: { courseLanguage: string | null | undefined; locale: AulaLocale }) {
  const text = contentNotice(courseLanguage, locale);
  if (!text) return null;
  return (
    <div role="note" data-testid="content-language-notice" className="mb-4 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
      <Languages className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>{text}</p>
    </div>
  );
}

function Shell({ children, wide, preview }: { children: React.ReactNode; wide?: boolean; preview?: boolean }) {
  const look = usePortalLook();
  const { locale, setLang, t, href } = useAulaLocale();
  return (
    <div className="min-h-screen bg-stone-50 text-slate-800" style={look.style}>
      {preview && (
        <div role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950">
          <span>{t.previewBanner}</span><span className="font-normal">{t.previewNote}</span>
          <Link href="/admin/formacion" className="underline">{t.backToAdmin}</Link>
        </div>
      )}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href={href(preview ? PREVIEW_BASE : BASE)} className="flex items-center gap-3">
            {look.logoUrl ? <img src={look.logoUrl} alt={look.name || ""} className="h-9 w-auto max-w-[160px] object-contain" /> : <span className="font-semibold">{look.name}</span>}
          </Link>
          <nav aria-label="Idioma / Sprache" className="flex gap-1 text-sm">
            {(["de", "es"] as const).map((l) => (
              <button key={l} type="button" lang={l} onClick={() => setLang(l)} aria-current={locale === l ? "true" : undefined} className={`rounded-md px-2 py-1 ${locale === l ? "font-semibold underline underline-offset-4" : "text-slate-600 hover:text-slate-900"}`}>
                {l === "de" ? "Deutsch" : "Español"}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</main>
    </div>
  );
}

function isUnauthorized(e: unknown) {
  return (e as { data?: { code?: string } } | null)?.data?.code === "UNAUTHORIZED";
}
function isUnavailable(e: unknown) {
  return (e as { data?: { code?: string } } | null)?.data?.code === "PRECONDITION_FAILED";
}

function Notice({ t, error, onRetry }: { t: AulaText; error: unknown; onRetry: () => void }) {
  if (isUnauthorized(error)) {
    return (
      <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-6 text-center">
        <p>{t.signIn}</p>
        <Button asChild><a href={`/login?returnTo=${encodeURIComponent(window.location.pathname)}`}>{t.signInCta}</a></Button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-6 text-center">
      <p>{isUnavailable(error) ? t.unavailable : (error as Error)?.message}</p>
      {!isUnavailable(error) && <Button variant="outline" onClick={onRetry}>{t.retry}</Button>}
    </div>
  );
}

/** Activación voluntaria: el derecho está concedido y los días empiezan solo cuando el alumno lo confirma aquí (dos pasos, sin fecha automática). */
function ActivateAccess({ pending, t, onDone }: { pending: { enrollmentId: number; days: number }; t: AulaText; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activate = trpc.learning.my.activate.useMutation({ onSuccess: onDone, onError: () => { setError(t.accFail); setConfirming(false); } });
  return (
    <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="activar-acceso">
      <p>{fillAula(t.accPendingNote, { n: String(pending.days) })}</p>
      {!confirming ? (
        <Button size="sm" onClick={() => { setError(null); setConfirming(true); }}>{t.accActivate}</Button>
      ) : (
        <div className="space-y-2" role="alertdialog" aria-label={t.accActivate}>
          <p className="font-medium">{fillAula(t.accConfirm, { n: String(pending.days) })}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={activate.isPending} onClick={() => activate.mutate({ enrollmentId: pending.enrollmentId })}>{activate.isPending ? t.loading : t.accConfirmYes}</Button>
            <Button size="sm" variant="outline" disabled={activate.isPending} onClick={() => setConfirming(false)}>{t.accCancel}</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  );
}

// ── Mis cursos ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function AulaHome() {
  const { t, locale, href } = useAulaLocale();
  const q = trpc.learning.my.courses.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  return (
    <Shell>
      <h1 className="mb-4 text-2xl font-bold">{t.title}</h1>
      {q.isLoading ? <p className="text-sm text-slate-500">{t.loading}</p> : q.isError ? <Notice t={t} error={q.error} onRetry={() => q.refetch()} /> : q.data!.length === 0 ? <p className="text-slate-600">{t.empty}</p> : (
        <ul className="space-y-4">
          {q.data!.map((c) => {
            const open = c.status === "active";
            return (
              <li key={c.courseId} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold">{c.title}</h2>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${open ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}`}>{t.status[c.status] ?? c.status}</span>
                </div>
                {c.pendingActivation && <ActivateAccess pending={c.pendingActivation} t={t} onDone={() => { void utils.learning.my.invalidate(); }} />}
                <p className="mt-1 text-sm text-slate-600" hidden={!!c.pendingActivation}>
                  {c.status === "scheduled" ? `${t.from} ${formatAccessDate(c.startsAt, locale)}` : c.endsAt ? `${t.until} ${formatAccessDate(c.endsAt, locale)}` : t.noEnd}
                </p>
                <div className="mt-3" aria-label={t.progress}>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200"><div className="h-full bg-[var(--portal-accent,#92400e)]" style={{ width: `${c.percent}%` }} /></div>
                  <p className="mt-1 text-xs text-slate-500">{t.progress}: {c.completedLessons}/{c.totalLessons} {t.lessons} · {c.percent}%</p>
                </div>
                {c.status === "expired" && <p className="mt-3 text-sm text-slate-600">{t.expiredNote}</p>}
                {(c.status === "suspended" || c.status === "revoked") && <p className="mt-3 text-sm text-slate-600">{t.inactiveNote}</p>}
                <div className="mt-3 flex gap-2">
                  <Button asChild disabled={!open}>
                    <Link href={href(c.lastLessonId ? `${BASE}/curso/${c.courseId}/leccion/${c.lastLessonId}` : `${BASE}/curso/${c.courseId}`)}>{c.lastLessonId ? t.cont : t.start}</Link>
                  </Button>
                  
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}

// ── Aviso de acceso por módulo y ampliación ─────────────────────────────────────────────────────────────────────────

type ModuleInfo = { id: number; state?: "open" | "locked" | "closed" | "not_included" | "pending_activation"; unlocksAt?: number | null; endsAt?: number | null; canExtend?: boolean };
type RedsysForm = { url: string; Ds_SignatureVersion: string; Ds_MerchantParameters: string; Ds_Signature: string };

/** Envía el formulario firmado de Redsys (mismo mecanismo que el pago del carrito). */
function submitRedsys(f: RedsysForm) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = f.url;
  form.style.display = "none";
  for (const [k, v] of Object.entries({ Ds_SignatureVersion: f.Ds_SignatureVersion, Ds_MerchantParameters: f.Ds_MerchantParameters, Ds_Signature: f.Ds_Signature })) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** «Se desbloquea el …», «Acceso hasta …», «Acceso finalizado el …» (fechas en horario de Madrid) y el aviso suave de los últimos 7 días. */
function ModuleNotice({ m, courseId, offers, t, locale, preview }: { m: ModuleInfo; courseId: number; offers: Array<{ days: number; priceCents: number }>; t: AulaText; locale: AulaLocale; preview: boolean }) {
  const notice = moduleAccessNotice({ state: m.state === "pending_activation" ? "locked" : (m.state ?? "not_included"), unlocksAt: m.unlocksAt ?? null, endsAt: m.endsAt ?? null }, Date.now());
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = trpc.learning.my.startExtension.useMutation({
    onSuccess: (r) => {
      if (r.stripeUrl) window.location.href = r.stripeUrl;
      else if (r.redsysForm) submitRedsys(r.redsysForm as RedsysForm);
    },
    onError: () => setError(t.extendFail),
  });
  const canExtend = !preview && !!m.canExtend && offers.length > 0;
  if (notice.kind === "none" && !canExtend) return null;
  return (
    <div className="space-y-2 border-b border-stone-100 px-4 py-2 text-sm" data-testid={`module-access-${m.id}`}>
      {notice.kind === "locked" && <p className="flex items-center gap-1 text-slate-600"><Lock className="h-3.5 w-3.5" aria-hidden />{fillAula(t.unlocksOn, { date: formatAccessDate(notice.date, locale) })}</p>}
      {notice.kind === "until" && <p className="text-slate-600">{fillAula(t.accessUntilOn, { date: formatAccessDate(notice.date, locale) })}</p>}
      {notice.kind === "until" && notice.soon && (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">{notice.daysLeft === 1 ? t.endsSoonOne : fillAula(t.endsSoon, { n: notice.daysLeft })}</p>
      )}
      {notice.kind === "closed" && <p className="text-slate-600">{notice.date != null ? fillAula(t.accessEndedOn, { date: formatAccessDate(notice.date, locale) }) : t.accessEnded}</p>}
      {canExtend && !open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t.extendModule}</Button>}
      {canExtend && open && (
        <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="font-medium">{t.extendTitle}</p>
          <div className="flex flex-wrap gap-2">
            {offers.map((o) => (
              <Button key={o.days} size="sm" disabled={start.isPending} onClick={() => { setError(null); start.mutate({ courseId, moduleId: m.id, days: o.days as 30 | 60 }); }}>
                {start.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}{o.days === 30 ? t.extend30 : t.extend60} · {formatAulaPrice(o.priceCents, locale)}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t.extendClose}</Button>
          </div>
          <p className="text-xs text-slate-500">{t.extendNote}</p>
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ── Índice del curso ────────────────────────────────────────────────────────────────────────────────────────────────

export function AulaCurso({ preview = false }: { preview?: boolean }) {
  const { t, locale, href } = useAulaLocale();
  const base = preview ? PREVIEW_BASE : BASE;
  const [, params] = useRoute(`${base}/curso/:courseId`);
  const courseId = Number(params?.courseId);
  const valid = Number.isInteger(courseId) && courseId > 0;
  const mine = trpc.learning.my.course.useQuery({ courseId }, { enabled: valid && !preview, retry: false });
  const prev = trpc.learning.admin.previewCourse.useQuery({ courseId }, { enabled: valid && preview, retry: false });
  const q = (preview ? prev : mine) as typeof mine;
  const utils = trpc.useUtils();
  return (
    <Shell preview={preview}>
      <Link href={href(preview ? "/admin/formacion" : BASE)} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600"><ChevronLeft className="h-4 w-4" aria-hidden />{t.allCourses}</Link>
      {q.isLoading ? <p className="text-sm text-slate-500">{t.loading}</p> : q.isError ? <Notice t={t} error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <h1 className="mb-1 text-2xl font-bold">{q.data!.course.title}</h1>
          <p className="mb-3 text-sm text-slate-500">{t.resumeNote}</p>
          <ContentNotice courseLanguage={q.data!.course.language} locale={locale} />
          {!preview && (q.data as { pendingActivation?: { enrollmentId: number; days: number } | null }).pendingActivation && (
            <div className="mb-4"><ActivateAccess pending={(q.data as { pendingActivation: { enrollmentId: number; days: number } }).pendingActivation} t={t} onDone={() => { void utils.learning.my.invalidate(); }} /></div>
          )}
          <div className="space-y-5">
            {q.data!.modules.map((m) => (
              <section key={m.id} aria-labelledby={`m${m.id}`} className="rounded-xl border border-stone-200 bg-white">
                <h2 id={`m${m.id}`} className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 font-semibold">
                  <span>{m.title}</span>
                  {!m.unlocked && (!(m as ModuleInfo).state || (m as ModuleInfo).state === "not_included") && <span className="flex items-center gap-1 text-xs font-normal text-slate-500"><Lock className="h-3.5 w-3.5" aria-hidden />{t.locked}</span>}
                </h2>
                <ModuleNotice m={m as ModuleInfo} courseId={courseId} offers={(q.data as { extensionOffers?: Array<{ days: number; priceCents: number }> }).extensionOffers ?? []} t={t} locale={locale} preview={preview} />
                <ol className="divide-y divide-stone-100">
                  {m.lessons.map((l) => (
                    <li key={l.id}>
                      {m.unlocked ? (
                        <Link href={href(`${base}/curso/${courseId}/leccion/${l.id}`)} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                          {l.completed ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label={t.done} /> : <PlayCircle className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />}
                          <span>{l.title}</span>
                        </Link>
                      ) : (
                        <span className="flex items-center gap-3 px-4 py-3 text-slate-400"><Lock className="h-5 w-5 shrink-0" aria-hidden />{l.title}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}

// ── Lección ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type Block = { id: number; kind: string; title: string; body: string | null; externalUrl: string | null; activity: string | null; resourceId: number | null; resource: { status: string; kind: string } | null };

function Media({ b, t, onPlayed, preview }: { b: Block; t: AulaText; onPlayed: () => void; preview?: boolean }) {
  const ready = b.resource?.status === "verified";
  const url = b.resourceId ? `/api/learning/${preview ? "preview/" : ""}resource/${b.resourceId}` : null;
  const label = b.activity === "ejercicio" ? t.exercise : b.activity?.startsWith("meditaci") ? t.meditation : null;
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="mb-2 flex flex-wrap items-center gap-2 font-medium">
        {b.title}
        {label && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-900">{label}</span>}
      </h3>
      {b.kind === "text" ? (
        b.body ? <p className="whitespace-pre-line text-slate-700">{b.body}</p> : null
      ) : b.kind === "external_link" ? (
        b.externalUrl ? <a href={b.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--portal-accent,#92400e)] underline"><ExternalLink className="h-4 w-4" aria-hidden />{b.body || t.external}</a> : null
      ) : !ready || !url ? (
        <p className="text-sm text-slate-500">{t.pending}</p>
      ) : b.kind === "video" ? (
        <video controls controlsList="nodownload" playsInline preload="metadata" className="w-full rounded-lg bg-black" src={url} onEnded={onPlayed} />
      ) : b.kind === "audio" ? (
        <audio controls controlsList="nodownload" preload="metadata" className="w-full" src={url} onEnded={onPlayed} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href={url} target="_blank" rel="noopener noreferrer"><FileText className="mr-1 h-4 w-4" aria-hidden />{t.open}</a></Button>
          <Button asChild variant="outline"><a href={`${url}?download=1`}>{t.download}</a></Button>
        </div>
      )}
    </article>
  );
}

export function AulaLeccion({ preview = false }: { preview?: boolean }) {
  const { t, locale, href } = useAulaLocale();
  const base = preview ? PREVIEW_BASE : BASE;
  const [, params] = useRoute(`${base}/curso/:courseId/leccion/:lessonId`);
  const courseId = Number(params?.courseId);
  const lessonId = Number(params?.lessonId);
  const utils = trpc.useUtils();
  const lessonOk = Number.isInteger(lessonId) && lessonId > 0;
  const courseOk = Number.isInteger(courseId) && courseId > 0;
  const lessonMine = trpc.learning.my.lesson.useQuery({ lessonId }, { enabled: lessonOk && !preview, retry: false });
  const lessonPrev = trpc.learning.admin.previewLesson.useQuery({ lessonId }, { enabled: lessonOk && preview, retry: false });
  const lesson = (preview ? lessonPrev : lessonMine) as typeof lessonMine;
  const outlineMine = trpc.learning.my.course.useQuery({ courseId }, { enabled: courseOk && !preview, retry: false });
  const outlinePrev = trpc.learning.admin.previewCourse.useQuery({ courseId }, { enabled: courseOk && preview, retry: false });
  const outline = (preview ? outlinePrev : outlineMine) as typeof outlineMine;
  const progress = trpc.learning.my.progress.useMutation({ onSuccess: () => { utils.learning.my.course.invalidate(); utils.learning.my.courses.invalidate(); } });
  const [done, setDone] = useState(false);
  const flat = useMemo(() => (outline.data?.modules ?? []).filter((m) => m.unlocked).flatMap((m) => m.lessons), [outline.data]);
  const idx = flat.findIndex((l) => l.id === lessonId);
  const next = idx >= 0 ? flat[idx + 1] : undefined;
  const wasDone = idx >= 0 ? flat[idx].completed : false;
  useEffect(() => {
    setDone(false);
    // Abrir la lección solo registra por dónde vas (reanudar); nunca la da por completada. La vista previa NO guarda progreso.
    if (!preview && lesson.data) progress.mutate({ lessonId, lastBlockId: lesson.data.blocks[0]?.id ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, !!lesson.data]);
  return (
    <Shell preview={preview}>
      <Link href={href(`${base}/curso/${courseId}`)} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600"><ChevronLeft className="h-4 w-4" aria-hidden />{t.back}</Link>
      {lesson.isLoading ? <p className="text-sm text-slate-500">{t.loading}</p> : lesson.isError ? <Notice t={t} error={lesson.error} onRetry={() => lesson.refetch()} /> : (
        <>
          <h1 className="mb-3 text-2xl font-bold">{lesson.data!.lesson.title}</h1>
          <ContentNotice courseLanguage={outline.data?.course.language} locale={locale} />
          <div className="space-y-4">
            {lesson.data!.blocks.map((b) => (
              <Media key={b.id} b={b as Block} t={t} onPlayed={() => undefined} preview={preview} />
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {preview ? null : wasDone || done ? (
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden />{t.done}</span>
            ) : (
              <Button disabled={progress.isPending} onClick={() => progress.mutate({ lessonId, completed: true }, { onSuccess: () => setDone(true) })}>
                {progress.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}{t.markDone}
              </Button>
            )}
            {next && <Button asChild variant="outline"><Link href={href(`${base}/curso/${courseId}/leccion/${next.id}`)}>{next.title}</Link></Button>}
          </div>
        </>
      )}
    </Shell>
  );
}

export const AulaCursoVistaPrevia = () => <AulaCurso preview />;
export const AulaLeccionVistaPrevia = () => <AulaLeccion preview />;

// ── Activación de la cuenta ─────────────────────────────────────────────────────────────────────────────────────────

export function AulaActivar() {
  const { t } = useAulaLocale();
  const look = usePortalLook();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [token, setToken] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setPassword = trpc.public.setPassword.useMutation();
  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token")), []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) return setError(t.badLink);
    if (pw.length < 8) return setError(t.pwShort);
    if (pw !== pw2) return setError(t.pwDiff);
    setBusy(true);
    try {
      const r = await setPassword.mutateAsync({ token, password: pw });
      let signedIn = false;
      if (r.email) {
        const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: r.email, password: pw }) }).catch(() => null);
        signedIn = !!res?.ok;
      }
      await utils.auth.me.invalidate();
      navigate(signedIn ? BASE : `/login?returnTo=${encodeURIComponent(BASE)}`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.activateFail);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell>
      <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm" style={look.style}>
        <h1 className="text-xl font-semibold">{t.activateTitle}</h1>
        <p className="mb-4 text-sm text-slate-600">{t.activateText}</p>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">{t.pw}<Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <label className="block text-sm">{t.pw2}<Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}{t.activate}</Button>
        </form>
      </div>
    </Shell>
  );
}
