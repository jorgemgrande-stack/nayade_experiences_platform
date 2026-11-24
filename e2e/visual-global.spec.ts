/**
 * Comparación visual (base global): Inicio, Clientes, Productos y Facturación, en escritorio y móvil, con datos
 * ficticios y SIN backend (tRPC simulado en el navegador). Las capturas van a la carpeta de VISUAL_OUT con la etiqueta
 * de VISUAL_TAG (antes | despues):
 *
 *   VISUAL_TAG=despues VISUAL_OUT=../auditoria_ux_panel/visual-global pnpm exec playwright test e2e/visual-global.spec.ts
 */
import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const TAG = process.env.VISUAL_TAG ?? "despues";
const OUT = path.resolve(process.env.VISUAL_OUT ?? "test-results/visual-global");
fs.mkdirSync(OUT, { recursive: true });

const DAY = 86_400_000;
const NOW = Date.now();
const CAPS = [
  "crm-contacts", "crm-accounts", "crm-activity", "crm-tags", "crm-leads", "crm-quotes", "crm-tasks",
  "shop-catalog", "shop-variants", "shop-store", "shop-checkout", "shop-orders", "shop-coupons",
  "cms-editor", "cms-domain", "cms-pages-forms", "cms-blog", "cms-seo",
  "bill-invoices", "bill-series", "bill-taxes", "bill-payments", "bill-cash", "bill-reports",
  "admin-panel", "admin-users", "tax-filings", "comms-email", "comms-whatsapp-links", "auto-basic",
];
const overview = {
  mode: "multi", licensing: "capabilities", plan: { key: "essential", name: "Essential" }, state: "trial",
  trial: { endsAt: NOW + 6 * DAY, daysLeft: 6 },
  capabilities: CAPS.map((id) => ({ id, name: id, tier: "essential", group: id.split("-")[0], writable: true })),
  visible: CAPS, readOnly: [],
  limits: [{ metric: "users", label: "Usuarios", included: 3, used: 1 }],
  upgradeUrl: "https://elephant.example/planes",
};
const steps = ["welcome", "company", "fiscal", "brand", "activity", "client", "product", "web", "operation", "comms", "finish"];
const doneSet = new Set(["welcome", "company", "fiscal", "client"]);
const plan = { steps: steps.map((id) => ({ id, status: doneSet.has(id) ? "done" : "pending", recommended: false, byData: false })), hidden: ["sector"], nextStep: "brand", percent: 36, done: doneSet.size, total: steps.length, completedAt: null };
const wizard = {
  progress: { version: 1, steps: Object.fromEntries(steps.map((id) => [id, { status: doneSet.has(id) ? "done" : "pending", at: null }])), completedAt: null, updatedAt: NOW },
  nextStep: "brand", percent: 36, plan,
  facts: { identity: true, fiscal: true, brand: false, activity: false, clients: 4, products: 2, quotes: 0, comms: false },
  company: { tradeName: "Casa Ejemplo", legalName: "Casa Ejemplo SL", taxId: "B00000000", address: "", postalCode: "", city: "", province: "", country: "ES", currency: "EUR", timezone: "Europe/Madrid", publicPhone: "", publicEmail: "", publicLocation: "" },
  comms: { fromName: "", replyTo: "", whatsapp: "" }, activity: null, profile: null, activities: ["servicios"], sectorModules: [],
  seats: { used: 1, limit: 3 }, licence: { plan: "essential", userLimit: 3, endsAt: null, daysLeft: 6, readOnly: false }, fiscalFromRegistry: true,
};

const NAMES = [
  ["Marta Ruiz Olmedo", "marta.ruiz@ejemplo.invalid", "+34 600 111 222", "Sevilla", null],
  ["Estudio Alba Verde SL", "hola@albaverde.example", "+34 955 000 321", "Cádiz", "Estudio Alba Verde SL"],
  ["Daniel Fischer", "daniel.fischer@ejemplo.invalid", "+49 170 555 0101", "München", null],
  ["Laura Gómez Prieto", "laura.gomez@ejemplo.invalid", "+34 611 222 333", "Zahora", null],
  ["Retiros del Sur SC", "info@retirosdelsur.example", "+34 956 777 888", "Conil", "Retiros del Sur SC"],
  ["Julia Hartmann", "julia.hartmann@ejemplo.invalid", null, "Berlin", null],
  ["Pablo Navarro Díaz", "pablo.navarro@ejemplo.invalid", "+34 622 333 444", "Málaga", null],
] as const;
const clients = NAMES.map((n, i) => ({ id: i + 1, name: n[0], email: n[1], phone: n[2], company: n[4], nif: n[4] ? `B1234567${i}` : null, city: n[3], createdAt: new Date(NOW - (i + 1) * 3 * DAY).toISOString() }));

const data: Record<string, unknown> = {
  "auth.me": { id: 1, openId: "o", name: "Jorge Grande", email: "jorge@empresa.example", role: "admin" },
  "subscription.overview": overview,
  "subscription.conversionStatus": { enabled: false },
  "config.getPublicSettings": { brand_name: "Casa Ejemplo", panel_install_mode: "multi" },
  "config.listFeatureFlags": [],
  "modules.active": { modules: [], navigation: [] },
  "panel.navigation": { entries: [], routes: [] },
  "notifications.feed": { totalAlerts: 5, sections: [
    { kind: "lead", label: "Solicitudes nuevas", total: 3, severity: "warning", ctaAllPath: "/admin/crm?tab=leads", items: [] },
    { kind: "quote", label: "Presupuestos sin respuesta", total: 2, severity: "info", ctaAllPath: "/admin/crm?tab=quotes", items: [] },
  ] },
  "crmTasks.summary": { minePending: 4, mineOverdue: 1 },
  "setupWizard.status": wizard,
  "coreHome.indicators": {
    sales: { today: { amount: 240, count: 2 }, month: { amount: 3180.5, count: 14 } },
    unpaidInvoices: { count: 3, amount: 1120 }, awaitingQuotes: { count: 5, amount: 4890 }, newClients: { count: 7 }, pendingOnlineOrders: { count: 0 },
  },
  "coreHome.recentActivity": { items: [
    { kind: "sale", title: "Venta en caja · ticket 0042", detail: "Marta Ruiz Olmedo", at: NOW - 40 * 60_000, href: "/admin/crm" },
    { kind: "quote", title: "Presupuesto PRES-2026-0031 enviado", detail: "Estudio Alba Verde SL", at: NOW - 3 * 3600_000, href: "/admin/crm" },
    { kind: "client", title: "Cliente nuevo", detail: "Daniel Fischer", at: NOW - 26 * 3600_000, href: "/admin/crm/clientes/3" },
    { kind: "lead", title: "Solicitud web", detail: "Laura Gómez Prieto", at: NOW - 30 * 3600_000, href: "/admin/crm" },
  ] },
  "crm.clients.list": { items: clients, total: clients.length },
  "crm.clients.stats": { total: 7, companies: 2, individuals: 5, newThisMonth: 4 },
  "crmTags.list": [{ id: 1, name: "VIP", color: "#b99a73" }, { id: 2, name: "Retiro 2027", color: "#4f8ef7" }],
  "crmTags.forEntities": { 1: [{ id: 1, name: "VIP", color: "#b99a73" }], 2: [{ id: 2, name: "Retiro 2027", color: "#4f8ef7" }], 4: [{ id: 1, name: "VIP", color: "#b99a73" }, { id: 2, name: "Retiro 2027", color: "#4f8ef7" }] },
  "crm.clients.getHistory": {
    client: { ...clients[1], id: 2, address: "Calle del Mar 12", postalCode: "11004", country: "ES", leadId: null, notes: "Prefiere contacto por correo. Facturar a la sociedad." },
    quotes: [{ id: 31, quoteNumber: "PRES-2026-0031", title: "Retiro de bienestar · 5 noches", total: "1890.00", status: "enviado", createdAt: new Date(NOW - 3 * DAY).toISOString() }],
    reservations: [{ id: 12, reservationNumber: "RES-0012", productName: "Retiro de primavera", amountTotal: 94500, amountPaid: 94500, status: "paid", channel: "ONLINE_ASISTIDO", paymentMethod: "transferencia", createdAt: new Date(NOW - 12 * DAY).toISOString(), paidAt: new Date(NOW - 11 * DAY).toISOString() }],
    invoices: [{ id: 5, invoiceNumber: "FAC-2026-0005", total: "945.00", status: "cobrada", reservationId: 12, issuedAt: new Date(NOW - 11 * DAY).toISOString(), createdAt: new Date(NOW - 11 * DAY).toISOString(), paymentMethod: "transferencia" }],
    tpvTickets: {}, emails: [{ id: 1, subject: "Confirmación de su reserva", recipientEmail: "hola@albaverde.example", status: "sent", createdAt: new Date(NOW - 12 * DAY).toISOString() }], lead: null,
  },
  "crm.clients.notes": { available: true, items: [{ id: 1, body: "Interesada en el retiro de otoño; llamar la semana que viene.", authorName: "Jorge Grande", createdAt: new Date(NOW - 5 * DAY).toISOString() }] },
  "crmTasks.list": { rows: [
    { id: 1, title: "Enviar propuesta del retiro de otoño", status: "pendiente", dueDate: new Date(NOW + 2 * DAY).toISOString() },
    { id: 2, title: "Confirmar alojamiento", status: "hecha", dueDate: null },
  ] },
  "customerEmail.deliveryStatus": null,
};


// Economía y Administración (feat/ux2-economia-admin): datos ficticios mínimos para que las pantallas rendericen
const usr = (i: number, n: string, role: string, active = true) => ({ id: i, name: n, email: n.toLowerCase().replace(/[^a-z]+/g, ".") + "@ejemplo.invalid", role, isActive: active, createdAt: new Date(NOW - i * 20 * DAY).toISOString(), lastSignedIn: new Date(NOW - i * DAY).toISOString(), loginMethod: "email", openId: "o" + i });
Object.assign(data, {
  "admin.getUsers": [usr(1, "Jorge Grande", "admin"), usr(2, "Marta Ruiz", "agent"), usr(3, "Daniel Fischer", "user"), usr(4, "Laura Gómez", "agent", false)],
  "admin.getRbacStatus": { available: false },
  "gestoria.obligations.list": [
    { id: 1, model: "303", name: "IVA 1T", period: "1T", dueDate: new Date(NOW + 5 * DAY).toISOString(), status: "pendiente" },
    { id: 2, model: "111", name: "Retenciones 1T", period: "1T", dueDate: new Date(NOW - 3 * DAY).toISOString(), status: "pagado" },
  ],
  "gestoria.dossiers.list": [], "gestoria.access.list": [],
});

const products = [
  ["Retiro de bienestar · 5 noches", "Retiros", 189000, true, true], ["Taller de respiración consciente", "Talleres", 4500, true, false],
  ["Sesión individual de coaching", "Sesiones", 9000, true, false], ["Escapada de otoño en Berchtesgaden", "Viajes", 129000, false, false],
  ["Formación: fundamentos", "Formación", 24900, true, true], ["Pack bienestar (3 sesiones)", "Packs", 24000, true, false],
].map((p, i) => ({ id: i + 1, title: p[0], slug: "p" + i, categoryId: 1, category: { id: 1, name: p[1] }, categoryName: p[1], basePrice: p[2], price: p[2], isActive: p[3], isFeatured: p[4], image1: null, duration: "1 día", difficulty: "all", sortOrder: i, taxRate: 21 }));
const inv = (i: number, n: string, t: number, st: string, ty = "factura") => ({ id: i, invoiceNumber: (ty === "abono" ? "AB-2026-" : "FAC-2026-") + String(i).padStart(4, "0"), invoiceType: ty, clientName: n, clientEmail: n.toLowerCase().replace(/[^a-z]+/g, ".") + "@ejemplo.invalid", total: t, subtotal: +(t / 1.21).toFixed(2), tax: +(t - t / 1.21).toFixed(2), status: st, paymentMethod: "transferencia", paymentMethodShown: "transferencia", createdAt: new Date(NOW - i * 2 * DAY).toISOString(), pdfUrl: null });
Object.assign(data, {
  "crm.quotes.list": { rows: [
    { id: 1, quoteNumber: "PRES-2026-0031", title: "Retiro de bienestar · 5 noches", status: "enviado", total: 1890, clientId: 2, clientName: "Estudio Alba Verde SL", clientEmail: "hola@albaverde.example", createdAt: new Date(NOW - 3 * DAY).toISOString(), sentAt: new Date(NOW - 2 * DAY).toISOString(), viewedAt: null, paidAt: null },
    { id: 2, quoteNumber: "PRES-2026-0030", title: "Taller de respiración", status: "borrador", total: 450, clientId: 1, clientName: "Marta Ruiz Olmedo", clientEmail: "marta.ruiz@ejemplo.invalid", createdAt: new Date(NOW - 5 * DAY).toISOString() },
    { id: 3, quoteNumber: "PRES-2026-0029", title: "Escapada de otoño", status: "aceptado", total: 1290, clientId: 3, clientName: "Daniel Fischer", clientEmail: "daniel@ejemplo.invalid", createdAt: new Date(NOW - 9 * DAY).toISOString(), paidAt: new Date(NOW - 7 * DAY).toISOString() },
  ], total: 3 },
  "crm.reservations.list": { rows: [
    { id: 1, reservationNumber: "RES-0012", customerName: "Estudio Alba Verde SL", customerEmail: "hola@albaverde.example", productName: "Retiro de primavera", amountTotal: 94500, amountPaid: 94500, status: "paid", channel: "ONLINE_ASISTIDO", paymentMethod: "transferencia", createdAt: new Date(NOW - 12 * DAY).toISOString(), paidAt: new Date(NOW - 11 * DAY).toISOString(), invoiceNumber: "FAC-2026-0005", invoicePdfUrl: null },
    { id: 2, reservationNumber: "RES-0013", customerName: "Daniel Fischer", customerEmail: "daniel@ejemplo.invalid", productName: "Sesión individual", amountTotal: 9000, amountPaid: 0, status: "pending_payment", channel: "TELEFONO", createdAt: new Date(NOW - 2 * DAY).toISOString() },
  ], total: 2 },
  "products.getAll": products,
  "products.getCategories": [{ id: 1, name: "Retiros", slug: "retiros" }],
  "products.getLocations": [],
  "crm.invoices.listAll": { items: [inv(9, "Estudio Alba Verde SL", 945, "cobrada"), inv(8, "Marta Ruiz Olmedo", 240, "emitida"), inv(7, "Daniel Fischer", 1890, "cobrada"), inv(6, "Retiros del Sur SC", 520.5, "vencida"), inv(5, "Laura Gómez Prieto", 90, "cobrada"), inv(4, "Julia Hartmann", 120, "abono", "abono")], total: 6, summary: { subtotal: 3050, grandTotal: 3690.5, tax: 640.5, abonosTotal: 120, netTotal: 3570.5 } },
  "crm.leads.counters": { total: 12, nueva: 5, enviada: 4, ganada: 2, perdida: 1, valorNueva: 3200, valorEnviada: 5400, valorGanada: 2100, valorPerdida: 400 },
});

Object.assign(data, {
  "crm.quotes.list": { rows: [
    { id: 1, quoteNumber: "PRES-2026-0031", title: "Retiro de bienestar · 5 noches", status: "enviado", total: 1890, clientId: 2, clientName: "Estudio Alba Verde SL", clientEmail: "hola@albaverde.example", createdAt: new Date(NOW - 3 * DAY).toISOString(), sentAt: new Date(NOW - 2 * DAY).toISOString(), viewedAt: null, paidAt: null },
    { id: 2, quoteNumber: "PRES-2026-0030", title: "Taller de respiración", status: "borrador", total: 450, clientId: 1, clientName: "Marta Ruiz Olmedo", clientEmail: "marta.ruiz@ejemplo.invalid", createdAt: new Date(NOW - 5 * DAY).toISOString() },
    { id: 3, quoteNumber: "PRES-2026-0029", title: "Escapada de otoño", status: "aceptado", total: 1290, clientId: 3, clientName: "Daniel Fischer", clientEmail: "daniel@ejemplo.invalid", createdAt: new Date(NOW - 9 * DAY).toISOString(), paidAt: new Date(NOW - 7 * DAY).toISOString() },
  ], total: 3 },
  "crm.reservations.list": { rows: [
    { id: 1, reservationNumber: "RES-0012", customerName: "Estudio Alba Verde SL", customerEmail: "hola@albaverde.example", productName: "Retiro de primavera", amountTotal: 94500, amountPaid: 94500, status: "paid", channel: "ONLINE_ASISTIDO", paymentMethod: "transferencia", createdAt: new Date(NOW - 12 * DAY).toISOString(), paidAt: new Date(NOW - 11 * DAY).toISOString(), invoiceNumber: "FAC-2026-0005", invoicePdfUrl: null },
    { id: 2, reservationNumber: "RES-0013", customerName: "Daniel Fischer", customerEmail: "daniel@ejemplo.invalid", productName: "Sesión individual", amountTotal: 9000, amountPaid: 0, status: "pending_payment", channel: "TELEFONO", createdAt: new Date(NOW - 2 * DAY).toISOString() },
  ], total: 2 },
});

// Formularios de Configuración (feat/ux3-economia-formularios): datos ficticios para Correo, Cobros, Integraciones, Dominios y Sedes
const acc = (i: number, n: string, def: boolean, err: string | null = null) => ({ id: i, name: n, email: `info${i}@ejemplo.invalid`, imapHost: "imap.ejemplo.invalid", imapPort: 993, imapSecure: true, imapUser: `info${i}@ejemplo.invalid`, smtpHost: "smtp.ejemplo.invalid", smtpPort: 587, smtpSecure: false, smtpUser: `info${i}@ejemplo.invalid`, fromName: n, fromEmail: `info${i}@ejemplo.invalid`, isDefault: def, isActive: true, syncEnabled: true, syncIntervalMinutes: 5, folderInbox: "INBOX", folderSent: "Sent", folderArchive: "Archive", folderTrash: "Trash", maxEmailsPerSync: 50, lastSyncAt: NOW - 3600_000, lastSyncError: err });
const modeOf = (mode: "test" | "live", status: string, hint: string | null) => ({ mode, label: mode === "test" ? "Modo de prueba" : "Modo real", connectable: true, status, statusLabel: status === "verificada" ? "Verificada" : "No conectada", accountHint: hint, chargesEnabled: !!hint, payoutsEnabled: !!hint, requirementsDue: [], disabledReason: null, onlineEnabled: false, connectedAt: hint ? NOW - 9 * DAY : null, verifiedAt: null, lastEventAt: null, lastEventType: null, checkedAt: NOW - DAY });
const integ = (id: string, group: string, title: string, state: string, stateLabel: string, fields: unknown[]) => ({ id, group, title, summary: "Conexión con el servicio de ejemplo.", configured: state !== "off", state, stateLabel, stateDetail: state === "failing" ? "La última comprobación falló: credenciales rechazadas." : null, canTest: true, fields });
const fld = (id: string, label: string, secret = false, required = false) => ({ key: id, label, help: secret ? "Se guarda cifrada y no se vuelve a mostrar." : null, secret, required, control: secret ? "secret" : "text", options: [], pattern: null, formatMessage: null, example: null, set: true, display: secret ? "••••••••" : "ejemplo.invalid" });
Object.assign(data, {
  "emailAccounts.list": [acc(1, "Administración", true), acc(2, "Reservas", false, "Autenticación rechazada por el servidor"), acc(3, "Soporte", false)],
  "cobros.status": { platformReady: true, platformProblem: null, modes: [modeOf("test", "verificada", "cuenta ejemplo"), modeOf("live", "no_conectada", null)] },
  "integrations.available": { available: true },
  "integrations.list": [
    integ("correo-saliente", "email", "Correo saliente", "working", "Funciona", [fld("host", "Servidor", false, true), fld("acceso", "Credencial de acceso", true, true)]),
    integ("mensajeria", "mensajeria", "Mensajería", "failing", "Con errores", [fld("sender", "Remitente"), fld("acceso", "Credencial de acceso", true)]),
    integ("pagos-extra", "pagos", "Pasarela adicional", "off", "Sin configurar", [fld("merchant", "Comercio", false, true)]),
  ],
  "domains.status": { available: true, overview: { fallback: "casa-ejemplo.ejemplo.invalid", primary: "casa-ejemplo.ejemplo.invalid", automatic: true, allowance: { allowed: true, reason: null, max: 3, used: 1 }, domains: [
    { domain: "www.casaejemplo.invalid", stage: "pending_dns", primary: false, apex: false, zone: "casaejemplo.invalid", certificate: "pending", https: null, message: "Falta crear el registro CNAME en tu proveedor de dominio.", createdAt: new Date(NOW - DAY).toISOString(), activatedAt: null, lastCheckedAt: new Date(NOW - 3600_000).toISOString(), records: [
      { type: "CNAME", name: "www", fqdn: "www.casaejemplo.invalid", value: "destino.ejemplo.invalid", purpose: "traffic", ok: false },
    ] },
  ] } },
  "sites.list": { sites: [
    { siteId: "s1", name: "Sede central", status: "active", isPrimary: true, virtual: false, address: "Calle del Mar 12, Cádiz", phone: "+34 956 000 111", email: "central@ejemplo.invalid", createdAt: NOW - 90 * DAY },
    { siteId: "s2", name: "Sede Sevilla", status: "active", isPrimary: false, virtual: false, address: null, phone: null, email: null, createdAt: NOW - 30 * DAY },
    { siteId: "s3", name: "Sede antigua", status: "archived", isPrimary: false, virtual: false, address: null, phone: null, email: null, createdAt: NOW - 200 * DAY },
  ], primarySiteId: "s1", limit: 3, used: 2, canAdd: true, canManage: true, managed: true, multiSite: true },

// CMS y Elephant Studio (feat/ux2-cms-studio): datos ficticios mínimos
const sp = (id: number, slug: string, title: string, o: Record<string, unknown> = {}) => ({ id, slug, title, isPublished: true, metaTitle: null, metaDescription: null, updatedAt: new Date(NOW - id * DAY).toISOString(), hasDraft: false, isHome: false, isLegal: false, inHeader: false, inFooter: false, ...o });
const sitePages = [
  sp(1, "inicio", "Inicio", { isHome: true, inHeader: true }), sp(2, "servicios", "Servicios", { inHeader: true, hasDraft: true }),
  sp(3, "quienes-somos", "Quiénes somos", { isPublished: false, hasDraft: true }), sp(4, "contacto", "Contacto", { inHeader: true }),
  sp(5, "aviso-legal", "Aviso legal", { isLegal: true, inFooter: true }), sp(6, "retiros-otono", "Retiros de otoño en la costa", { isPublished: false }),
];
const hid = () => Math.random().toString(36).slice(2, 10);
Object.assign(data, {
  "cms.sitePages": sitePages,
  "cms.i18nConfig": { defaultLocale: "es", fallback: "hide", locales: [{ locale: "es", isDefault: true, validated: true }, { locale: "de", isDefault: false, validated: false }] },
  "cms.pageTranslations": [],
  "cms.getMenuItems": [
    { id: 1, label: "Inicio", url: "/", menuZone: "header", sortOrder: 0, parentId: null, isActive: true, openInNewTab: false },
    { id: 2, label: "Servicios", url: "/servicios", menuZone: "header", sortOrder: 1, parentId: null, isActive: true, openInNewTab: false },
    { id: 3, label: "Contacto", url: "/contacto", menuZone: "header", sortOrder: 2, parentId: null, isActive: true, openInNewTab: false },
  ],
  "cms.getMediaFiles": ["terraza.jpg", "retiro-otono.webp", "equipo.png", "logo.svg", "sala-yoga.jpg", "desayuno.jpg"].map((n, i) => ({ id: i + 1, filename: n, originalName: n, url: "/placeholder-" + i + ".jpg", mimeType: "image/jpeg", size: 120000 * (i + 1), fileSize: 120000 * (i + 1), createdAt: new Date(NOW - i * DAY).toISOString() })),
  "cms.getSlideshowItems": [], "gallery.adminGetAll": [], "redirects.list": [{ id: 1, fromPath: "/retiro", toPath: "/retiros-otono", statusCode: 301, isActive: true, note: null, hits: 14 }], "redirects.log": [],
  "homeModules.getModule": [],
  "blog.list": [
    { id: 1, title: "Cinco hábitos para empezar el otoño", slug: "cinco-habitos-otono", visibleStatus: "published", category: "Bienestar", publishedAt: new Date(NOW - 4 * DAY).toISOString() },
    { id: 2, title: "Qué esperar de un retiro de silencio", slug: "retiro-silencio", visibleStatus: "draft", category: "Retiros", publishedAt: null },
    { id: 3, title: "Recetas de temporada", slug: "recetas-temporada", visibleStatus: "scheduled", category: null, publishedAt: new Date(NOW + 6 * DAY).toISOString() },
  ],
  "cms.studioTokens": null, "cms.savedBlocks": [], "cms.pageVersions": [],
  "cms.pageEditor": { page: sitePages[1], source: "draft", draftSavedAt: new Date(NOW - 60_000).toISOString(), blocks: [
    { id: hid(), type: "heading", data: { eyebrow: "Servicios", title: "Acompañamos tu proceso", subtitle: "Retiros, talleres y sesiones individuales", align: "center" } },
    { id: hid(), type: "text", data: { title: "", html: "<p>Texto de ejemplo para la página de servicios.</p>", align: "left" } },
  ] },
});

async function mock(page: Page) {
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname.replace(/^.*\/api\/trpc\//, "")).split(",");
    const body = names.map((n) => ({ result: { data: { json: n in data ? data[n] : null } } }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

const VIEWS = [
  { name: "escritorio", width: 1440, height: 900 },
  { name: "ancho", width: 1920, height: 1080 },
  { name: "tableta", width: 768, height: 1024 },
  { name: "movil", width: 390, height: 844 },
  { name: "portatil", width: 1280, height: 800 },
];
const SCREENS: { id: string; url: string; click?: RegExp }[] = [
  { id: "1-inicio", url: "/admin" },
  { id: "2-clientes", url: "/admin/crm/clientes" },
  { id: "2b-ficha-cliente", url: "/admin/crm/clientes/1" },
  { id: "3-productos", url: "/admin/productos" },
  { id: "4-facturacion", url: "/admin/crm?tab=invoices" },
  { id: "6-presupuestos", url: "/admin/crm?tab=quotes" },
  { id: "7-pedidos", url: "/admin/crm?tab=reservations" },
  { id: "8-formacion", url: "/admin/formacion?tab=cursos" },
  { id: "8-suscripcion", url: "/admin/suscripcion" },
  { id: "e1-gestoria-iva", url: "/admin/gestoria/iva" },
  { id: "e2-gestoria-expedientes", url: "/admin/gestoria/expedientes" },
  { id: "e3-gestoria-calendario", url: "/admin/gestoria/calendario" },
  { id: "e4-usuarios", url: "/admin/usuarios" },
  { id: "e5-numeracion", url: "/admin/numeracion" },
  { id: "e6-marca", url: "/admin/configuracion/marca" },
  { id: "e7-integraciones", url: "/admin/configuracion/integraciones" },
  { id: "e8-cobros", url: "/admin/configuracion/cobros" },
  { id: "e9-gastos", url: "/admin/contabilidad/gastos" },
  { id: "e10-movimientos-bancarios", url: "/admin/contabilidad/movimientos-bancarios" },
  { id: "e11-finance-sync", url: "/admin/contabilidad/finance-sync" },
  { id: "e12-sedes", url: "/admin/configuracion/sedes" },
  { id: "e13-correo", url: "/admin/configuracion/email" },
  { id: "e14-dominios", url: "/admin/configuracion/dominios" },
  { id: "e15-ajustes", url: "/admin/configuracion/sitio" },
  { id: "e16-correo-nueva", url: "/admin/configuracion/email", click: /Nueva cuenta/ },
  { id: "c1-paginas", url: "/admin/cms/paginas" },
  { id: "c2-blog", url: "/admin/cms/blog" },
  { id: "c3-multimedia", url: "/admin/cms/multimedia" },
  { id: "c4-menus", url: "/admin/cms/menus" },
  { id: "c5-redirecciones", url: "/admin/cms/redirecciones" },
  { id: "c6-idiomas", url: "/admin/cms/idiomas" },
  { id: "c7-galeria", url: "/admin/cms/galeria" },
  { id: "c8-studio", url: "/admin/studio/servicios" },
];
// Filtros opcionales: VISUAL_ONLY=regex de claves, VISUAL_VIEWS=nombres separados por coma
const ONLY = process.env.VISUAL_ONLY ? new RegExp(process.env.VISUAL_ONLY) : null;
const ONLY_VIEWS = process.env.VISUAL_VIEWS ? process.env.VISUAL_VIEWS.split(",") : null;

for (const v of VIEWS) {
  if (ONLY_VIEWS && !ONLY_VIEWS.includes(v.name)) continue;
  for (const s of SCREENS) {
    if (ONLY && !ONLY.test(s.id)) continue;
    test(`${TAG} · ${s.id} · ${v.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: (process.env.VISUAL_SCHEME as "dark" | "light") ?? "dark" });
      if (process.env.VISUAL_PRIMARY) {
        const c = process.env.VISUAL_PRIMARY;
        await page.addInitScript((col) => { const st = document.createElement("style"); st.textContent = `:root,.dark{--primary:${col};--sidebar-primary:${col};--ring:${col}}`; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st)); }, c);
      }
      // El panel guarda su tema en localStorage: emulateMedia no basta para el claro
      await page.addInitScript((t) => localStorage.setItem("nayade-admin-theme", t), process.env.VISUAL_SCHEME ?? "dark");
      await mock(page);
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto(s.url);
      if (s.url.startsWith("/admin/studio")) await page.locator("header").first().waitFor({ timeout: 40_000 }).catch(() => undefined);
      await page.waitForTimeout(4500);
      if ("click" in s && s.click) {
        await page.getByRole("button", { name: s.click }).first().click();
        await page.waitForTimeout(800);
      }
      await page.screenshot({ path: path.join(OUT, `${TAG}-${s.id}-${v.name}.png`), fullPage: true });
    });
  }
}
