import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@nayadeexperiences.es",
    name: "Admin Nayade",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function createUserContext(role: "user" | "admin" | "agente" | "monitor" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: `test-user-${role}`,
    email: `${role}@test.com`,
    name: `Test ${role}`,
    loginMethod: "manus",
    role: role as "user" | "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

// ─── Auth Tests ───────────────────────────────────────────────────────────────

describe("auth", () => {
  it("returns null user for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const user = await caller.auth.me();
    expect(user).toBeNull();
  });

  it("returns user for authenticated requests", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const user = await caller.auth.me();
    expect(user).not.toBeNull();
    expect(user?.role).toBe("admin");
  });

  it("clears session cookie on logout", async () => {
    const clearedCookies: string[] = [];
    const ctx: TrpcContext = {
      user: {
        id: 1, openId: "test", email: "test@test.com", name: "Test",
        loginMethod: "manus", role: "admin",
        createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string) => clearedCookies.push(name),
        cookie: () => {},
      } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(clearedCookies.length).toBeGreaterThan(0);
  });
});

// ─── Public API Tests ─────────────────────────────────────────────────────────

describe("public API", () => {
  it("getCategories returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const categories = await caller.public.getCategories();
    expect(Array.isArray(categories)).toBe(true);
  });

  it("getLocations returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const locations = await caller.public.getLocations();
    expect(Array.isArray(locations)).toBe(true);
  });

  it("getFeaturedExperiences returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const experiences = await caller.public.getFeaturedExperiences();
    expect(Array.isArray(experiences)).toBe(true);
  });

  it("getExperiences accepts filter params", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.public.getExperiences({ limit: 5, offset: 0 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("getSlideshowItems returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const items = await caller.public.getSlideshowItems();
    expect(Array.isArray(items)).toBe(true);
  });
});

// ─── Lead Creation Tests ──────────────────────────────────────────────────────

describe("leads", () => {
  it("submitLead requires name and email", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(
      caller.public.submitLead({
        name: "Test User",
        email: "test@example.com",
        message: "Quiero información sobre esquí",
      })
    ).resolves.toBeDefined();
  });
});

// ─── Admin Access Control Tests ───────────────────────────────────────────────

describe("admin access control", () => {
  it("admin can access admin.getUsers", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const users = await caller.admin.getUsers();
    expect(Array.isArray(users)).toBe(true);
  });

  it("regular user cannot access admin procedures", async () => {
    const caller = appRouter.createCaller(createUserContext("user"));
    await expect(caller.admin.getUsers()).rejects.toThrow();
  });

  it("admin can access CMS slideshow", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const items = await caller.cms.getSlideshowItems();
    expect(Array.isArray(items)).toBe(true);
  });
});

// ─── Quotes Module Tests ──────────────────────────────────────────────────────

describe("quotes module", () => {
  it("staff can get all leads", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const leads = await caller.leads.getAll({ limit: 10, offset: 0 });
    expect(Array.isArray(leads)).toBe(true);
  });

  it("staff can get all quotes", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const quotes = await caller.quotes.getAll({ limit: 10, offset: 0 });
    expect(Array.isArray(quotes)).toBe(true);
  });
});

// ─── Bookings Module Tests ────────────────────────────────────────────────────

describe("bookings module", () => {
  it("authenticated user can get bookings", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const bookings = await caller.bookings.getAll({ limit: 10, offset: 0 });
    expect(Array.isArray(bookings)).toBe(true);
  });
});

// ─── Accounting Module Tests ──────────────────────────────────────────────────

describe("accounting module", () => {
  it("admin can get dashboard metrics", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const metrics = await caller.accounting.getDashboardMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics.totalRevenue).toBe("number");
    expect(typeof metrics.totalBookings).toBe("number");
    expect(typeof metrics.totalLeads).toBe("number");
  });

  it("admin can get transactions", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const transactions = await caller.accounting.getTransactions({ limit: 10, offset: 0 });
    expect(Array.isArray(transactions)).toBe(true);
  });
});
