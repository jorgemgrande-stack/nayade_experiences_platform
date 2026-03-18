import { eq, desc, and, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  spaCategories, spaTreatments, spaResources, spaSlots, spaScheduleTemplates,
  InsertSpaTreatment,
} from "../drizzle/schema";

async function getDb() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  return drizzle(conn);
}

// ─── SPA CATEGORIES ───────────────────────────────────────────────────────────

export async function getAllSpaCategories() {
  const db = await getDb();
  return db.select().from(spaCategories).orderBy(spaCategories.sortOrder);
}

export async function getActiveSpaCategories() {
  const db = await getDb();
  return db.select().from(spaCategories)
    .where(eq(spaCategories.isActive, true))
    .orderBy(spaCategories.sortOrder);
}

export async function createSpaCategory(data: { slug: string; name: string; description?: string; iconName?: string; sortOrder?: number }) {
  const db = await getDb();
  const result = await db.insert(spaCategories).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function updateSpaCategory(id: number, data: Partial<{ name: string; description: string; iconName: string; sortOrder: number; isActive: boolean }>) {
  const db = await getDb();
  await db.update(spaCategories).set(data).where(eq(spaCategories.id, id));
  return { success: true };
}

export async function deleteSpaCategory(id: number) {
  const db = await getDb();
  await db.delete(spaCategories).where(eq(spaCategories.id, id));
  return { success: true };
}

// ─── SPA TREATMENTS ───────────────────────────────────────────────────────────

export async function getAllSpaTreatments() {
  const db = await getDb();
  return db.select().from(spaTreatments).orderBy(spaTreatments.sortOrder, spaTreatments.name);
}

export async function getActiveSpaTreatments(categoryId?: number) {
  const db = await getDb();
  const conditions = [eq(spaTreatments.isActive, true)];
  if (categoryId) conditions.push(eq(spaTreatments.categoryId, categoryId));
  return db.select().from(spaTreatments)
    .where(and(...conditions))
    .orderBy(spaTreatments.sortOrder, spaTreatments.name);
}

export async function getSpaTreatmentBySlug(slug: string) {
  const db = await getDb();
  const rows = await db.select().from(spaTreatments).where(eq(spaTreatments.slug, slug));
  return rows[0] ?? null;
}

export async function getSpaTreatmentById(id: number) {
  const db = await getDb();
  const rows = await db.select().from(spaTreatments).where(eq(spaTreatments.id, id));
  return rows[0] ?? null;
}

export async function createSpaTreatment(data: Omit<InsertSpaTreatment, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  const result = await db.insert(spaTreatments).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function updateSpaTreatment(id: number, data: Partial<Omit<InsertSpaTreatment, "id" | "createdAt">>) {
  const db = await getDb();
  await db.update(spaTreatments).set(data).where(eq(spaTreatments.id, id));
  return { success: true };
}

export async function deleteSpaTreatment(id: number) {
  const db = await getDb();
  await db.delete(spaTreatments).where(eq(spaTreatments.id, id));
  return { success: true };
}

export async function toggleSpaTreatmentActive(id: number, isActive: boolean) {
  const db = await getDb();
  await db.update(spaTreatments).set({ isActive }).where(eq(spaTreatments.id, id));
  return { success: true };
}

// ─── SPA RESOURCES ────────────────────────────────────────────────────────────

export async function getAllSpaResources() {
  const db = await getDb();
  return db.select().from(spaResources).orderBy(spaResources.type, spaResources.sortOrder);
}

export async function createSpaResource(data: { type: "cabina" | "terapeuta"; name: string; description?: string; isActive?: boolean; sortOrder?: number }) {
  const db = await getDb();
  const result = await db.insert(spaResources).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function updateSpaResource(id: number, data: Partial<{ name: string; description: string; isActive: boolean; sortOrder: number }>) {
  const db = await getDb();
  await db.update(spaResources).set(data).where(eq(spaResources.id, id));
  return { success: true };
}

export async function deleteSpaResource(id: number) {
  const db = await getDb();
  await db.delete(spaResources).where(eq(spaResources.id, id));
  return { success: true };
}

// ─── SPA SLOTS ────────────────────────────────────────────────────────────────

export async function getSpaSlotsByDate(treatmentId: number, date: string) {
  const db = await getDb();
  return db.select().from(spaSlots)
    .where(and(eq(spaSlots.treatmentId, treatmentId), eq(spaSlots.date, date)))
    .orderBy(spaSlots.startTime);
}

export async function getSpaSlotsByDateRange(startDate: string, endDate: string, treatmentId?: number) {
  const db = await getDb();
  const conditions = [gte(spaSlots.date, startDate), lte(spaSlots.date, endDate)];
  if (treatmentId) conditions.push(eq(spaSlots.treatmentId, treatmentId));
  return db.select().from(spaSlots)
    .where(and(...conditions))
    .orderBy(spaSlots.date, spaSlots.startTime);
}

export async function createSpaSlot(data: {
  treatmentId: number;
  resourceId?: number | null;
  date: string;
  startTime: string;
  endTime: string;
  capacity?: number;
  status?: "disponible" | "reservado" | "bloqueado";
  notes?: string;
}) {
  const db = await getDb();
  const result = await db.insert(spaSlots).values({ ...data, bookedCount: 0 });
  return { id: Number(result[0].insertId), success: true };
}

export async function updateSpaSlot(id: number, data: Partial<{
  capacity: number;
  bookedCount: number;
  status: "disponible" | "reservado" | "bloqueado";
  notes: string;
}>) {
  const db = await getDb();
  await db.update(spaSlots).set(data).where(eq(spaSlots.id, id));
  return { success: true };
}

export async function deleteSpaSlot(id: number) {
  const db = await getDb();
  await db.delete(spaSlots).where(eq(spaSlots.id, id));
  return { success: true };
}

// ─── SPA SCHEDULE TEMPLATES ───────────────────────────────────────────────────

export async function getSpaScheduleTemplates(treatmentId?: number) {
  const db = await getDb();
  if (treatmentId) {
    return db.select().from(spaScheduleTemplates)
      .where(eq(spaScheduleTemplates.treatmentId, treatmentId))
      .orderBy(spaScheduleTemplates.dayOfWeek, spaScheduleTemplates.startTime);
  }
  return db.select().from(spaScheduleTemplates)
    .orderBy(spaScheduleTemplates.treatmentId, spaScheduleTemplates.dayOfWeek);
}

export async function createSpaScheduleTemplate(data: {
  treatmentId: number;
  resourceId?: number | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  capacity?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  const result = await db.insert(spaScheduleTemplates).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function updateSpaScheduleTemplate(id: number, data: Partial<{
  startTime: string;
  endTime: string;
  capacity: number;
  isActive: boolean;
}>) {
  const db = await getDb();
  await db.update(spaScheduleTemplates).set(data).where(eq(spaScheduleTemplates.id, id));
  return { success: true };
}

export async function deleteSpaScheduleTemplate(id: number) {
  const db = await getDb();
  await db.delete(spaScheduleTemplates).where(eq(spaScheduleTemplates.id, id));
  return { success: true };
}

/**
 * Auto-generates slots for a treatment based on schedule templates for a given date range.
 */
export async function generateSlotsFromTemplates(treatmentId: number, startDate: string, endDate: string) {
  const db = await getDb();
  const templates = await db.select().from(spaScheduleTemplates)
    .where(and(eq(spaScheduleTemplates.treatmentId, treatmentId), eq(spaScheduleTemplates.isActive, true)));

  if (templates.length === 0) return { created: 0 };

  const start = new Date(startDate);
  const end = new Date(endDate);
  let created = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    const dateStr = d.toISOString().split("T")[0];
    const dayTemplates = templates.filter(t => t.dayOfWeek === dow);

    for (const tmpl of dayTemplates) {
      // Check if slot already exists
      const existing = await db.select().from(spaSlots)
        .where(and(
          eq(spaSlots.treatmentId, treatmentId),
          eq(spaSlots.date, dateStr),
          eq(spaSlots.startTime, tmpl.startTime)
        ));
      if (existing.length === 0) {
        await db.insert(spaSlots).values({
          treatmentId,
          resourceId: tmpl.resourceId,
          date: dateStr,
          startTime: tmpl.startTime,
          endTime: tmpl.endTime,
          capacity: tmpl.capacity,
          bookedCount: 0,
          status: "disponible",
        });
        created++;
      }
    }
  }
  return { created };
}
