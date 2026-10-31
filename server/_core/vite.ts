import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { isMultiTenant } from "./tenant";
import { buildTenantMeta, escapeHtml, pageMetaOverride } from "./tenantSeo";
import { defaultPublicRouteDeps, resolvePublicRoute, type PublicRouteDeps } from "./publicRoutes";
import { getSystemSetting } from "../config";

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

// ─── Metadatos SEO del HTML público ──────────────────────────────────────────
// Título, descripción, canonical y Open Graph de la empresa (sus ajustes, `buildTenantMeta`) en cualquier modo, para
// que los rastreadores (también Meta/WhatsApp) los vean sin ejecutar JavaScript. Nunca los de otra instalación.

interface RouteMeta {
  title: string;
  description: string;
  h1: string;
  body: string;
  image?: string;
}

/**
 * HTML de la web de una empresa (multiempresa): sin la etiqueta de Google Analytics de la instalación original,
 * con su nombre como `og:site_name` y marcada para que el cliente no cargue analítica ni pixel ajenos.
 */
export function tenantSiteHtml(html: string, siteName: string): string {
  return html
    .replace(/[ \t]*<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"]*"><\/script>\r?\n?/, "")
    .replace(/<meta property="og:site_name" content="[^"]*"/, `<meta property="og:site_name" content="${siteName}"`)
    .replace(/<meta charset="UTF-8" \/>/, '<meta charset="UTF-8" />\n    <meta name="elephant-tenant-site" content="multi" />');
}

// Cache the built index.html so we only read it from disk once per process.
let _htmlCache: string | null = null;

function injectSeoMeta(
  html: string,
  seo: { meta: RouteMeta; canonical: string },
): string {
  // Metadatos de la empresa, ya escapados
  const { meta, canonical } = seo;
  const imageUrl = meta.image ?? "";

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
      /<meta property="og:image" content="[^"]*"/,
      `<meta property="og:image" content="${imageUrl}"`
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"/,
      `<meta name="twitter:title" content="${meta.title}"`
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"/,
      `<meta name="twitter:description" content="${meta.description}"`
    )
    .replace(
      /<meta name="twitter:image" content="[^"]*"/,
      `<meta name="twitter:image" content="${imageUrl}"`
    )
    // Replace static fallback content in #root with route-specific text
    .replace(
      /<div id="root">[\s\S]*?<\/div>/,
      `<div id="root"><h1>${meta.h1}</h1><p>${meta.body}</p></div>`
    );
}

export function serveStatic(app: Express, opts: { distPath?: string; routeDeps?: (multi: boolean) => PublicRouteDeps } = {}) {
  const distPath =
    opts.distPath ??
    (process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public"));
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // Sin índice automático: la portada también pasa por la inyección de metadatos de la empresa (si no, `/`
  // serviría el index.html con el título vacío)
  app.use(express.static(distPath, { index: false }));

  // SPA fallback: inject route-specific SEO meta before sending index.html
  app.use("*", async (req, res) => {
    const indexPath = path.resolve(distPath, "index.html");
    if (!_htmlCache) {
      try {
        _htmlCache = fs.readFileSync(indexPath, "utf-8");
      } catch {
        return res.sendFile(indexPath);
      }
    }
    // req.path is "/" for all routes under app.use("*") — use originalUrl instead
    const pathname = req.originalUrl.split("?")[0] || "/";
    // Metadatos de la empresa (sus ajustes) en cualquier modo
    {
      const multi = isMultiTenant();
      // 404 real para lo que no existe en la web de la empresa (el cliente muestra su «no encontrada»)
      const deps = (opts.routeDeps ?? defaultPublicRouteDeps)(multi);
      const route = await resolvePublicRoute(pathname, deps);
      const isHome = pathname.replace(/\/+$/, "") === "";
      const [brandName, description, logoUrl, ogImageUrl] = await Promise.all([
        getSystemSetting("brand_name", ""),
        getSystemSetting("seo_description", ""),
        getSystemSetting("brand_logo_url", ""),
        getSystemSetting("seo_og_image_url", ""),
      ]);
      const m = buildTenantMeta({
        settings: { brandName, description, logoUrl, ogImageUrl },
        host: req.headers.host,
        pathname,
      });
      const seo: { meta: RouteMeta; canonical: string } = {
        meta: { title: m.title, description: m.description, h1: m.h1, body: m.body, image: m.image },
        canonical: m.canonical,
      };
      // Página propia de la empresa (portada «inicio» incluida): su título y descripción
      const page = route.page ?? (multi && isHome ? await deps.tenantPage("inicio").catch(() => null) : null);
      if (page) seo.meta = { ...seo.meta, ...pageMetaOverride(page, brandName, isHome, { keepDescription: isHome && !!description.trim() }) };
      // Blog: título, descripción e imagen de la entrada publicada (nunca de un borrador)
      if (pathname === "/blog" || pathname.startsWith("/blog/")) {
        try {
          const { blogMetaForRequest } = await import("../blogSeo");
          const b = await blogMetaForRequest(pathname, brandName);
          if (b) seo.meta = { ...b, image: b.image ?? m.image };
        } catch {
          /* SEO genérico de la empresa */
        }
      }
      let html = injectSeoMeta(_htmlCache, seo);
      if (isMultiTenant()) html = tenantSiteHtml(html, escapeHtml(brandName));
      if (route.status === 404) html = html.replace(/<meta charset="UTF-8" \/>/, '<meta charset="UTF-8" />\n    <meta name="robots" content="noindex" />');
      res.status(route.status).set("Content-Type", "text/html").send(html);
    }
  });
}
