/**
 * seedOrganizationDefaults
 *
 * Creates the DB records needed for a new organization (tenant).
 * Called when onboarding a new SaaS customer.
 *
 * Phase 5D will extend this to also seed org-specific feature_flags
 * and system_settings. For now it only creates the organization row
 * and its onboarding_status record.
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { organizations, onboardingStatus } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export async function seedOrganizationDefaults(
  name: string,
  slug: string,
  ownerUserId?: number,
): Promise<{ orgId: number }> {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
  const db = drizzle(pool);

  try {
    // Check slug uniqueness
    const [existing] = await db.select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (existing) {
      throw new Error(`Slug "${slug}" already in use`);
    }

    // Create the organization
    const insertResult = await db.insert(organizations).values({
      name,
      slug,
      status: "onboarding",
      ownerUserId,
    });
    const orgId = (insertResult as unknown as [{ insertId: number }])[0].insertId;

    // Create blank onboarding_status
    await db.insert(onboardingStatus).values({ organizationId: orgId });

    return { orgId };
  } finally {
    await pool.end();
  }
}

