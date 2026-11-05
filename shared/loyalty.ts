/**
 * Social Token Net · Tokens internos (capacidad `social-token-net-tokens`): programa de puntos de fidelización de la
 * empresa. Lógica pura (sin BD ni React): la usan el servidor (server/loyaltyDb.ts), el panel y las pruebas.
 *
 * Los puntos son internos de la empresa: no son dinero, no se pueden transferir entre clientes ni cambiar por dinero.
 * Su titular es un cliente del CRM de la empresa (tabla `clients`), nunca un segundo sistema de usuarios.
 *
 * Algoritmos adaptados del motor de SegoTokens de Segolife (server/segolife/tokens/tokenRuleEngine.ts y
 * tokenEngine.ts): precedencia determinista de reglas (prioridad → especificidad → id), cálculo base por método,
 * campaña con multiplicador y bonificación (en ese orden, sin apilar campañas) y recorte por límites en vez de rechazo.
 */

export const LOYALTY_CAPABILITY = "social-token-net-tokens";

/** Tipos de movimiento del libro de puntos. */
export const LEDGER_KINDS = ["emision", "canje", "ajuste", "anulacion", "caducidad"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  emision: "Emisión",
  canje: "Canje",
  ajuste: "Ajuste manual",
  anulacion: "Anulación",
  caducidad: "Caducidad",
};

/** Documento que origina un movimiento. */
export const LOYALTY_SOURCE_LABELS: Record<string, string> = {
  tpv_sale: "Venta del TPV",
  reservation: "Pedido de la tienda online",
  manual: "Panel de fidelización",
  action: "Acción del cliente",
  expiry: "Caducidad de puntos",
  reversal: "Anulación de un movimiento",
  redemption: "Canje de recompensa",
  community: "Participación en una comunidad",
};

/** Cómo calcula una regla los puntos. */
export const RULE_CALCS = ["per_euro", "percentage", "fixed"] as const;
export type RuleCalc = (typeof RULE_CALCS)[number];
export const RULE_CALC_LABELS: Record<RuleCalc, string> = {
  per_euro: "Puntos por cada euro",
  percentage: "Porcentaje del importe (en puntos)",
  fixed: "Puntos fijos",
};

/** Qué dispara una regla: una compra confirmada o una acción permitida del cliente. */
export const RULE_TRIGGERS = ["purchase", "action"] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];

/** Alcance de una regla o campaña de compra. */
export const RULE_SCOPES = ["all", "product", "category"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];
export const RULE_SCOPE_LABELS: Record<RuleScope, string> = {
  all: "Todas las compras",
  product: "Un producto",
  category: "Una categoría",
};

/**
 * Alcance de una campaña: los de las reglas y, con Social Token Net Complete (comunidades y tokens a la vez),
 * «miembros de una comunidad» (scopeId = la comunidad): se aplica a las compras de sus miembros y a los puntos por
 * participar en ella. Sin la integración, una campaña de comunidad no se aplica nunca (no pasa a «todas»).
 */
export const CAMPAIGN_SCOPES = ["all", "product", "category", "community"] as const;
export type CampaignScope = (typeof CAMPAIGN_SCOPES)[number];
export const CAMPAIGN_SCOPE_LABELS: Record<CampaignScope, string> = { ...RULE_SCOPE_LABELS, community: "Miembros de una comunidad" };

/** Acciones permitidas que puede premiar una regla (las registra la administración o una integración). */
export const LOYALTY_ACTIONS = ["alta", "cumpleanos", "resena", "encuesta", "recomendacion", "visita"] as const;
export type LoyaltyAction = (typeof LOYALTY_ACTIONS)[number];
export const LOYALTY_ACTION_LABELS: Record<LoyaltyAction, string> = {
  alta: "Alta en el programa",
  cumpleanos: "Cumpleaños",
  resena: "Reseña publicada",
  encuesta: "Encuesta respondida",
  recomendacion: "Recomendación de un nuevo cliente",
  visita: "Visita registrada",
};

/** Periodo de un límite (por persona). */
export const LIMIT_PERIODS = ["day", "week", "month", "year", "lifetime"] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];
export const LIMIT_PERIOD_LABELS: Record<LimitPeriod, string> = {
  day: "al día",
  week: "a la semana",
  month: "al mes",
  year: "al año",
  lifetime: "en total",
};

export const POINTS_MAX = 1_000_000;
export const REASON_MAX = 300;
export const NAME_MAX = 120;
export const OPERATION_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface LoyaltyRule {
  id: number;
  name: string;
  trigger: RuleTrigger;
  actionKey: string | null;
  scope: RuleScope;
  scopeId: number | null;
  calc: RuleCalc;
  /** per_euro: puntos por euro; percentage: % del importe. */
  rate: number | null;
  fixedPoints: number | null;
  /** Importe mínimo del documento (euros) para que la regla dé puntos. */
  minSpend: number | null;
  /** Tope de puntos de la regla por documento. */
  maxPoints: number | null;
  /** Límite de veces por cliente y periodo (reglas de acción). */
  limitCount: number | null;
  limitPeriod: LimitPeriod | null;
  priority: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
}

export interface LoyaltyCampaign {
  id: number;
  name: string;
  scope: CampaignScope;
  scopeId: number | null;
  multiplier: number | null;
  bonusPoints: number | null;
  /** Presupuesto total de puntos extra de la campaña (null = sin límite). */
  budgetPoints: number | null;
  /** Puntos extra máximos por cliente en el periodo (null = sin límite). */
  perClientLimit: number | null;
  limitPeriod: LimitPeriod | null;
  priority: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
}

/** Línea de una compra confirmada (importe con impuestos, ya con descuentos). */
export interface PurchaseLine {
  productId: number | null;
  categoryId: number | null;
  amount: number;
}

export function isWithinWindow(x: { startsAt: number | null; endsAt: number | null }, at: number): boolean {
  if (x.startsAt != null && x.startsAt > at) return false;
  if (x.endsAt != null && x.endsAt < at) return false;
  return true;
}

const SCOPE_SPECIFICITY: Record<RuleScope, number> = { all: 0, category: 1, product: 2 };

/**
 * Precedencia determinista entre reglas que coinciden (Segolife, compareRulesByPrecedence): 1) prioridad (mayor
 * gana) → 2) especificidad del alcance (producto > categoría > todas) → 3) id más bajo.
 */
export function compareRulesByPrecedence(a: Pick<LoyaltyRule, "id" | "priority" | "scope">, b: Pick<LoyaltyRule, "id" | "priority" | "scope">): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const sa = SCOPE_SPECIFICITY[a.scope] ?? 0;
  const sb = SCOPE_SPECIFICITY[b.scope] ?? 0;
  if (sa !== sb) return sb - sa;
  return a.id - b.id;
}

export function scopeMatchesLine(x: { scope: RuleScope | CampaignScope; scopeId: number | null }, line: PurchaseLine): boolean {
  if (x.scope === "all") return true;
  if (x.scope === "product") return x.scopeId != null && x.scopeId === line.productId;
  if (x.scope === "category") return x.scopeId != null && x.scopeId === line.categoryId;
  return false;
}

/** Puntos base de una regla sobre un importe (Segolife, calculateBaseTokens). Siempre entero y no negativo. */
export function calculateBasePoints(rule: Pick<LoyaltyRule, "calc" | "rate" | "fixedPoints">, amount: number): number {
  let points = 0;
  switch (rule.calc) {
    case "fixed":
      points = rule.fixedPoints ?? 0;
      break;
    case "per_euro":
      points = Math.floor((rule.rate ?? 0) * amount + 1e-9);
      break;
    case "percentage":
      points = Math.floor(amount * ((rule.rate ?? 0) / 100) + 1e-9);
      break;
  }
  return Math.max(0, Math.trunc(points));
}

export interface PurchaseBreakdown {
  /** Puntos por regla (regla → puntos). */
  byRule: Array<{ ruleId: number; ruleName: string; points: number }>;
  base: number;
}

/**
 * Puntos base de una compra: cada línea se valora con la regla de compra activa de mayor precedencia que la cubre;
 * las reglas de puntos fijos se cuentan una sola vez por documento. El importe mínimo se compara con el total del
 * documento y el tope de cada regla se aplica por documento.
 */
export function computePurchaseBase(rules: readonly LoyaltyRule[], lines: readonly PurchaseLine[], at: number): PurchaseBreakdown {
  const total = lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
  const candidates = rules
    .filter((r) => r.active && r.trigger === "purchase" && isWithinWindow(r, at) && (r.minSpend == null || total + 1e-9 >= r.minSpend))
    .sort(compareRulesByPrecedence);
  const perRule = new Map<number, { rule: LoyaltyRule; points: number }>();
  for (const line of lines) {
    if (!(line.amount > 0)) continue;
    const rule = candidates.find((r) => scopeMatchesLine(r, line));
    if (!rule) continue;
    const acc = perRule.get(rule.id) ?? { rule, points: 0 };
    if (rule.calc === "fixed") acc.points = calculateBasePoints(rule, 0);
    else acc.points += calculateBasePoints(rule, line.amount);
    perRule.set(rule.id, acc);
  }
  const byRule = Array.from(perRule.values())
    .map(({ rule, points }) => ({ ruleId: rule.id, ruleName: rule.name, points: rule.maxPoints != null ? Math.min(points, rule.maxPoints) : points }))
    .filter((r) => r.points > 0)
    .sort((a, b) => a.ruleId - b.ruleId);
  return { byRule, base: byRule.reduce((s, r) => s + r.points, 0) };
}

/** Regla de acción aplicable (la de mayor precedencia, activa y vigente). */
export function findActionRule(rules: readonly LoyaltyRule[], action: string, at: number): LoyaltyRule | null {
  const c = rules.filter((r) => r.active && r.trigger === "action" && r.actionKey === action && isWithinWindow(r, at)).sort(compareRulesByPrecedence);
  return c[0] ?? null;
}

/**
 * Campaña aplicable a una compra: la de mayor prioridad (empate: id más bajo) activa, vigente y que cubre alguna línea.
 * Nunca se apilan varias (Segolife: evita bonificaciones inexplicables). Las de comunidad solo cubren la compra si el
 * cliente es miembro activo de esa comunidad (`communityIds`, que solo se informa con la integración activa).
 */
export function findApplicableCampaign(campaigns: readonly LoyaltyCampaign[], lines: readonly PurchaseLine[], at: number, ctx: { communityIds?: ReadonlySet<number> | null } = {}): LoyaltyCampaign | null {
  const covers = (c: LoyaltyCampaign) =>
    c.scope === "community" ? c.scopeId != null && !!ctx.communityIds?.has(c.scopeId) && lines.some((l) => l.amount > 0) : lines.some((l) => l.amount > 0 && scopeMatchesLine(c, l));
  const m = campaigns
    .filter((c) => c.active && isWithinWindow(c, at) && covers(c))
    .sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.id - b.id));
  return m[0] ?? null;
}

/** Campaña de una comunidad para los puntos por participar en ella (la de mayor prioridad; empate: id más bajo). */
export function findCommunityCampaign(campaigns: readonly LoyaltyCampaign[], communityId: number, at: number): LoyaltyCampaign | null {
  const m = campaigns
    .filter((c) => c.active && c.scope === "community" && c.scopeId === communityId && isWithinWindow(c, at))
    .sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.id - b.id));
  return m[0] ?? null;
}

/** Aplica multiplicador (redondeando hacia abajo) y luego bonificación fija, en ese orden (Segolife). */
export function applyCampaignToAmount(campaign: Pick<LoyaltyCampaign, "multiplier" | "bonusPoints"> | null, amount: number): number {
  if (!campaign) return amount;
  let result = amount;
  if (campaign.multiplier != null) result = Math.floor(result * campaign.multiplier + 1e-9);
  if (campaign.bonusPoints != null) result += campaign.bonusPoints;
  return Math.max(0, result);
}

/**
 * Puntos extra de campaña que se pueden conceder: los calculados, recortados por lo que queda del límite por cliente
 * en el periodo y del presupuesto total (política «recortar al remanente», Segolife §12).
 */
export function clampCampaignExtra(extra: number, opts: { perClientRemaining: number | null; budgetRemaining: number | null }): number {
  let out = Math.max(0, extra);
  if (opts.perClientRemaining != null) out = Math.min(out, Math.max(0, opts.perClientRemaining));
  if (opts.budgetRemaining != null) out = Math.min(out, Math.max(0, opts.budgetRemaining));
  return out;
}

/** Fecha (YYYY-MM-DD, Madrid) en que empieza el periodo que contiene `dateKey`. `lifetime` → null (desde siempre). */
export function periodStartKey(period: LimitPeriod, dateKey: string): string | null {
  if (period === "lifetime") return null;
  if (period === "day") return dateKey;
  if (period === "month") return `${dateKey.slice(0, 7)}-01`;
  if (period === "year") return `${dateKey.slice(0, 4)}-01-01`;
  // Semana de lunes a domingo
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Puntos que caducan hoy en un monedero, suponiendo que los canjes consumen primero los puntos más antiguos (FIFO):
 * el saldo que excede de los créditos aún vigentes ya está caducado. Nunca negativo.
 */
export function expiredPoints(balance: number, stillValidCredits: number): number {
  return Math.max(0, balance - Math.max(0, stillValidCredits));
}

/** Suma `months` meses a un instante (para la fecha de caducidad de una emisión). */
export function addMonthsMs(ms: number, months: number): number {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

/** Texto de un importe de puntos con el nombre del programa: «120 puntos». */
export function pointsLabel(points: number, pointsName: string): string {
  return `${points.toLocaleString("es-ES")} ${pointsName || "puntos"}`;
}

/** Valor orientativo de los puntos según la equivalencia del programa (solo informativo: no es dinero). */
export function equivalenceText(points: number, eq: { points: number; euros: number } | null): string | null {
  if (!eq || !(eq.points > 0) || !(eq.euros > 0)) return null;
  const v = (points / eq.points) * eq.euros;
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € en recompensas (orientativo)`;
}

export function csvText(v: string | null | undefined): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// ─── Recompensas y canjes (STN-2) ────────────────────────────────────────────

export const REDEMPTION_STATUSES = ["emitido", "usado", "anulado", "caducado"] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];
export const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = {
  emitido: "Pendiente de usar",
  usado: "Usado",
  anulado: "Anulado",
  caducado: "Caducado",
};

/** Resultado de una validación de código en mostrador (queda registrado). */
export const CHECK_RESULTS = ["valido", "consulta", "no_existe", "ya_usado", "anulado", "caducado"] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

/** Alfabeto de los códigos de canje: sin caracteres que se confunden al leerlos (0/O, 1/I/L). */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 10;

/** Código de un solo uso aleatorio (10 caracteres, ~8·10¹⁴ combinaciones). `random` devuelve bytes aleatorios. */
export function generateRedemptionCode(random: (n: number) => Uint8Array): string {
  const out: string[] = [];
  while (out.length < CODE_LENGTH) {
    for (const b of Array.from(random(CODE_LENGTH * 2))) {
      // Rechazo de los valores que sesgarían la distribución (256 no es múltiplo de 31)
      if (b < 248 && out.length < CODE_LENGTH) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
    }
  }
  return out.join("");
}

/** Normaliza lo que teclea o lee el lector en el mostrador: mayúsculas y sin separadores. null si no es un código válido. */
export function normalizeRedemptionCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

/** Código para mostrar: «ABCDE-FGHJK». */
export function formatRedemptionCode(code: string): string {
  return code.length === CODE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

export interface LoyaltyReward {
  id: number;
  name: string;
  description: string | null;
  costPoints: number;
  /** Unidades disponibles en total (null = sin límite). Cuentan los canjes pendientes y usados. */
  stock: number | null;
  perClientLimit: number | null;
  limitPeriod: LimitPeriod | null;
  /** Días de validez del código desde el canje. */
  codeValidDays: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
}

export type RewardDenial = "inactive" | "not_started" | "ended" | "out_of_stock" | "client_limit" | "insufficient_balance";
export const REWARD_DENIAL_MESSAGES: Record<RewardDenial, string> = {
  inactive: "Esta recompensa no está disponible.",
  not_started: "Esta recompensa todavía no está disponible.",
  ended: "Esta recompensa ya no está disponible.",
  out_of_stock: "No quedan unidades de esta recompensa.",
  client_limit: "Ya has canjeado esta recompensa el máximo de veces permitido.",
  insufficient_balance: "No tienes saldo suficiente para esta recompensa.",
};

/** ¿Se puede canjear ahora? (sin tocar la BD: los contadores los aporta quien llama, bajo bloqueo). */
export function rewardDenial(r: LoyaltyReward, ctx: { at: number; committed: number; clientCommitted: number; balance: number }): RewardDenial | null {
  if (!r.active) return "inactive";
  if (r.startsAt != null && r.startsAt > ctx.at) return "not_started";
  if (r.endsAt != null && r.endsAt < ctx.at) return "ended";
  if (r.stock != null && ctx.committed >= r.stock) return "out_of_stock";
  if (r.perClientLimit != null && ctx.clientCommitted >= r.perClientLimit) return "client_limit";
  if (ctx.balance < r.costPoints) return "insufficient_balance";
  return null;
}

/** Firma de un enlace al área de puntos del cliente: `<cliente>.<caducidad en s>.<firma>`. */
export const PORTAL_TOKEN_RE = /^([1-9]\d{0,9})\.(\d{10})\.([A-Za-z0-9_-]{32})$/;
export const PORTAL_LINK_DAYS = 30;
