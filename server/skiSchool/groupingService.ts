/**
 * Ski Net · Cursillos y grupos por niveles: bolsa de inscripción de un turno (producto colectivo, día y hora), propuesta
 * de agrupación revisable (por nivel, edad e idioma, respetando aforo), aplicación de la propuesta revisada (huella) y
 * fusión o división de grupos del turno.
 *
 * Licencia `ski-school` de la sede y escuela activada para operar (mismo orden que el resto de la escuela). Aplicar
 * reutiliza las reglas de la escuela (`createSession` y `addParticipant`: aforo, nivel y edad del producto, mismo
 * alumno en dos clases a la vez). Si algo falla a mitad, lo aplicado queda y el resto sigue en la bolsa: volver a
 * proponer continúa donde se quedó.
 */
import { ModuleNotActive, assertSite, runWithSite, type ModuleGate } from "../sdk";
import { SKI_SCHOOL_ID } from "./manifest";
import { mergeProblem, planGroups, type GroupingProposal, type PoolStudent, type TurnSession } from "./grouping";
import { dayNumber, isTime, pickCode, normalizeConfig } from "./rules";
import { SkiSchoolError, type SkiSchoolService } from "./service";
import type { SkiSchoolStore } from "./store";
import type { SkiGroupingStore, Turn } from "./groupingStore";

export interface GroupingDeps {
  store: SkiGroupingStore;
  school: SkiSchoolStore;
  /** Las reglas de alta de sesiones y alumnos de la escuela. */
  service: SkiSchoolService;
  gate: () => ModuleGate;
  assertSite?: (siteId: string) => Promise<void>;
}

export class SkiGroupingService {
  constructor(private d: GroupingDeps) {}

  private within<T>(siteId: string, write: boolean, fn: () => Promise<T>): Promise<T> {
    return runWithSite(siteId, async () => {
      await (this.d.assertSite ?? ((s: string) => assertSite(s, SKI_SCHOOL_ID)))(siteId);
      await this.d.gate().assert(SKI_SCHOOL_ID, { write, siteId });
      if (write && !(await this.d.school.site(siteId))?.active) throw new ModuleNotActive(SKI_SCHOOL_ID, siteId);
      return fn();
    });
  }

  private async turnProduct(t: Turn) {
    try {
      dayNumber(t.date);
    } catch {
      throw new SkiSchoolError("invalid_input", "Fecha no válida");
    }
    if (!isTime(t.startTime)) throw new SkiSchoolError("invalid_input", "Hora no válida (HH:MM)");
    const p = await this.d.school.product(t.productId);
    if (!p || p.siteId !== t.siteId) throw new SkiSchoolError("not_found", "Producto docente no encontrado en esta sede");
    if (p.kind === "private") throw new SkiSchoolError("invalid_input", "La agrupación es para cursillos y escuelita, no para clases particulares");
    return p;
  }

  /** Sesiones abiertas del turno con su ocupación y las edades de sus alumnos. */
  private async turnSessions(t: Turn) {
    const all = (await this.d.school.sessions(t.siteId, t.date, t.date)).filter((s) => s.productId === t.productId && s.startTime === t.startTime && (s.status === "pending" || s.status === "assigned"));
    const parts = await this.d.school.participants(all.map((s) => s.id));
    return all.map((s) => {
      const mine = parts.filter((p) => p.sessionId === s.id && p.status === "enrolled");
      return { session: s, participants: mine, turn: { id: s.id, capacity: s.capacity, level: s.level, language: s.language, enrolled: mine.length, ages: mine.filter((p) => p.age != null).map((p) => p.age!) } as TurnSession };
    });
  }

  /** El turno: su bolsa (pendientes, colocados y anulados) y sus grupos con sus alumnos. */
  turn(t: Turn) {
    return this.within(t.siteId, false, async () => {
      const product = await this.turnProduct(t);
      const [pool, sessions] = await Promise.all([this.d.store.pool(t), this.turnSessions(t)]);
      const instructors = await this.d.school.instructors(t.siteId);
      return {
        product: { id: product.id, name: product.name, kind: product.kind, capacity: product.capacity, durationMinutes: product.durationMinutes },
        pool,
        sessions: sessions.map(({ session, participants }) => ({ ...session, instructorName: instructors.find((i) => i.id === session.instructorId)?.fullName ?? null, participants })),
      };
    });
  }

  addToPool(t: Turn, input: { name: string; age?: number | null; level?: string | null; language?: string | null; notes?: string | null }, actor: string) {
    return this.within(t.siteId, true, async () => {
      await this.turnProduct(t);
      const cfg = normalizeConfig((await this.d.school.site(t.siteId))?.config ?? null);
      const name = input.name.trim();
      if (name.length < 2 || name.length > 120) throw new SkiSchoolError("invalid_input", "Nombre del alumno: entre 2 y 120 caracteres");
      if (input.age != null && (!Number.isInteger(input.age) || input.age < 0 || input.age > 120)) throw new SkiSchoolError("invalid_input", "Edad no válida");
      let level: string | null;
      let language: string | null;
      try {
        level = pickCode(input.level, cfg.levels, "Nivel");
        language = pickCode(input.language, cfg.languages, "Idioma");
      } catch (e) {
        throw new SkiSchoolError("invalid_input", (e as Error).message);
      }
      const notes = (input.notes ?? "").trim().slice(0, 500) || null;
      const id = await this.d.store.addEntry({ ...t, name, age: input.age ?? null, level, language, notes }, actor);
      return (await this.d.store.entry(id))!;
    });
  }

  cancelPoolEntry(siteId: string, id: number) {
    return this.within(siteId, true, async () => {
      const e = await this.d.store.entry(id);
      if (!e || e.siteId !== siteId) throw new SkiSchoolError("not_found", "Alumno de la bolsa no encontrado en esta sede");
      if (!(await this.d.store.cancelEntry(id))) throw new SkiSchoolError("conflict", "Ese alumno ya tiene grupo o estaba anulado");
      return { id, cancelled: true };
    });
  }

  private async plan(t: Turn): Promise<{ proposal: GroupingProposal; product: Awaited<ReturnType<SkiGroupingService["turnProduct"]>>; pending: PoolStudent[] }> {
    const product = await this.turnProduct(t);
    const pending = (await this.d.store.pool(t)).filter((p) => p.status === "pending").map((p) => ({ poolId: p.id, name: p.name, age: p.age, level: p.level, language: p.language }));
    const sessions = (await this.turnSessions(t)).map((s) => s.turn);
    return { proposal: planGroups(pending, sessions, { capacity: product.capacity, useLanguage: product.kind !== "kids" }), product, pending };
  }

  /** Propuesta revisable (no cambia nada). */
  propose(t: Turn) {
    return this.within(t.siteId, false, async () => (await this.plan(t)).proposal);
  }

  /**
   * Aplica la propuesta revisada: si al recalcularla no coincide (alguien cambió el turno entretanto), se rechaza para
   * revisarla de nuevo. Crea las sesiones nuevas e inscribe a cada alumno con las reglas de la escuela.
   */
  apply(t: Turn, fingerprint: string, actor: string) {
    return this.within(t.siteId, true, async () => {
      const { proposal, product, pending } = await this.plan(t);
      if (proposal.fingerprint !== fingerprint) throw new SkiSchoolError("conflict", "La propuesta ha cambiado desde que la revisaste: vuelve a proponer los grupos");
      if (!proposal.groups.length) throw new SkiSchoolError("conflict", "No hay alumnos pendientes de grupo en este turno");
      const byId = new Map(pending.map((p) => [p.poolId, p]));
      let created = 0;
      let placed = 0;
      for (const g of proposal.groups) {
        const sessionId =
          g.kind === "incorporate"
            ? g.sessionId
            : (await this.d.service.createSession(t.siteId, { productId: product.id, date: t.date, startTime: t.startTime, level: g.level, language: g.language }, actor)).id;
        if (g.kind === "new_session") created++;
        for (const poolId of g.poolIds) {
          const s = byId.get(poolId)!;
          const p = await this.d.service.addParticipant(t.siteId, sessionId, { name: s.name, age: s.age, level: s.level });
          if (await this.d.store.markPlaced(poolId, sessionId, p.id)) placed++;
        }
      }
      return { created, placed, emptySessionIds: proposal.emptySessionIds };
    });
  }

  /** Fusiona `sourceId` en `targetId` (mismo turno, nivel e idioma compatibles, caben); el grupo de origen se cancela. */
  merge(siteId: string, targetId: number, sourceId: number) {
    return this.within(siteId, true, async () => {
      if (targetId === sourceId) throw new SkiSchoolError("invalid_input", "Elige dos grupos distintos");
      const [a, b] = await Promise.all([this.d.school.session(targetId), this.d.school.session(sourceId)]);
      if (!a || !b || a.siteId !== siteId || b.siteId !== siteId) throw new SkiSchoolError("not_found", "Grupo no encontrado en esta sede");
      if (a.productId !== b.productId || a.date !== b.date || a.startTime !== b.startTime) throw new SkiSchoolError("conflict", "Solo se fusionan grupos del mismo turno (producto, día y hora)");
      const moved = await this.d.school.moveParticipants(sourceId, targetId, "all", true, (from, to, moving, enrolledTo) => {
        for (const s of [from, to]) if (s.status !== "pending" && s.status !== "assigned") throw new SkiSchoolError("conflict", `El grupo #${s.id} ya está cerrado`);
        const why = mergeProblem({ capacity: to.capacity, level: to.level, language: to.language, enrolled: enrolledTo }, { level: from.level, language: from.language, enrolled: moving });
        if (why) throw new SkiSchoolError("conflict", why);
      });
      return { targetId, sourceId, moved };
    });
  }

  /** Divide un grupo: los alumnos elegidos pasan a un grupo nuevo del mismo turno (sin profesor, para asignarlo). */
  split(siteId: string, sessionId: number, participantIds: number[], actor: string) {
    return this.within(siteId, true, async () => {
      const s = await this.d.school.session(sessionId);
      if (!s || s.siteId !== siteId) throw new SkiSchoolError("not_found", "Grupo no encontrado en esta sede");
      if (s.status !== "pending" && s.status !== "assigned") throw new SkiSchoolError("conflict", "El grupo ya está cerrado");
      const enrolled = (await this.d.school.participants([sessionId])).filter((p) => p.status === "enrolled");
      const ids = Array.from(new Set(participantIds));
      if (!ids.length || ids.length >= enrolled.length) throw new SkiSchoolError("invalid_input", "Elige algunos alumnos (no todos) para el grupo nuevo");
      if (ids.some((id) => !enrolled.some((p) => p.id === id))) throw new SkiSchoolError("invalid_input", "Hay alumnos que no están en este grupo");
      const created = await this.d.service.createSession(
        siteId,
        { productId: s.productId, date: s.date, startTime: s.startTime, endTime: s.endTime, level: s.level, language: s.language, capacity: s.capacity, meetingPoint: s.meetingPoint },
        actor,
      );
      const moved = await this.d.school.moveParticipants(sessionId, created.id, ids, false, (_from, to, moving, enrolledTo) => {
        if (moving !== ids.length) throw new SkiSchoolError("conflict", "Los alumnos del grupo han cambiado: recarga y vuelve a intentarlo");
        if (moving + enrolledTo > to.capacity) throw new SkiSchoolError("conflict", "No caben en el grupo nuevo");
      });
      return { sessionId, newSessionId: created.id, moved };
    });
  }
}
