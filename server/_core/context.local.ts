/**
 * context.local.ts — Contexto tRPC para ejecución local sin Manus OAuth.
 *
 * Sustituye context.ts cuando LOCAL_AUTH=true en el .env.
 * Lee la cookie JWT emitida por localAuth.ts en lugar de llamar al SDK de Manus.
 */

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserFromRequest } from "../localAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createLocalContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await getUserFromRequest(opts.req);
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
