/**
 * Pantalla de acceso con la marca de cada empresa: tema público del acceso (fondo de la web por defecto, propio o
 * ninguno; titular y mensaje saneados), validación de lo que guarda el administrador (sin inyección de CSS, HTML ni
 * scripts; solo imágenes https o propias), aspecto con contraste WCAG comprobado y valores predeterminados, validación
 * del formulario, compatibilidad del progreso de Primeros pasos con el paso nuevo.
 */
import { describe, it, expect } from "vitest";
import { buildTheme, cleanThemeValues, safeImageUrl, LOGIN_BACKGROUND_NONE, ThemeValueError, THEME_EDITABLE_KEYS, PUBLIC_THEME_KEYS } from "./_core/theme";
import { loginLook, contrastRatio, readableOn, NEUTRAL_INK, BIG_ELEPHANT, colorFieldState } from "../shared/loginBrand";
import { loginErrorMessage, validateEmail, validateLogin } from "../shared/authForm";
import { SETUP_STEPS, markStep, nextPendingStep, parseProgress, progressPercent } from "../shared/setupWizard";

const get = (o: Record<string, string>) => (k: string) => o[k];
const HERO = "https://cdn.example.com/hero.jpg";

describe("tema público del acceso", () => {
  it("fondo: la imagen de la web por defecto; uno propio; «none» lo retira; en single nada salvo ajuste explícito", () => {
    expect(buildTheme(get({ brand_hero_image_url: HERO }), { multi: true }).login).toEqual({ backgroundUrl: HERO, backgroundSource: "web", title: null, message: null });
    expect(buildTheme(get({ brand_hero_image_url: HERO, login_background_url: "/files/01HZX/fondo.jpg" }), { multi: true }).login.backgroundUrl).toBe("/files/01HZX/fondo.jpg");
    expect(buildTheme(get({ brand_hero_image_url: HERO, login_background_url: LOGIN_BACKGROUND_NONE }), { multi: true }).login).toMatchObject({ backgroundUrl: null, backgroundSource: "none" });
    expect(buildTheme(get({ brand_hero_image_url: HERO }), { multi: false }).login.backgroundUrl).toBeNull();
    expect(buildTheme(get({}), { multi: true }).login).toEqual({ backgroundUrl: null, backgroundSource: "none", title: null, message: null });
  });

  it("imágenes peligrosas o no https se descartan (nunca llegan al navegador)", () => {
    for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "http://cdn.example.com/a.jpg", "https://x.example/a.jpg\" onerror=\"alert(1)", "https://x.example/a.jpg);background:red", "//evil.example/a.jpg", " "]) {
      expect(safeImageUrl(bad), bad).toBeNull();
      expect(buildTheme(get({ login_background_url: bad }), { multi: true }).login.backgroundUrl, bad).toBeNull();
    }
    expect(safeImageUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
  });

  it("titular y mensaje sin etiquetas ni caracteres de control, con su longitud máxima", () => {
    const t = buildTheme(get({ login_welcome_title: "Hola <script>alert(1)</script>", login_welcome_message: "x".repeat(500) }), { multi: true });
    expect(t.login.title).toBe("Hola scriptalert(1)/script");
    expect(t.login.message).toHaveLength(240);
  });

  it("getTheme lee los ajustes del acceso; el administrador puede editarlos", () => {
    for (const k of ["brand_hero_image_url", "login_background_url", "login_welcome_title", "login_welcome_message"]) {
      expect(PUBLIC_THEME_KEYS as readonly string[]).toContain(k);
      expect(THEME_EDITABLE_KEYS as readonly string[]).toContain(k);
    }
  });
});

describe("lo que guarda el administrador", () => {
  it("valida colores, imágenes y textos; ignora claves ajenas; vacío vuelve al predeterminado", () => {
    expect(
      cleanThemeValues({ theme_primary_color: "#0a7d5a", login_background_url: "none", login_welcome_title: "  Bienvenida  ", brand_logo_url: "", smtp_password: "secreto", brand_show_powered_by: "false" }),
    ).toEqual({ theme_primary_color: "#0a7d5a", login_background_url: "none", login_welcome_title: "Bienvenida", brand_logo_url: "" });
    const bad: Array<[string, string]> = [
      ["theme_primary_color", "red; background:url(javascript:alert(1))"],
      ["theme_accent_color", "#12345"],
      ["brand_logo_url", "javascript:alert(1)"],
      ["brand_logo_url", "http://inseguro.example/logo.png"],
      ["brand_favicon_url", "data:image/png;base64,AAAA"],
      ["brand_hero_image_url", "https://x.example/a.jpg\" onload=\"x"],
      ["login_background_url", "url(https://x.example/a.jpg)"],
      ["login_welcome_title", "<img src=x onerror=alert(1)>"],
      ["login_welcome_title", "x".repeat(81)],
      ["login_welcome_message", "y".repeat(241)],
      ["theme_font_family", "x; } body { display:none"],
    ];
    for (const [k, v] of bad) expect(() => cleanThemeValues({ [k]: v }), `${k}=${v}`).toThrow(ThemeValueError);
  });
});

describe("aspecto del acceso (contraste y valores predeterminados)", () => {
  const multi = (o: Record<string, unknown> = {}) => ({ neutralSite: true, brandName: "Skibox", logoUrl: null, ...o });

  it("contraste WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("oklch(0.5 0.1 200)", "#ffffff")).toBeNull();
    expect(readableOn("#ffeb3b")).toBe(NEUTRAL_INK);
    expect(readableOn("#0b3d91")).toBe("#ffffff");
  });

  it("sin ninguna personalización: identidad predeterminada de Big Elephant (decisión 23/10/2026), con el nombre de la empresa", () => {
    const l = loginLook(multi());
    expect(l).toMatchObject({ panelBg: BIG_ELEPHANT.ink, panelFg: "#ffffff", highlight: BIG_ELEPHANT.red, button: BIG_ELEPHANT.redInk, buttonFg: "#ffffff", link: BIG_ELEPHANT.redInk, backgroundUrl: null });
    expect(l.brand).toMatchObject({ logoUrl: "https://www.bigelephant.es/brand/big-elephant-logo.png", logoAlt: "Big Elephant", name: "Skibox" });
    expect(l.title).toBe("Te damos la bienvenida a Skibox");
    expect(JSON.stringify(l)).not.toMatch(/N[ÁA]YADE|skicenter/i);
    // Contraste: texto del botón y enlaces sobre blanco ≥ 4,5:1; resaltado del titular sobre el panel ≥ 3:1
    expect(contrastRatio(l.buttonFg, l.button)!).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(l.link, "#ffffff")!).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(l.highlight, l.panelBg)!).toBeGreaterThanOrEqual(3);
  });

  it("muestra del color en el editor: el color en uso (nunca un blanco que no existe) y aviso de formato", () => {
    expect(colorFieldState("", BIG_ELEPHANT.redInk)).toEqual({ swatch: BIG_ELEPHANT.redInk, note: `Sin elegir: se usa el color predeterminado (${BIG_ELEPHANT.redInk}).`, error: null });
    expect(colorFieldState("#1F3A5F", "#000000")).toEqual({ swatch: "#1f3a5f", note: null, error: null });
    expect(colorFieldState("#abc", "#000000").swatch).toBe("#aabbcc");
    const bad = colorFieldState("azul", "#d0161c");
    expect(bad.swatch).toBe("#d0161c");
    expect(bad.error).toMatch(/^Escribe el color con #/);
  });

  it("con cualquier personalización propia (logotipo, color o fondo) conserva lo suyo, nunca Big Elephant", () => {
    for (const o of [{ logoUrl: "https://cdn.example/skibox.png" }, { primaryColor: "#0b3d91" }, { accentColor: "#f5a623" }, { login: { backgroundUrl: "https://cdn.example/f.jpg", title: null, message: null } }]) {
      const l = loginLook(multi(o));
      expect(l.brand.logoUrl, JSON.stringify(o)).not.toBe(BIG_ELEPHANT.logoUrl);
      expect(l.button, JSON.stringify(o)).not.toBe(BIG_ELEPHANT.redInk);
    }
    expect(loginLook(multi({ logoUrl: "https://cdn.example/skibox.png" })).brand.logoUrl).toBe("https://cdn.example/skibox.png");
  });

  it("color principal legible: panel, botón y enlaces de la empresa; acento solo si se lee", () => {
    const l = loginLook(multi({ primaryColor: "#0b3d91", accentColor: "#f5a623" }));
    expect(l).toMatchObject({ panelBg: "#0b3d91", panelFg: "#ffffff", button: "#0b3d91", buttonFg: "#ffffff", link: "#0b3d91", highlight: "#f5a623" });
    expect(loginLook(multi({ primaryColor: "#0b3d91", accentColor: "#123f8f" })).highlight).toBe("#ffffff");
  });

  it("color principal claro: texto oscuro en el panel; botón y enlaces en grafito (contraste insuficiente sobre blanco)", () => {
    const l = loginLook(multi({ primaryColor: "#ffeb3b" }));
    expect(l).toMatchObject({ panelBg: "#ffeb3b", panelFg: NEUTRAL_INK, button: NEUTRAL_INK, link: NEUTRAL_INK });
    for (const [fg, bg, min] of [[l.panelFg, l.panelBg, 4.5], [l.buttonFg, l.button, 4.5], [l.link, "#ffffff", 4.5]] as const) expect(contrastRatio(fg, bg)!).toBeGreaterThanOrEqual(min);
  });

  it("con imagen de fondo, texto blanco sobre velo; textos propios sin resaltado; marca de plataforma solo como «Plataforma»", () => {
    const l = loginLook(multi({ primaryColor: "#ffeb3b", login: { backgroundUrl: HERO, title: "Hola equipo", message: "Entra aquí" }, poweredBy: { label: "Plataforma Big Elephant", url: "https://bigelephant.es" } }));
    expect(l).toMatchObject({ backgroundUrl: HERO, panelFg: "#ffffff", title: "Hola equipo", titleHighlight: "", message: "Entra aquí" });
    expect(l.poweredBy?.label).toBe("Plataforma Big Elephant");
  });

  it("colores no hexadecimales no se usan en el acceso (no se puede comprobar su contraste)", () => {
    expect(loginLook(multi({ primaryColor: "rgb(255,255,0)" })).panelBg).toBe(NEUTRAL_INK);
  });

  it("instalación única (Náyade): sus colores y textos de siempre", () => {
    const l = loginLook({ neutralSite: false, brandName: null, logoUrl: null });
    expect(l).toMatchObject({ title: "Panel de Administración", titleHighlight: "Administración", panelBg: "#0d1b2a", highlight: "#f5a623" });
    expect(l.brand.name).toBe("NÁYADE");
  });
});

describe("formulario de acceso", () => {
  it("mensajes claros de validación", () => {
    expect(validateLogin("", "")).toEqual({ email: "Escribe tu correo electrónico.", password: "Escribe tu contraseña." });
    expect(validateLogin("ana@", "x").email).toMatch(/formato/);
    expect(validateLogin(" ana@empresa.es ", "x")).toEqual({});
    expect(validateEmail("ana@empresa.es")).toBeUndefined();
  });

  it("errores del servidor en lenguaje llano y sin detalles internos", () => {
    expect(loginErrorMessage(401, "Credenciales incorrectas")).toBe("Credenciales incorrectas");
    expect(loginErrorMessage(401, undefined)).toMatch(/no son correctos/);
    expect(loginErrorMessage(429, "x")).toMatch(/Demasiados intentos/);
    expect(loginErrorMessage(500, "ECONNREFUSED 10.0.0.1:3306")).not.toMatch(/ECONN|10\.0/);
  });
});

describe("Primeros pasos: paso «Marca»", () => {
  it("va tras los datos de la empresa y el tipo de actividad; un progreso guardado sin él lo lee pendiente y conserva lo demás", () => {
    expect(SETUP_STEPS.indexOf("brand")).toBe(SETUP_STEPS.indexOf("activity") + 1);
    const old = JSON.stringify({ version: 1, steps: { company: { status: "done", at: 1 }, activity: { status: "done", at: 2 } }, completedAt: null, updatedAt: 2 });
    const p = parseProgress(old);
    expect(p.steps.company.status).toBe("done");
    expect(p.steps.brand.status).toBe("pending");
    expect(nextPendingStep(p)).toBe("brand");
    const done = markStep(p, "brand", "done", 3);
    expect(nextPendingStep(done)).toBe("web");
    // Progreso anterior: bienvenida dada por vista y «Empresa» incluía los datos fiscales → 5 resueltos («users» no cuenta)
    expect(progressPercent(done)).toBe(Math.round((5 / (SETUP_STEPS.length - 1)) * 100));
    // Una empresa que ya terminó el asistente lo sigue teniendo terminado
    expect(parseProgress(JSON.stringify({ version: 1, steps: {}, completedAt: 5, updatedAt: 5 })).completedAt).toBe(5);
  });
});
