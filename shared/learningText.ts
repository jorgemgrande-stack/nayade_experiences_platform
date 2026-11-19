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
  },
} as const;

export type AulaText = (typeof T)[AulaLocale];
export const aulaText = (l: AulaLocale): AulaText => T[l];

/** Fecha corta del acceso, en el idioma del aula y en hora de Madrid. */
export function formatAccessDate(ms: number, l: AulaLocale): string {
  return new Intl.DateTimeFormat(l === "de" ? "de-DE" : "es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ms));
}
