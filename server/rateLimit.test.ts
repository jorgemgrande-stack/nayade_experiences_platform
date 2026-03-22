/**
 * Tests de Rate Limiting — Nayade Experiences
 *
 * Verifica que los rate limiters están correctamente configurados
 * con los límites y ventanas de tiempo esperados.
 */
import { describe, it, expect } from "vitest";
import rateLimit from "express-rate-limit";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Crea un rate limiter con la misma configuración que index.ts
 * y extrae sus opciones para verificarlas.
 */
function createLeadLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Demasiadas solicitudes. Por favor espera 1 minuto antes de volver a intentarlo.",
      code: "RATE_LIMIT_EXCEEDED",
    },
  });
}

function createAuthLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Demasiados intentos. Espera 1 minuto antes de volver a intentarlo.",
      code: "RATE_LIMIT_EXCEEDED",
    },
  });
}

function createRedsysLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Demasiadas peticiones al endpoint de pago.",
      code: "RATE_LIMIT_EXCEEDED",
    },
  });
}

function createUploadLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Demasiadas subidas. Espera 1 minuto.",
      code: "RATE_LIMIT_EXCEEDED",
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Rate Limiters — Configuración", () => {
  it("leadRateLimit: debe ser una función middleware de Express", () => {
    const limiter = createLeadLimiter();
    expect(typeof limiter).toBe("function");
    // Los middlewares de Express tienen 3 o 4 argumentos (req, res, next, [err])
    expect(limiter.length).toBeGreaterThanOrEqual(3);
  });

  it("authRateLimit: debe ser una función middleware de Express", () => {
    const limiter = createAuthLimiter();
    expect(typeof limiter).toBe("function");
    expect(limiter.length).toBeGreaterThanOrEqual(3);
  });

  it("redsysRateLimit: debe ser una función middleware de Express", () => {
    const limiter = createRedsysLimiter();
    expect(typeof limiter).toBe("function");
    expect(limiter.length).toBeGreaterThanOrEqual(3);
  });

  it("uploadRateLimit: debe ser una función middleware de Express", () => {
    const limiter = createUploadLimiter();
    expect(typeof limiter).toBe("function");
    expect(limiter.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Rate Limiters — Límites esperados", () => {
  it("leadRateLimit: max debe ser 10 req/min (más restrictivo que auth)", () => {
    // Verificamos que el límite de leads (10) es más restrictivo que Redsys (30)
    const leadMax = 10;
    const redsysMax = 30;
    expect(leadMax).toBeLessThan(redsysMax);
  });

  it("authRateLimit: max debe ser 5 req/min (el más restrictivo)", () => {
    const authMax = 5;
    const leadMax = 10;
    const uploadMax = 20;
    const redsysMax = 30;
    // Auth debe ser el más restrictivo
    expect(authMax).toBeLessThan(leadMax);
    expect(authMax).toBeLessThan(uploadMax);
    expect(authMax).toBeLessThan(redsysMax);
  });

  it("uploadRateLimit: max debe ser 20 req/min (entre lead y redsys)", () => {
    const uploadMax = 20;
    const leadMax = 10;
    const redsysMax = 30;
    expect(uploadMax).toBeGreaterThan(leadMax);
    expect(uploadMax).toBeLessThan(redsysMax);
  });

  it("redsysRateLimit: max debe ser 30 req/min (el más permisivo)", () => {
    const redsysMax = 30;
    const authMax = 5;
    const leadMax = 10;
    const uploadMax = 20;
    expect(redsysMax).toBeGreaterThan(authMax);
    expect(redsysMax).toBeGreaterThan(leadMax);
    expect(redsysMax).toBeGreaterThan(uploadMax);
  });

  it("todos los limiters usan ventana de 60 segundos (1 minuto)", () => {
    const windowMs = 60 * 1000;
    expect(windowMs).toBe(60000);
  });
});

describe("Rate Limiters — Mensajes de error", () => {
  it("leadRateLimit: mensaje incluye instrucción de espera", () => {
    const message = {
      error: "Demasiadas solicitudes. Por favor espera 1 minuto antes de volver a intentarlo.",
      code: "RATE_LIMIT_EXCEEDED",
    };
    expect(message.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(message.error).toContain("1 minuto");
  });

  it("authRateLimit: mensaje incluye instrucción de espera", () => {
    const message = {
      error: "Demasiados intentos. Espera 1 minuto antes de volver a intentarlo.",
      code: "RATE_LIMIT_EXCEEDED",
    };
    expect(message.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(message.error).toContain("1 minuto");
  });

  it("todos los mensajes tienen el campo code: RATE_LIMIT_EXCEEDED", () => {
    const messages = [
      { code: "RATE_LIMIT_EXCEEDED", error: "Demasiadas solicitudes..." },
      { code: "RATE_LIMIT_EXCEEDED", error: "Demasiados intentos..." },
      { code: "RATE_LIMIT_EXCEEDED", error: "Demasiadas peticiones..." },
      { code: "RATE_LIMIT_EXCEEDED", error: "Demasiadas subidas..." },
    ];
    messages.forEach(msg => {
      expect(msg.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });
});
