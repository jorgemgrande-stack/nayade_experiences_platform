/**
 * Ski Net · Escuela (módulo del SDK). Primer recorrido: activación por sede con su configuración (niveles,
 * modalidades, idiomas, horario y límites), profesores con disponibilidad semanal y ausencias, productos docentes
 * (clase particular, cursillo/colectiva, escuelita), sesiones (manuales o vinculadas a una reserva del Core),
 * alumnos inscritos, asignación de profesor con reglas duras y planning por día y profesor. Profesores (0.2): asistencia,
 * control de horas, liquidaciones congeladas al cerrar con exportación y «Mis clases y horas» en el portal del empleado.
 *
 * Licencia: capacidad `ski-school` del catálogo (empresa o sede). Activación: por sede, en la BD de la empresa
 * (`ski_school_sites`); desactivar no borra nada. Versión 0.x: no es Ski Net completo.
 */
import { defineSdkModule } from "../sdk";

export const SKI_SCHOOL_ID = "ski_school";

export type SkiSchoolEvents = {
  "ski_school.site.activated": { siteId: string };
  "ski_school.site.deactivated": { siteId: string };
  "ski_school.session.created": { sessionId: number; productId: number; date: string; reservationId: number | null };
  "ski_school.session.assigned": { sessionId: number; instructorId: number | null };
  "ski_school.participant.enrolled": { sessionId: number; participantId: number };
  "ski_school.settlement.closed": { settlementId: number; instructorId: number; totalCents: number };
};

export const skiSchoolModule = defineSdkModule<SkiSchoolEvents>({
  manifest: {
    id: SKI_SCHOOL_ID,
    name: "Ski Net · Escuela",
    version: "0.2.0",
    kind: "sector",
    coreRange: "^1.0.0",
    permissions: [
      { key: "ski_school.view", description: "Consultar profesores, productos docentes, sesiones y planning" },
      { key: "ski_school.manage", description: "Gestionar la escuela por sede: profesores, sesiones, alumnos y asignaciones" },
    ],
    description: "Escuela de esquí y snowboard por sede: profesores, disponibilidad, productos docentes, sesiones, alumnos y planning",
    resources: ["http.request"],
    source: { location: "core" },
  },
  contract: "^1.1.0",
  capability: "ski-school",
  siteScoped: true,
  events: ["ski_school.site.activated", "ski_school.site.deactivated", "ski_school.session.created", "ski_school.session.assigned", "ski_school.participant.enrolled", "ski_school.settlement.closed"],
});
