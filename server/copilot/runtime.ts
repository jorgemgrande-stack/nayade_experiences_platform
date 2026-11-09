/**
 * Ensamblado de Elephant Copilot en el proceso: historial y datos en la BD de la empresa en curso, IA central del Core
 * (`invokeLLM`: proveedor de la empresa o el central de Big Elephant, consumo medido y limitado por empresa en el ERM),
 * permisos del panel del usuario (RBAC, rol propio o rol legado) y capacidades contratadas de la empresa.
 */
import { getCapabilityAccess } from "../_core/capabilities/access";
import { invokeLLM } from "../_core/llm";
import { resolveAiProvider } from "../ai/provider";
import { checkPermission } from "../customRolesAccess";
import { companyName } from "../tenantBrand";
import { COPILOT_DATA_CAPABILITIES, COPILOT_PERMISSIONS, type CopilotAccess, type CopilotPermission } from "../../shared/copilot";
import { TenantDbCopilotData } from "./data";
import { CopilotService, type LlmFn } from "./service";
import { TenantDbCopilotStore } from "./store";

const store = new TenantDbCopilotStore();
const data = new TenantDbCopilotData();

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p: any) => (p?.type === "text" ? String(p.text ?? "") : "")).join("");
  return "";
}

export const coreLlm: LlmFn = async ({ messages, tools, maxTokens }) => {
  const res = await invokeLLM({ messages, tools, ...(tools?.length ? { toolChoice: "auto" as const } : {}), maxTokens });
  const msg = res.choices?.[0]?.message;
  return {
    content: textOf(msg?.content),
    toolCalls: (msg?.tool_calls ?? []).map((c) => ({ name: String(c.function?.name ?? ""), arguments: String(c.function?.arguments ?? "") })),
    tokensIn: Number(res.usage?.prompt_tokens ?? 0),
    tokensOut: Number(res.usage?.completion_tokens ?? 0),
  };
};

/** ¿Hay proveedor de IA para la empresa en curso? (sin él, Copilot responde «no disponible»). */
export function copilotAiAvailable(): boolean {
  try {
    return resolveAiProvider() != null;
  } catch {
    return false;
  }
}

/** Permisos del panel del usuario y capacidades de la empresa que deciden las herramientas de Copilot. */
export async function resolveCopilotAccess(user: { id: number; role: unknown }): Promise<CopilotAccess> {
  const role = String(user.role);
  const permissions = new Set<CopilotPermission>();
  await Promise.all(
    (Object.entries(COPILOT_PERMISSIONS) as Array<[CopilotPermission, { key: string; fallbackRoles: readonly string[] }]>).map(async ([p, def]) => {
      try {
        if (await checkPermission(user.id, role, def.key, [...def.fallbackRoles])) permissions.add(p);
      } catch {
        // Sin poder comprobar el permiso, esos datos no se ofrecen
      }
    }),
  );
  const capabilities = new Set<string>();
  const access = getCapabilityAccess();
  await Promise.all(
    COPILOT_DATA_CAPABILITIES.map(async (c) => {
      try {
        if ((await access.check(c, { write: false })).allowed) capabilities.add(c);
      } catch {
        // Sin poder verificar la licencia, esa fuente no se ofrece
      }
    }),
  );
  return { permissions, capabilities };
}

export function copilotService(): CopilotService {
  return new CopilotService({ store, data, llm: coreLlm, companyName });
}
