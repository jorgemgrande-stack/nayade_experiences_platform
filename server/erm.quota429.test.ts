/**
 * Una cuota dura superada dentro de un procedimiento tRPC responde 429 (TOO_MANY_REQUESTS) con un
 * mensaje claro; antes salía como error interno (500). El resto de errores no cambia.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { QuotaExceededError } from "./_core/erm/types";

const decision = { allowed: false, metric: "storage.write.bytes", limit: 10, used: 12, period: "month" } as never;

const app = router({
  upload: publicProcedure.mutation(() => {
    throw new QuotaExceededError("storage.write.bytes", decision);
  }),
  boom: publicProcedure.query(() => {
    throw new Error("fallo cualquiera");
  }),
  forbidden: publicProcedure.query(() => {
    throw new TRPCError({ code: "FORBIDDEN", message: "no" });
  }),
  privateUpload: protectedProcedure.mutation(() => {
    throw new QuotaExceededError("email.sent", decision);
  }),
});

const caller = (user: unknown) => app.createCaller({ user, req: {} as never, res: {} as never } as never);

describe("cuotas del Resource Manager en tRPC", () => {
  it("cuota excedida → 429 con mensaje claro", async () => {
    const e = await caller(null).upload().catch((x) => x);
    expect(e).toBeInstanceOf(TRPCError);
    expect(e.code).toBe("TOO_MANY_REQUESTS");
    expect(getHTTPStatusCodeFromError(e)).toBe(429);
    expect(e.message).toContain("storage.write.bytes");
    expect(e.cause).toBeInstanceOf(QuotaExceededError);
  });

  it("también en procedimientos protegidos", async () => {
    const e = await caller({ id: 1, role: "admin" }).privateUpload().catch((x) => x);
    expect(e.code).toBe("TOO_MANY_REQUESTS");
  });

  it("el resto de errores no cambia", async () => {
    expect((await caller(null).boom().catch((x) => x)).code).toBe("INTERNAL_SERVER_ERROR");
    expect((await caller(null).forbidden().catch((x) => x)).code).toBe("FORBIDDEN");
    expect((await caller(null).privateUpload().catch((x) => x)).code).toBe("UNAUTHORIZED");
  });
});
