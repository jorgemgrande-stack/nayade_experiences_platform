/**
 * Marketplace premium v2: lectura tolerante de los campos nuevos del canal (medios resueltos, «Cómo funciona»,
 * etiqueta promocional, composición de la ficha, carrusel, cabeceras y activación), elección de la acción principal,
 * carrusel (fechas, orden y destino de producto no comprable → «Ver ficha») y medición (sin datos personales,
 * deduplicada, silenciosa si el canal no la recibe).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseActivation, parseConnectCard, parseMarketplaceHeaders, parseMarketplaceRoot } from "./connectCard";
import { buildConnectCatalog, type ChannelCatalogItem } from "./connectMarketplace";
import { _resetConnectEventsForTests, acceptEvents, forwardEvents, openPathResolver, panelOpenPath } from "./connectShowcase";
import { CommerceError, type CommerceClient } from "./commerceClient";
import { resolveBlocks, SHEET_BLOCK_IDS } from "../shared/connectCard";
import { activationOf, autoplayDelay, chunkEvents, freshEvents, primaryAction, resolveSlides, VIEW_SHEET_LABEL, type ConnectEvent, type ConnectSlide } from "../shared/connectShowcase";
import { CORE_EXTENSION_PANELS } from "../shared/panelExtensions";

const img = (n: string, extra: Record<string, unknown> = {}) => ({ src: `https://cdn.bigelephant.es/${n}.webp`, alt: `Imagen ${n}`, ...extra });

describe("lectura tolerante: medios resueltos", () => {
  it("card, hero, icon: solo https con alt; srcset, medidas y foco opcionales y validados", () => {
    const c = parseConnectCard({
      commercial: {
        media: {
          card: img("tarjeta", { focal: { x: 30, y: 70 }, width: 1200, height: 675, srcset: "https://cdn.bigelephant.es/t-600.webp 600w, https://cdn.bigelephant.es/t-1200.webp 1200w" }),
          hero: img("hero", { mobileSrc: "https://cdn.bigelephant.es/hero-m.webp", focal: { x: 150, y: 10 } }),
          icon: { src: "http://inseguro.es/i.png", alt: "Icono" },
        },
      },
    })!;
    const m = c.commercial!.media!;
    expect(m.card).toMatchObject({ src: "https://cdn.bigelephant.es/tarjeta.webp", alt: "Imagen tarjeta", focal: { x: 30, y: 70 }, width: 1200, height: 675, kind: null });
    expect(m.card!.srcset).toContain("1200w");
    // Foco fuera de rango → sin foco; versión móvil https → se acepta
    expect(m.hero).toMatchObject({ focal: null, mobileSrc: "https://cdn.bigelephant.es/hero-m.webp" });
    expect(m.icon).toBeNull();
  });

  it("imágenes como llegan hoy ({src, alt} sin srcset ni medidas) → válidas", () => {
    const m = parseConnectCard({ commercial: { media: { card: img("a"), hero: img("b") } } })!.commercial!.media!;
    expect(m.card).toEqual({ src: "https://cdn.bigelephant.es/a.webp", srcset: null, mobileSrc: null, width: null, height: null, alt: "Imagen a", focal: null, kind: null });
  });

  it("srcset con una fuente no https se descarta entero (la imagen sigue)", () => {
    const m = parseConnectCard({ commercial: { media: { card: img("a", { srcset: "https://cdn.bigelephant.es/a.webp 600w, http://x.es/b.webp 1200w" }) } } })!.commercial!.media!;
    expect(m.card).toMatchObject({ src: "https://cdn.bigelephant.es/a.webp", srcset: null });
  });

  it("sin alt no hay imagen; galería solo con kind screenshot|illustration", () => {
    const m = parseConnectCard({
      commercial: {
        media: {
          card: { src: "https://cdn.bigelephant.es/a.webp", alt: "  " },
          gallery: [img("g1", { kind: "screenshot", caption: "Pie" }), img("g2", { kind: "foto" }), img("g3", { kind: "illustration" }), { src: "javascript:alert(1)", alt: "x", kind: "screenshot" }],
        },
      },
    })!.commercial!.media!;
    expect(m.card).toBeNull();
    expect(m.gallery!.map((g) => [g.alt, g.kind, g.caption])).toEqual([
      ["Imagen g1", "screenshot", "Pie"],
      ["Imagen g3", "illustration", null],
    ]);
  });

  it("vídeo: solo embedUrl normalizado (youtube-nocookie o player.vimeo) y con título", () => {
    const v = (video: unknown) => parseConnectCard({ commercial: { media: { video } } })!.commercial!.media!.video;
    expect(v({ url: "https://youtu.be/abc", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", title: "Demostración" })).toEqual({ embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", title: "Demostración" });
    expect(v({ embedUrl: "https://player.vimeo.com/video/123456", title: "Vídeo" })).not.toBeNull();
    expect(v({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Sin embed" })).toBeNull();
    expect(v({ embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "Dominio con cookies" })).toBeNull();
    expect(v({ embedUrl: "https://player.vimeo.com/video/1", title: "" })).toBeNull();
  });

  it("forma anterior (cover/screenshots) como respaldo: hero y galería (capturas)", () => {
    const items: ChannelCatalogItem[] = [
      {
        key: "connect-x",
        name: "X",
        family: "connect",
        kind: "module",
        metric: null,
        step: null,
        commercialStatus: "available",
        capabilities: [],
        monthly: null,
        purchasable: false,
        card: { commercial: { media: { cover: img("cover"), screenshots: [img("s1", { caption: "Uno" })] } } },
      } as unknown as ChannelCatalogItem,
    ];
    const [i] = buildConnectCatalog({ items }, [], Date.now(), null);
    expect(i.sheet.media.hero).toMatchObject({ src: "https://cdn.bigelephant.es/cover.webp", kind: null });
    expect(i.sheet.media.gallery).toEqual([expect.objectContaining({ src: "https://cdn.bigelephant.es/s1.webp", kind: "screenshot", caption: "Uno" })]);
    // hero/gallery nuevos mandan sobre la forma anterior
    const [j] = buildConnectCatalog({ items: [{ ...items[0], card: { commercial: { media: { hero: img("hero"), cover: img("cover"), gallery: [img("g", { kind: "illustration" })], screenshots: [img("s1")] } } } }] }, [], Date.now(), null);
    expect(j.sheet.media.hero?.src).toContain("hero.webp");
    expect(j.sheet.media.gallery.map((g) => g.kind)).toEqual(["illustration"]);
  });
});

describe("lectura tolerante: contenido y composición", () => {
  it("howItWorks: título ≤60, texto ≤240, como mucho 4, sin pasos incompletos", () => {
    const steps = parseConnectCard({ commercial: { howItWorks: [{ title: "a".repeat(80), text: "b".repeat(300) }, { title: "Solo título" }, { title: "2", text: "t" }, { title: "3", text: "t" }, { title: "4", text: "t" }, { title: "5", text: "t" }] } })!.commercial!.howItWorks!;
    expect(steps).toHaveLength(4);
    expect(steps[0].title).toHaveLength(60);
    expect(steps[0].text).toHaveLength(240);
    expect(steps.map((s) => s.title).slice(1)).toEqual(["2", "3", "4"]);
  });

  it("promoLabel: hasta 30 caracteres; vacío o de otro tipo → null", () => {
    expect(parseConnectCard({ commercial: { promoLabel: "x".repeat(50) } })!.commercial!.promoLabel).toHaveLength(30);
    expect(parseConnectCard({ commercial: { promoLabel: 7 } })!.commercial!.promoLabel).toBeNull();
    expect(parseConnectCard({ commercial: { promoLabel: null } })!.commercial!.promoLabel).toBeNull();
  });

  it("layout: ids desconocidos fuera, enums validados; el orden final respeta el del catálogo y añade los que faltan", () => {
    const l = parseConnectCard({
      commercial: {
        layout: { blocks: [{ id: "faq", visible: true }, { id: "inventado", visible: true }, { id: "problem", visible: false }, { id: "gallery" }, { id: "faq", visible: false }], accentColor: "teal", heroStyle: "cinematic" },
      },
    })!.commercial!.layout!;
    expect(l.accentColor).toBe("teal");
    expect(l.heroStyle).toBeNull();
    expect(l.blocks.map((b) => b.id)).toEqual(["faq", "problem", "gallery", "faq"]);
    const order = resolveBlocks(l);
    expect(order.slice(0, 2)).toEqual(["faq", "gallery"]);
    expect(order).not.toContain("problem");
    // Los que el catálogo no menciona van visibles, en su orden por defecto
    expect(order.slice(2)).toEqual(SHEET_BLOCK_IDS.filter((id) => !["faq", "gallery", "problem"].includes(id)));
    expect(resolveBlocks(null)).toEqual([...SHEET_BLOCK_IDS]);
    expect(parseConnectCard({ commercial: { layout: { accentColor: "fucsia", heroStyle: "plain" } } })!.commercial!.layout).toEqual({ blocks: [], accentColor: null, heroStyle: "plain" });
  });

  it("activación: estado conocido y reintentable; lo raro → null", () => {
    expect(parseActivation({ state: "error", retryable: true, updatedAt: "2026-11-01T10:00:00Z" })).toEqual({ state: "error", retryable: true, updatedAt: "2026-11-01T10:00:00.000Z" });
    expect(parseActivation({ state: "rota" })).toBeNull();
    expect(parseActivation(null)).toBeNull();
    expect(parseActivation({ state: "pending", retryable: "sí" })).toEqual({ state: "pending", retryable: false, updatedAt: null });
  });

  it("cabeceras de marca: brands como objeto, como lista o la forma anterior", () => {
    expect(parseMarketplaceHeaders({ brands: { connect: { title: "C", intro: "I" } } })).toEqual({ connect: { title: "C", intro: "I" } });
    expect(parseMarketplaceHeaders({ brands: [{ id: "net", title: "N", intro: null }, { id: "otra", title: "Z" }] })).toEqual({ net: { title: "N", intro: null } });
    // Forma definitiva del canal: [{key, title, subtitle, background?}]
    expect(parseMarketplaceHeaders({ brands: [{ key: "connect", title: "Connect", subtitle: "Sub", background: img("b") }] })).toEqual({ connect: { title: "Connect", intro: "Sub" } });
    // Lista vacía (lo que llega hoy) → la forma anterior o nada
    expect(parseMarketplaceHeaders({ brands: [], connect: { title: "Antiguo" } })).toEqual({ connect: { title: "Antiguo", intro: null } });
    expect(parseMarketplaceHeaders({ slides: [], settings: { autoplayMs: 6000 }, brands: [] })).toEqual({});
  });
});

const slide = (o: Partial<Record<string, unknown>> & { id: string }) => ({ title: `Título ${o.id}`, background: img(`fondo-${o.id}`), order: 0, tags: [], ...o });

describe("carrusel", () => {
  it("lectura: id y título obligatorios, CTA con destinos válidos, url solo https de *.bigelephant.es", () => {
    const r = parseMarketplaceRoot({
      slides: [
        slide({ id: "a", primaryCta: { label: "Ir", target: { type: "url", value: "https://www.bigelephant.es/connect" } }, secondaryCta: { label: "Mal", target: { type: "url", value: "https://evil.example/bigelephant.es" } } }),
        slide({ id: "b", primaryCta: { label: "Sección", target: { type: "section", value: "net" } }, secondaryCta: { label: "Rara", target: { type: "section", value: "otra" } } }),
        slide({ id: "c", primaryCta: { label: "Categoría", target: { type: "category", value: "connect_bundle" } }, secondaryCta: { label: "Rara", target: { type: "category", value: "inventada" } } }),
        { id: "sin-titulo" },
        slide({ id: "a" }),
        "basura",
      ],
      settings: { autoplayMs: 6000 },
    });
    expect(r.autoplayMs).toBe(6000);
    expect(r.slides.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(r.slides[0].primaryCta?.target.type).toBe("url");
    expect(r.slides.map((s) => s.secondaryCta)).toEqual([null, null, null]);
    expect(r.slides[0].background).toMatchObject({ src: "https://cdn.bigelephant.es/fondo-a.webp", alt: "Imagen fondo-a" });
  });

  it("sin marketplace o con slides vacías → sin carrusel", () => {
    expect(parseMarketplaceRoot(undefined)).toEqual({ slides: [], autoplayMs: null });
    expect(parseMarketplaceRoot({ slides: [], settings: { autoplayMs: 6000 }, brands: [] }).slides).toEqual([]);
  });

  const items = [
    { key: "connect-a", family: "connect", kind: "module" as const, state: "available" as const, purchasable: true },
    { key: "connect-b", family: "connect", kind: "module" as const, state: "on_request" as const, purchasable: false },
  ];
  const now = Date.parse("2026-11-01T12:00:00Z");
  const parsed = (raw: unknown[]) => parseMarketplaceRoot({ slides: raw }).slides as ConnectSlide[];

  it("fechas y orden: fuera de su ventana no sale; se ordena por `order` (empate: el del canal)", () => {
    const s = parsed([
      slide({ id: "tarde", order: 3 }),
      slide({ id: "caducada", order: 1, endsAt: "2026-10-31T00:00:00Z" }),
      slide({ id: "futura", order: 0, startsAt: "2026-11-05T00:00:00Z" }),
      slide({ id: "pronto", order: 1, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }),
      slide({ id: "empate", order: 1 }),
    ]);
    expect(resolveSlides(s, { items, canPurchase: true, now }).map((x) => x.id)).toEqual(["pronto", "empate", "tarde"]);
  });

  it("destino de producto: comprable conserva su texto; no comprable → «Ver ficha»; inexistente → sin llamada", () => {
    const s = parsed([
      slide({ id: "s1", primaryCta: { label: "Contratar ahora", target: { type: "product", value: "connect-a" } } }),
      slide({ id: "s2", primaryCta: { label: "Contratar ahora", target: { type: "product", value: "connect-b" } } }),
      slide({ id: "s3", primaryCta: { label: "Descubre", target: { type: "product", value: "connect-zzz" } } }),
    ]);
    const r = resolveSlides(s, { items, canPurchase: true, now });
    expect(r.map((x) => x.primaryCta)).toEqual([
      { label: "Contratar ahora", nav: { kind: "product", productKey: "connect-a" } },
      { label: VIEW_SHEET_LABEL, nav: { kind: "product", productKey: "connect-b" } },
      null,
    ]);
    // Sin compras abiertas para esta persona (prueba gratuita, rol, compras cerradas): nunca promete contratar
    expect(resolveSlides(s, { items, canPurchase: false, now })[0].primaryCta?.label).toBe(VIEW_SHEET_LABEL);
  });

  it("diapositiva de un producto que ya no está en el catálogo de la empresa → no se muestra", () => {
    const s = parsed([slide({ id: "x", productKey: "connect-zzz" }), slide({ id: "y", productKey: "connect-a" })]);
    expect(resolveSlides(s, { items, canPurchase: true, now }).map((x) => x.id)).toEqual(["y"]);
  });

  it("categoría por familia → filtro de su categoría; secciones conocidas", () => {
    const s = parsed([slide({ id: "c", primaryCta: { label: "Paquetes", target: { type: "category", value: "connect_bundle" } }, secondaryCta: { label: "Míos", target: { type: "section", value: "mine" } } })]);
    const [r] = resolveSlides(s, { items, canPurchase: true, now });
    expect(r.primaryCta?.nav).toEqual({ kind: "category", category: "bundles" });
    expect(r.secondaryCta?.nav).toEqual({ kind: "section", section: "mine" });
  });

  it("rotación: 0 = sin rotación; sin dato, la de por defecto; con límites legibles", () => {
    expect(autoplayDelay(0)).toBe(0);
    expect(autoplayDelay(null)).toBe(7000);
    expect(autoplayDelay(6000)).toBe(6000);
    expect(autoplayDelay(500)).toBe(4000);
    expect(autoplayDelay(90_000)).toBe(30_000);
  });
});

describe("acción principal según el estado real", () => {
  const view = { canPurchase: true, interestEnabled: true };
  const base = { kind: "module" as const, purchasable: true, openPath: null as string | null };
  it("«Contratar y activar» solo si se vende en línea y esta persona puede comprar", () => {
    expect(primaryAction({ ...base, state: "available" }, view)).toEqual({ kind: "purchase", label: "Contratar y activar", href: null });
    // Prueba gratuita, rol o compras cerradas (canPurchase false) → solicitar información
    expect(primaryAction({ ...base, state: "available" }, { ...view, canPurchase: false }).kind).toBe("request");
    expect(primaryAction({ ...base, purchasable: false, state: "available" }, view).label).toBe("Solicitar información");
    expect(primaryAction({ ...base, state: "not_eligible" }, view).kind).toBe("request");
  });
  it("bajo solicitud → «Solicitar información»; próximamente → «Me interesa» (solo con solicitudes)", () => {
    expect(primaryAction({ ...base, state: "on_request" }, view).label).toBe("Solicitar información");
    expect(primaryAction({ ...base, state: "coming_soon" }, view).label).toBe("Me interesa");
    expect(primaryAction({ ...base, state: "coming_soon" }, { ...view, interestEnabled: false }).kind).toBe("none");
  });
  it("contratado → «Abrir módulo» con su ruta real; sin ruta, «Gestionar»", () => {
    expect(primaryAction({ ...base, state: "active", openPath: "/admin/personal" }, view)).toEqual({ kind: "open", label: "Abrir módulo", href: "/admin/personal" });
    expect(primaryAction({ ...base, state: "active" }, view)).toMatchObject({ kind: "manage", label: "Gestionar" });
    expect(primaryAction({ ...base, state: "pending_setup", openPath: "/admin/personal" }, view)).toMatchObject({ kind: "manage", href: "/admin/personal" });
    expect(primaryAction({ ...base, state: "pending_setup" }, view).kind).toBe("contact");
    expect(primaryAction({ ...base, state: "incident" }, view).kind).toBe("contact");
    expect(primaryAction({ ...base, state: "activating" }, view).kind).toBe("none");
  });
  it("nunca promete contratar fuera de «Disponible»", () => {
    for (const state of ["active", "pending_setup", "activating", "not_eligible", "on_request", "coming_soon", "incident"] as const) {
      expect(primaryAction({ ...base, state }, view).kind).not.toBe("purchase");
    }
  });
  it("activación mostrada: licencias activas mandan; si no, el canal; si no, el estado", () => {
    expect(activationOf({ state: "active", activation: { state: "error", retryable: true, updatedAt: null } }).state).toBe("active");
    expect(activationOf({ state: "activating", activation: { state: "error", retryable: true, updatedAt: null } })).toMatchObject({ state: "error", retryable: true });
    expect(activationOf({ state: "pending_setup", activation: null }).state).toBe("pending");
    expect(activationOf({ state: "activating" }).state).toBe("processing");
    expect(activationOf({ state: "incident" }).state).toBe("error");
    expect(activationOf({ state: "available", activation: { state: "none", retryable: false, updatedAt: null } }).state).toBe("none");
  });
  it("ruta real del módulo: la portada de su entrada de menú (People → /admin/personal)", () => {
    const resolve = openPathResolver(Object.values(CORE_EXTENSION_PANELS).map((x) => ({ capability: x.capability, panel: x.panel })));
    expect(resolve(["people-hr"])).toBe("/admin/personal");
    expect(resolve(["capacidad-inexistente"])).toBeNull();
    expect(panelOpenPath(null)).toBeNull();
  });
});

describe("medición", () => {
  const ev = (o: Partial<ConnectEvent> = {}): ConnectEvent => ({ id: crypto.randomUUID(), type: "card_view", productKey: "connect-a", at: new Date().toISOString(), ...o });
  beforeEach(() => _resetConnectEventsForTests());

  it("descarta eventos de más de 24 h y repetidos; lotes de 50", () => {
    const now = Date.now();
    const old = ev({ at: new Date(now - 25 * 3600_000).toISOString() });
    const a = ev();
    expect(freshEvents([old, a, { ...a }, ev({ productKey: "connect-a" })], now)).toEqual([a]);
    expect(chunkEvents(Array.from({ length: 120 }, (_, i) => i)).map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it("servidor: una vez por sesión y producto; otra persona cuenta aparte", () => {
    const now = Date.now();
    expect(acceptEvents("s1", [ev()], now)).toHaveLength(1);
    expect(acceptEvents("s1", [ev()], now + 1000)).toHaveLength(0);
    expect(acceptEvents("s1", [ev({ type: "sheet_view" })], now)).toHaveLength(1);
    expect(acceptEvents("s2", [ev()], now)).toHaveLength(1);
    // Pasada la sesión se vuelve a contar
    expect(acceptEvents("s1", [ev({ at: new Date(now + 31 * 60_000).toISOString() })], now + 31 * 60_000)).toHaveLength(1);
  });

  it("envío sin datos personales; 404 → silencio (y no se reintenta enseguida)", async () => {
    const calls: unknown[] = [];
    const client = { events: vi.fn(async (_t: string, e: unknown) => void calls.push(e)) } as unknown as CommerceClient;
    const e = [ev(), ev({ type: "slide_view", productKey: undefined, slideId: "s1" })];
    expect(await forwardEvents(client, "t1", e, Date.now())).toBe(2);
    expect(JSON.stringify(calls)).not.toMatch(/@|email|user|name/i);
    const missing = { events: vi.fn(async () => Promise.reject(new CommerceError(404, "error", "No se pudo completar la operación"))) } as unknown as CommerceClient;
    await expect(forwardEvents(missing, "t1", e, Date.now())).resolves.toBe(0);
    await forwardEvents(missing, "t1", e, Date.now() + 1000);
    expect(missing.events).toHaveBeenCalledTimes(1);
    const failing = { events: vi.fn(async () => Promise.reject(new Error("caído"))) } as unknown as CommerceClient;
    _resetConnectEventsForTests();
    await expect(forwardEvents(failing, "t1", e, Date.now())).resolves.toBe(0);
    await expect(forwardEvents(null, "t1", e, Date.now())).resolves.toBe(0);
  });
});

describe("activación del canal y acción (compra en curso, rechazada o vigente)", () => {
  const view = { canPurchase: true, interestEnabled: true };
  const base = { kind: "module" as const, purchasable: true, state: "available" as const };
  const act = (state: "none" | "pending" | "processing" | "active" | "error", retryable = false) => ({ state, retryable, updatedAt: null });
  it("pendiente, procesando o ya en el pedido vigente: nunca se ofrece comprar otra vez", () => {
    for (const s of ["pending", "processing", "active"] as const) expect(primaryAction({ ...base, activation: act(s) }, view).kind).toBe("none");
  });
  it("rechazada y reintentable: «Reintentar la contratación» por el mismo flujo, solo si ahora se puede comprar", () => {
    expect(primaryAction({ ...base, activation: act("error", true) }, view)).toEqual({ kind: "purchase", label: "Reintentar la contratación", href: null });
    expect(primaryAction({ ...base, activation: act("error", true) }, { ...view, canPurchase: false }).kind).toBe("request");
    expect(primaryAction({ ...base, activation: null }, view).label).toBe("Contratar y activar");
  });
  it("updatedAt numérico (ms) del canal → fecha ISO", () => {
    expect(parseActivation({ state: "active", retryable: false, updatedAt: Date.UTC(2026, 10, 1) })?.updatedAt).toBe("2026-11-01T00:00:00.000Z");
  });
  it("carrusel: un producto con compra en curso tampoco se promete", () => {
    const s = parseMarketplaceRoot({ slides: [{ id: "x", title: "T", primaryCta: { label: "Contratar", target: { type: "product", value: "connect-a" } } }] }).slides;
    const items = [{ key: "connect-a", family: "connect", kind: "module" as const, state: "available" as const, purchasable: true, activation: act("pending") }];
    expect(resolveSlides(s, { items, canPurchase: true, now: Date.now() })[0].primaryCta?.label).toBe(VIEW_SHEET_LABEL);
  });
});

describe("carrusel con la forma definitiva del canal (#580)", () => {
  it("sin `order`: se respeta el orden de llegada; overlay none|light|dark; fechas null", () => {
    const raw = ["c", "a", "b"].map((id) => ({ id, title: `T${id}`, subtitle: "", description: "", background: { src: `https://cdn.bigelephant.es/${id}.webp`, alt: "Fondo", position: "center" }, overlay: "dark", primaryCta: { label: "Ver", target: { type: "section", value: "connect" } }, startsAt: null, endsAt: null, tags: [] }));
    const r = parseMarketplaceRoot({ slides: raw, settings: { autoplayMs: 6000 }, brands: [] });
    expect(r.slides.map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(r.slides[0]).toMatchObject({ overlay: 0.6, startsAt: null, endsAt: null, subtitle: null });
    expect(resolveSlides(r.slides, { items: [], canPurchase: true, now: Date.now() }).map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});
