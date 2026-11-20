/**
 * Textos del aula del alumno (Elephant LMS) en alemán y español. Puro: sin React ni servidor.
 * El idioma lo decide la web (selector DE/ES); sin traducción, español.
 */
export type AulaLocale = "de" | "es";
export const pickLocale = (l: string | null | undefined): AulaLocale => (String(l ?? "").toLowerCase().startsWith("de") ? "de" : "es");

const T = {
  de: {
    title: "Meine Kurse", empty: "Du hast noch keinen Kurs.", loading: "Wird geladen…", retry: "Erneut versuchen",
    signIn: "Bitte melde dich an, um deine Kurse zu sehen.", signInCta: "Anmelden",
    unavailable: "Die digitalen Kurse sind in diesem Unternehmen noch nicht aktiviert.",
    until: "Zugang bis", from: "Zugang ab", noEnd: "ohne Ablauf", progress: "Fortschritt", lessons: "Lektionen",
    cont: "Weiter", start: "Kurs öffnen", back: "Zurück zum Kurs", allCourses: "Alle Kurse",
    status: { active: "Aktiv", scheduled: "Beginnt bald", expired: "Abgelaufen", suspended: "Pausiert", revoked: "Beendet" } as Record<string, string>,
    expiredNote: "Dein Zugang ist abgelaufen. Dein Fortschritt bleibt gespeichert. Schreib uns, wenn du verlängern möchtest.",
    inactiveNote: "Dieser Kurs ist im Moment nicht zugänglich. Schreib uns, wenn du Fragen hast.",
    locked: "Nicht in deinem Paket enthalten", module: "Modul", markDone: "Lektion abschließen", done: "Abgeschlossen",
    pending: "Dieses Material wird bald bereitgestellt.", download: "Herunterladen", open: "Öffnen", external: "Externer Link (öffnet in neuem Tab)",
    exercise: "Übung", meditation: "Meditation", noAccess: "Für diese Lektion hast du keinen Zugang.",
    resumeNote: "Du kannst jederzeit dort weitermachen, wo du aufgehört hast.",
    activateTitle: "Konto aktivieren", activateText: "Lege dein Passwort fest, um deinen Kurs zu öffnen.", pw: "Passwort", pw2: "Passwort wiederholen", activate: "Aktivieren",
    pwShort: "Das Passwort muss mindestens 8 Zeichen haben.", pwDiff: "Die Passwörter stimmen nicht überein.", badLink: "Der Link ist ungültig. Verwende den Link aus der Einladungs-E-Mail.",
    activateFail: "Das Passwort konnte nicht festgelegt werden. Der Link ist möglicherweise abgelaufen.",
    previewBanner: "Vorschau als Teilnehmer", previewNote: "Nur für die Verwaltung: ohne Anmeldung, ohne Fortschritt, jeder Zugriff wird protokolliert.", backToAdmin: "Zurück zur Verwaltung",
    contentOnly: {
      de: "Dieser Kurs ist nur auf Deutsch verfügbar.",
      es: "Dieser Kurs ist nur auf Spanisch verfügbar. Titel, Texte, Videos, Audios und Dokumente werden in der Originalsprache angezeigt; die Oberfläche ist auf Deutsch.",
    },
  },
  es: {
    title: "Mis cursos", empty: "Todavía no tienes ningún curso.", loading: "Cargando…", retry: "Reintentar",
    signIn: "Inicia sesión para ver tus cursos.", signInCta: "Iniciar sesión",
    unavailable: "La formación digital todavía no está activada en esta empresa.",
    until: "Acceso hasta", from: "Acceso desde", noEnd: "sin caducidad", progress: "Progreso", lessons: "lecciones",
    cont: "Continuar", start: "Abrir curso", back: "Volver al curso", allCourses: "Todos los cursos",
    status: { active: "Activo", scheduled: "Empieza pronto", expired: "Caducado", suspended: "En pausa", revoked: "Finalizado" } as Record<string, string>,
    expiredNote: "Tu acceso ha caducado. Tu progreso se conserva. Escríbenos si quieres ampliarlo.",
    inactiveNote: "Este curso no está disponible ahora mismo. Escríbenos si tienes dudas.",
    locked: "No incluido en tu modalidad", module: "Módulo", markDone: "Marcar lección como completada", done: "Completada",
    pending: "Este material estará disponible próximamente.", download: "Descargar", open: "Abrir", external: "Enlace externo (se abre en otra pestaña)",
    exercise: "Ejercicio", meditation: "Meditación", noAccess: "No tienes acceso a esta lección.",
    resumeNote: "Puedes retomar cuando quieras donde lo dejaste.",
    activateTitle: "Activar tu cuenta", activateText: "Crea tu contraseña para entrar en tu curso.", pw: "Contraseña", pw2: "Repite la contraseña", activate: "Activar",
    pwShort: "La contraseña debe tener al menos 8 caracteres.", pwDiff: "Las contraseñas no coinciden.", badLink: "El enlace no es válido. Usa el enlace del correo de invitación.",
    activateFail: "No se ha podido crear la contraseña. El enlace puede haber caducado.",
    previewBanner: "Vista previa como alumno", previewNote: "Solo para la administración: sin matrícula, sin progreso y con cada acceso registrado en auditoría.", backToAdmin: "Volver a Formación",
    contentOnly: {
      de: "Este curso solo está disponible en alemán. Los títulos, textos, vídeos, audios y documentos se muestran en su idioma original; la interfaz sí está en español.",
      es: "Este curso solo está disponible en español.",
    },
  },
} as const;

export type AulaText = (typeof T)[AulaLocale];
export const aulaText = (l: AulaLocale): AulaText => T[l];

/**
 * Idioma de la INTERFAZ del aula (botones, avisos). Es independiente del idioma del contenido (títulos, textos, vídeos, audios y
 * documentos), que es el del curso y no se traduce. Prioridad: la elección explícita en la URL (?lang=), la última elección de la
 * persona en esta sesión y, por último, el idioma de la web de la empresa.
 */
export function resolveAulaLocale(p: { fromUrl: string | null | undefined; stored: string | null | undefined; site: string | null | undefined }): { locale: AulaLocale; explicit: AulaLocale | null } {
  const valid = (v: string | null | undefined): AulaLocale | null => (v === "de" || v === "es" ? v : null);
  const explicit = valid(p.fromUrl) ?? valid(p.stored);
  return { locale: explicit ?? pickLocale(p.site), explicit };
}

/** Añade (o cambia) `?lang=` de un enlace interno conservando el resto de parámetros y el ancla. Sin elección explícita, no toca nada. */
export function withLang(href: string, explicit: AulaLocale | null): string {
  if (!explicit) return href;
  const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
  const noHash = hash ? href.slice(0, href.indexOf("#")) : href;
  const [path, query = ""] = noHash.split("?");
  const params = new URLSearchParams(query);
  params.set("lang", explicit);
  return `${path}?${params.toString()}${hash}`;
}

/**
 * Aviso de idioma del CONTENIDO: si el curso está en un idioma distinto al de la interfaz se muestra el contenido original (sin
 * traducciones inventadas) y se avisa. `null` si coinciden.
 */
export function contentNotice(courseLanguage: string | null | undefined, ui: AulaLocale): string | null {
  const content = pickLocale(courseLanguage);
  return content === ui ? null : aulaText(ui).contentOnly[content];
}

/** Fecha corta del acceso, en el idioma del aula y en hora de Madrid. */
export function formatAccessDate(ms: number, l: AulaLocale): string {
  return new Intl.DateTimeFormat(l === "de" ? "de-DE" : "es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ms));
}
