import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

// ─── SEO meta injection for key public routes ────────────────────────────────
// For each known route we replace the placeholders in the built index.html so
// that crawlers (including Meta/WhatsApp) see route-specific title, description,
// canonical and Open Graph tags without executing JavaScript.
// Unknown routes fall back to the home-page meta defined in index.html itself.

const BASE_URL = "https://nayadeexperiences.es";

interface RouteMeta {
  title: string;
  description: string;
  h1: string;
  body: string;
}

const SEO_ROUTES: Record<string, RouteMeta> = {
  "/": {
    title: "Náyade Experiences | Actividades, Spa, Hotel y Restaurantes en Segovia",
    description: "Náyade Experiences ofrece actividades, experiencias acuáticas, spa, hotel y restauración en Los Ángeles de San Rafael, Segovia.",
    h1: "Náyade Experiences",
    body: "Actividades, experiencias, restauración y ocio en Los Ángeles de San Rafael, Segovia.",
  },
  "/experiencias": {
    title: "Experiencias y Actividades | Náyade Experiences",
    description: "Descubre todas las experiencias y actividades: deportes, aventura, bienestar y más en Los Ángeles de San Rafael, Segovia.",
    h1: "Experiencias y Actividades",
    body: "Explora nuestra selección de experiencias y actividades en Los Ángeles de San Rafael.",
  },
  "/restaurantes": {
    title: "Restaurantes | Náyade Experiences",
    description: "Restaurantes de Náyade Experiences en Los Ángeles de San Rafael. Cocina con productos locales y menús de temporada.",
    h1: "Restaurantes",
    body: "Gastronomía y restauración en Los Ángeles de San Rafael, Segovia.",
  },
  "/hotel": {
    title: "Hotel | Náyade Experiences",
    description: "Alójate en el hotel de Náyade Experiences en Los Ángeles de San Rafael, Segovia. Habitaciones con encanto en plena naturaleza.",
    h1: "Hotel",
    body: "Alojamiento con encanto en Los Ángeles de San Rafael, Segovia.",
  },
  "/spa": {
    title: "Spa y Bienestar | Náyade Experiences",
    description: "Spa y tratamientos de bienestar en Los Ángeles de San Rafael, Segovia. Relax en plena naturaleza.",
    h1: "Spa y Bienestar",
    body: "Tratamientos, masajes y bienestar en Los Ángeles de San Rafael, Segovia.",
  },
  "/contacto": {
    title: "Contacto | Náyade Experiences",
    description: "Contacta con Náyade Experiences en Los Ángeles de San Rafael, Segovia. Reservas, información y atención al cliente.",
    h1: "Contacto",
    body: "Ponte en contacto con nosotros para reservas e información.",
  },
};

function resolveRouteMeta(pathname: string): { meta: RouteMeta; canonical: string } {
  // Exact match
  if (SEO_ROUTES[pathname]) {
    const canonical = pathname === "/" ? BASE_URL : `${BASE_URL}${pathname}`;
    return { meta: SEO_ROUTES[pathname], canonical };
  }
  // Parent-path match — e.g. /experiencias/slug → /experiencias
  const parent = "/" + (pathname.split("/")[1] ?? "");
  if (SEO_ROUTES[parent]) {
    return { meta: SEO_ROUTES[parent], canonical: `${BASE_URL}${parent}` };
  }
  // Default: home meta, canonical = requested URL
  return { meta: SEO_ROUTES["/"], canonical: `${BASE_URL}${pathname}` };
}

// Cache the built index.html so we only read it from disk once per process.
let _htmlCache: string | null = null;

function injectSeoMeta(html: string, pathname: string): string {
  const { meta, canonical } = resolveRouteMeta(pathname);

  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"/,
      `<meta name="description" content="${meta.description}"`
    )
    .replace(
      /<link rel="canonical" href="[^"]*"/,
      `<link rel="canonical" href="${canonical}"`
    )
    .replace(
      /<meta property="og:url" content="[^"]*"/,
      `<meta property="og:url" content="${canonical}"`
    )
    .replace(
      /<meta property="og:title" content="[^"]*"/,
      `<meta property="og:title" content="${meta.title}"`
    )
    .replace(
      /<meta property="og:description" content="[^"]*"/,
      `<meta property="og:description" content="${meta.description}"`
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"/,
      `<meta name="twitter:title" content="${meta.title}"`
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"/,
      `<meta name="twitter:description" content="${meta.description}"`
    )
    // Replace static fallback content in #root with route-specific text
    .replace(
      /<div id="root">[\s\S]*?<\/div>/,
      `<div id="root"><h1>${meta.h1}</h1><p>${meta.body}</p></div>`
    );
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // SPA fallback: inject route-specific SEO meta before sending index.html
  app.use("*", (req, res) => {
    const indexPath = path.resolve(distPath, "index.html");
    if (!_htmlCache) {
      try {
        _htmlCache = fs.readFileSync(indexPath, "utf-8");
      } catch {
        return res.sendFile(indexPath);
      }
    }
    const html = injectSeoMeta(_htmlCache, req.path || "/");
    res.set("Content-Type", "text/html").send(html);
  });
}
