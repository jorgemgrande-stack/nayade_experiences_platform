/**
 * GET /kb  — Knowledge Base pública de Nayade Experiences
 * Devuelve toda la información del negocio en texto plano estructurado,
 * optimizado para ser usado como contexto en agentes de IA (GHL, etc.).
 * No requiere autenticación. Se actualiza automáticamente desde la BD.
 */
import { Router } from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import {
  experiences,
  experienceVariants,
  locations,
  categories,
  roomTypes,
  roomRates,
  roomRateSeasons,
  spaTreatments,
  spaCategories,
  packs,
  siteSettings,
  staticPages,
  restaurants,
  restaurantShifts,
} from "../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

function strip(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function fmtPrice(p: string | number | null | undefined): string {
  if (p == null) return "";
  const n = typeof p === "string" ? parseFloat(p) : p;
  if (isNaN(n)) return "";
  return `${n.toFixed(2)} €`;
}

function arr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  return [];
}

export const kbRouter = Router();

kbRouter.get("/kb", async (_req, res) => {
  try {
    const [
      locs,
      cats,
      exps,
      variants,
      roomTypesData,
      roomRatesData,
      seasonsData,
      spaCats,
      spaData,
      packsData,
      settings,
      pages,
      restData,
      shiftsData,
    ] = await Promise.all([
      db.select().from(locations).where(eq(locations.isActive, true)),
      db.select().from(categories).where(eq(categories.isActive, true)),
      db.select().from(experiences).where(eq(experiences.isActive, true)),
      db.select().from(experienceVariants),
      db.select().from(roomTypes).where(eq(roomTypes.isActive, true)),
      db.select().from(roomRates).where(eq(roomRates.isActive, true)),
      db.select().from(roomRateSeasons).where(eq(roomRateSeasons.isActive, true)),
      db.select().from(spaCategories).where(eq(spaCategories.isActive, true)),
      db.select().from(spaTreatments).where(eq(spaTreatments.isActive, true)),
      db.select().from(packs).where(eq(packs.isActive, true)),
      db.select().from(siteSettings),
      db.select().from(staticPages).where(eq(staticPages.isPublished, true)),
      db.select().from(restaurants),
      db.select().from(restaurantShifts),
    ]);

    const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value ?? ""]));
    const catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
    const locMap = Object.fromEntries(locs.map((l) => [l.id, l]));
    const varsByExp = new Map<number, typeof variants>();
    for (const v of variants) {
      if (!varsByExp.has(v.experienceId)) varsByExp.set(v.experienceId, []);
      varsByExp.get(v.experienceId)!.push(v);
    }
    const seasonMap = Object.fromEntries(seasonsData.map((s) => [s.id, s.name]));
    const spaCatMap = Object.fromEntries(spaCats.map((c) => [c.id, c.name]));
    const shiftsByRest = new Map<number, typeof shiftsData>();
    for (const s of shiftsData) {
      if (!shiftsByRest.has(s.restaurantId)) shiftsByRest.set(s.restaurantId, []);
      shiftsByRest.get(s.restaurantId)!.push(s);
    }

    const lines: string[] = [];
    const sep = "─".repeat(60);

    lines.push("=".repeat(60));
    lines.push("NAYADE EXPERIENCES — BASE DE CONOCIMIENTO");
    lines.push(`Actualizado: ${new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`);
    lines.push("=".repeat(60));
    lines.push("");

    // ── INFORMACIÓN GENERAL ──────────────────────────────────────────────────
    lines.push("## INFORMACIÓN GENERAL");
    lines.push(sep);
    const generalKeys = ["company_name", "tagline", "about", "phone", "email", "whatsapp", "address", "schedule", "cancellation_policy", "booking_policy", "faqs"];
    for (const key of generalKeys) {
      const val = settingsMap[key];
      if (val) {
        lines.push(`${key.replace(/_/g, " ").toUpperCase()}: ${strip(val)}`);
      }
    }
    // Remaining settings that might have useful info
    for (const s of settings) {
      if (!generalKeys.includes(s.key) && s.value && s.type === "text") {
        lines.push(`${s.key.replace(/_/g, " ").toUpperCase()}: ${strip(s.value)}`);
      }
    }
    lines.push("");

    // ── UBICACIONES ──────────────────────────────────────────────────────────
    lines.push("## UBICACIONES / INSTALACIONES");
    lines.push(sep);
    for (const loc of locs) {
      lines.push(`### ${loc.name}`);
      if (loc.address) lines.push(`Dirección: ${loc.address}`);
      if (loc.description) lines.push(strip(loc.description));
      lines.push("");
    }

    // ── ACTIVIDADES / EXPERIENCIAS ────────────────────────────────────────────
    lines.push("## ACTIVIDADES Y EXPERIENCIAS");
    lines.push(sep);
    for (const exp of exps.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      lines.push(`### ${exp.title}`);
      const loc = locMap[exp.locationId];
      if (loc) lines.push(`Instalación: ${loc.name}`);
      const cat = catMap[exp.categoryId];
      if (cat) lines.push(`Categoría: ${cat}`);
      if (exp.shortDescription) lines.push(strip(exp.shortDescription));
      if (exp.description) lines.push(strip(exp.description));
      lines.push(`Precio base: ${fmtPrice(exp.basePrice)} por persona`);
      if (exp.discountPercent && parseFloat(exp.discountPercent) > 0) {
        lines.push(`Descuento activo: ${exp.discountPercent}%`);
      }
      if (exp.duration) lines.push(`Duración: ${exp.duration}`);
      if (exp.minPersons) lines.push(`Mínimo de personas: ${exp.minPersons}`);
      if (exp.maxPersons) lines.push(`Máximo de personas: ${exp.maxPersons}`);
      if (exp.difficulty) lines.push(`Dificultad: ${exp.difficulty}`);
      const inc = arr(exp.includes);
      if (inc.length) lines.push(`Incluye: ${inc.join(", ")}`);
      const exc = arr(exp.excludes);
      if (exc.length) lines.push(`No incluye: ${exc.join(", ")}`);
      if (exp.requirements) lines.push(`Requisitos: ${strip(exp.requirements)}`);

      const expVars = varsByExp.get(exp.id) ?? [];
      for (const v of expVars) {
        lines.push(`  Variante "${v.name}": ${strip(v.description)}`);
        const opts = v.options as { label: string; value: string; priceAdjustment: number }[] | null;
        if (opts && opts.length) {
          for (const o of opts) {
            const adj = o.priceAdjustment ? ` (+${fmtPrice(o.priceAdjustment)})` : "";
            lines.push(`    - ${o.label}${adj}`);
          }
        }
      }
      lines.push("");
    }

    // ── HOTEL / ALOJAMIENTO ───────────────────────────────────────────────────
    if (roomTypesData.length > 0) {
      lines.push("## HOTEL Y ALOJAMIENTO");
      lines.push(sep);
      for (const rt of roomTypesData.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
        lines.push(`### ${rt.name}`);
        if (rt.shortDescription) lines.push(strip(rt.shortDescription));
        if (rt.description) lines.push(strip(rt.description));
        lines.push(`Precio base: desde ${fmtPrice(rt.basePrice)} / noche`);
        lines.push(`Capacidad: ${rt.maxAdults} adultos + ${rt.maxChildren} niños (máx ${rt.maxOccupancy} personas)`);
        if (rt.surfaceM2) lines.push(`Superficie: ${rt.surfaceM2} m²`);
        const amenities = arr(rt.amenities);
        if (amenities.length) lines.push(`Servicios: ${amenities.join(", ")}`);
        if (rt.discountPercent && parseFloat(rt.discountPercent) > 0) {
          lines.push(`Descuento activo: ${rt.discountPercent}% ${rt.discountLabel ?? ""}`);
        }

        // Tarifas específicas
        const rates = roomRatesData.filter((r) => r.roomTypeId === rt.id);
        if (rates.length) {
          const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
          for (const rate of rates) {
            const season = rate.seasonId ? seasonMap[rate.seasonId] : null;
            const day = rate.dayOfWeek != null ? DAYS[rate.dayOfWeek] : null;
            const specifics = [season, day, rate.specificDate].filter(Boolean).join(" / ");
            const suppl = rate.supplement && parseFloat(rate.supplement) > 0
              ? ` + ${fmtPrice(rate.supplement)} (${rate.supplementLabel ?? "suplemento"})`
              : "";
            lines.push(`  Tarifa${specifics ? ` [${specifics}]` : ""}: ${fmtPrice(rate.pricePerNight)}/noche${suppl}`);
          }
        }
        lines.push("");
      }
    }

    // ── SPA ───────────────────────────────────────────────────────────────────
    if (spaData.length > 0) {
      lines.push("## SPA Y TRATAMIENTOS");
      lines.push(sep);
      for (const cat of spaCats) {
        const treatments = spaData.filter((t) => t.categoryId === cat.id);
        if (!treatments.length) continue;
        lines.push(`### ${cat.name}`);
        if (cat.description) lines.push(strip(cat.description));
        for (const t of treatments.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
          lines.push(`  - ${t.name}: ${fmtPrice(t.price)} | ${t.durationMinutes} min | máx ${t.maxPersons} personas`);
          if (t.shortDescription) lines.push(`    ${strip(t.shortDescription)}`);
          const bens = arr(t.benefits);
          if (bens.length) lines.push(`    Beneficios: ${bens.join(", ")}`);
        }
        lines.push("");
      }
      // Treatments without category
      const uncategorized = spaData.filter((t) => !t.categoryId || !spaCatMap[t.categoryId!]);
      if (uncategorized.length) {
        lines.push("### Otros tratamientos");
        for (const t of uncategorized) {
          lines.push(`  - ${t.name}: ${fmtPrice(t.price)} | ${t.durationMinutes} min`);
        }
        lines.push("");
      }
    }

    // ── PACKS ─────────────────────────────────────────────────────────────────
    if (packsData.length > 0) {
      lines.push("## PACKS Y EXPERIENCIAS COMBINADAS");
      lines.push(sep);
      const packCategories: Record<string, string> = {
        dia: "Packs de día",
        escolar: "Packs escolares",
        empresa: "Packs empresa",
      };
      for (const [catKey, catLabel] of Object.entries(packCategories)) {
        const catPacks = packsData.filter((p) => p.category === catKey);
        if (!catPacks.length) continue;
        lines.push(`### ${catLabel}`);
        for (const p of catPacks.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
          lines.push(`#### ${p.title}`);
          if (p.subtitle) lines.push(p.subtitle);
          if (p.shortDescription) lines.push(strip(p.shortDescription));
          if (p.description) lines.push(strip(p.description));
          lines.push(`Precio: ${fmtPrice(p.basePrice)}${p.priceLabel ? ` (${p.priceLabel})` : ""}`);
          if (p.duration) lines.push(`Duración: ${p.duration}`);
          if (p.minPersons) lines.push(`Mínimo: ${p.minPersons} personas`);
          if (p.maxPersons) lines.push(`Máximo: ${p.maxPersons} personas`);
          if (p.targetAudience) lines.push(`Dirigido a: ${p.targetAudience}`);
          if (p.schedule) lines.push(`Horario/Programa: ${strip(p.schedule)}`);
          const inc = arr(p.includes);
          if (inc.length) lines.push(`Incluye: ${inc.join(", ")}`);
          const exc = arr(p.excludes);
          if (exc.length) lines.push(`No incluye: ${exc.join(", ")}`);
          if (p.note) lines.push(`Nota: ${strip(p.note)}`);
          if (p.hasStay) lines.push("Incluye alojamiento: sí");
          lines.push("");
        }
      }
    }

    // ── RESTAURACIÓN ─────────────────────────────────────────────────────────
    if (restData.length > 0) {
      lines.push("## RESTAURACIÓN");
      lines.push(sep);
      for (const r of restData) {
        lines.push(`### ${r.name}`);
        if (r.shortDesc) lines.push(strip(r.shortDesc));
        if (r.longDesc) lines.push(strip(r.longDesc));
        if (r.location) lines.push(`Dirección: ${r.location}`);
        if (r.phone) lines.push(`Teléfono: ${r.phone}`);
        if (r.email) lines.push(`Email: ${r.email}`);
        if (r.cuisine) lines.push(`Cocina: ${r.cuisine}`);
        lines.push(`Capacidad máxima: ${r.maxGroupSize} comensales`);
        const shifts = shiftsByRest.get(r.id) ?? [];
        if (shifts.length) {
          const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
          lines.push("Turnos:");
          for (const sh of shifts) {
            const days = (sh.daysOfWeek as number[] | null)?.map((d) => DAY_NAMES[d]).join(", ") ?? "";
            lines.push(`  - ${sh.name}: ${sh.startTime}–${sh.endTime}${days ? ` (${days})` : ""} | max ${sh.maxCapacity} personas`);
          }
        }
        lines.push("");
      }
    }

    // ── PÁGINAS ESTÁTICAS (política de cancelación, FAQs, etc.) ──────────────
    if (pages.length > 0) {
      lines.push("## POLÍTICAS Y PÁGINAS INFORMATIVAS");
      lines.push(sep);
      for (const page of pages) {
        lines.push(`### ${page.title} (/${page.slug})`);
        if (page.content) lines.push(strip(page.content));
        lines.push("");
      }
    }

    lines.push("=".repeat(60));
    lines.push("FIN DE LA BASE DE CONOCIMIENTO");
    lines.push("=".repeat(60));

    const text = lines.join("\n");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300"); // 5 min cache
    res.send(text);
  } catch (err) {
    console.error("[KB] Error:", err);
    res.status(500).send("Error al generar la base de conocimiento.");
  }
});

// También disponible como JSON si se prefiere
kbRouter.get("/kb.json", async (_req, res) => {
  try {
    const [
      locs,
      cats,
      exps,
      roomTypesData,
      spaData,
      spaCats,
      packsData,
      settings,
    ] = await Promise.all([
      db.select().from(locations).where(eq(locations.isActive, true)),
      db.select().from(categories).where(eq(categories.isActive, true)),
      db.select().from(experiences).where(eq(experiences.isActive, true)),
      db.select().from(roomTypes).where(eq(roomTypes.isActive, true)),
      db.select().from(spaTreatments).where(eq(spaTreatments.isActive, true)),
      db.select().from(spaCategories).where(eq(spaCategories.isActive, true)),
      db.select().from(packs).where(eq(packs.isActive, true)),
      db.select().from(siteSettings),
    ]);

    const catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
    const locMap = Object.fromEntries(locs.map((l) => [l.id, l.name]));
    const spaCatMap = Object.fromEntries(spaCats.map((c) => [c.id, c.name]));

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      generatedAt: new Date().toISOString(),
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      locations: locs.map((l) => ({
        name: l.name,
        address: l.address,
        description: strip(l.description),
      })),
      experiences: exps.map((e) => ({
        title: e.title,
        category: catMap[e.categoryId] ?? "",
        location: locMap[e.locationId] ?? "",
        description: strip(e.shortDescription),
        price: `${fmtPrice(e.basePrice)}/persona`,
        duration: e.duration,
        minPersons: e.minPersons,
        maxPersons: e.maxPersons,
        difficulty: e.difficulty,
        includes: arr(e.includes),
        excludes: arr(e.excludes),
      })),
      hotel: {
        roomTypes: roomTypesData.map((r) => ({
          name: r.name,
          description: strip(r.shortDescription),
          priceFrom: fmtPrice(r.basePrice),
          maxOccupancy: r.maxOccupancy,
          amenities: arr(r.amenities),
        })),
      },
      spa: {
        categories: spaCats.map((c) => ({
          name: c.name,
          treatments: spaData
            .filter((t) => t.categoryId === c.id)
            .map((t) => ({
              name: t.name,
              price: fmtPrice(t.price),
              durationMinutes: t.durationMinutes,
              description: strip(t.shortDescription),
            })),
        })),
      },
      packs: packsData.map((p) => ({
        title: p.title,
        category: p.category,
        price: fmtPrice(p.basePrice),
        duration: p.duration,
        includes: arr(p.includes),
      })),
    });
  } catch (err) {
    console.error("[KB JSON] Error:", err);
    res.status(500).json({ error: "Error al generar la base de conocimiento." });
  }
});

