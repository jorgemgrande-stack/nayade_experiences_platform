/**
 * Centro de ayuda del panel (contenido versionado, no CMS: se revisa en cada PR).
 *
 * Reglas del contenido:
 *  - Describe la interfaz REAL actual, con los textos literales de menús, pestañas y botones.
 *  - No presenta como disponible nada que no exista (p. ej. chat en vivo, cambio de plan dentro
 *    del panel).
 *  - No promete horarios ni tiempos de respuesta del soporte.
 *
 * Si cambia una pantalla, actualiza aquí el artículo correspondiente y la fecha de revisión.
 */

export const HELP_REVIEWED_AT = "2026-10-16";

export interface HelpLink {
  label: string;
  href: string;
}

export interface HelpArticle {
  id: string;
  title: string;
  /** Una o dos frases: se usa también como ayuda contextual breve. */
  summary: string;
  /** Pantallas donde esta ayuda es la contextual: ruta exacta y, opcionalmente, pestaña (`?tab=`). */
  contexts: Array<{ path: string; tab?: string; prefix?: boolean }>;
  steps: string[];
  notes?: string[];
  links: HelpLink[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "crear-empresa",
    title: "Crear tu empresa y completar sus datos",
    summary:
      "La empresa se da de alta al activar tu cuenta de Elephant Source; desde el panel completas sus datos fiscales y de contacto.",
    contexts: [{ path: "/admin/configuracion/sitio" }, { path: "/admin/primeros-pasos" }],
    steps: [
      "Tu empresa no se crea desde este panel: se crea al activar tu cuenta (por ejemplo, con la prueba gratuita). Recibirás un correo de bienvenida con el botón «Definir contraseña» para entrar por primera vez.",
      "Ya dentro, abre el asistente «Configura tu empresa» (Primeros pasos). Sus pasos se adaptan a tu tipo de negocio y a lo que tienes contratado; puedes omitir cualquiera con «Omitir por ahora» y el progreso se guarda solo.",
      "En el paso Empresa rellena los campos obligatorios: Nombre comercial, Razón social, NIF / CIF, Dirección fiscal, País, Moneda y Zona horaria. Pulsa «Guardar y continuar».",
      "Para revisar o cambiar los datos más adelante, ve a Organización › Datos de la empresa. La pantalla se titula «Datos del negocio» y los datos fiscales están en la pestaña «Empresa legal».",
      "En «Datos del negocio» no hay botón Guardar: los cambios se guardan automáticamente (verás «Guardando…»).",
    ],
    notes: [
      "Los datos de «Empresa legal» aparecen como emisor en facturas, presupuestos y tickets.",
      "Si ya hay una entidad fiscal registrada para tu empresa, el asistente lo indica: esos son los datos que salen en las facturas.",
    ],
    links: [
      { label: "Abrir el asistente de primeros pasos", href: "/admin/primeros-pasos" },
      { label: "Datos de la empresa", href: "/admin/configuracion/sitio" },
    ],
  },
  {
    id: "crear-clientes",
    title: "Crear clientes",
    summary: "Da de alta clientes desde Clientes y ventas › Clientes con el botón «Nuevo cliente».",
    contexts: [{ path: "/admin/crm/clientes" }],
    steps: [
      "En el menú, ve a Clientes y ventas › Clientes (pantalla «Gestión de Clientes»).",
      "Pulsa «Nuevo cliente» (si aún no tienes ninguno, «Crear el primer cliente»).",
      "Rellena los campos obligatorios: Nombre completo y Email. El resto es opcional: Teléfono, Empresa, NIF / CIF, Dirección, Ciudad, Código postal y Notas internas.",
      "Pulsa «Crear cliente». Verás el aviso «Cliente creado».",
      "Para modificarlo, usa «Editar cliente» y después «Guardar cambios».",
    ],
    notes: [
      "Los clientes también se crean automáticamente cuando llega una solicitud, y puedes crear uno al vuelo al registrar un pedido.",
    ],
    links: [{ label: "Ir a Clientes", href: "/admin/crm/clientes" }],
  },
  {
    id: "etiquetas-clientes",
    title: "Etiquetar clientes y filtrar por etiqueta",
    summary: "Crea etiquetas en Clientes y ventas › Etiquetas, asígnalas desde el listado de clientes y filtra por ellas.",
    contexts: [{ path: "/admin/crm/etiquetas" }],
    steps: [
      "En el menú, ve a Clientes y ventas › Etiquetas y pulsa «Nueva etiqueta».",
      "Escribe el nombre (no puede repetirse) y, si quieres, elige un color. Pulsa «Crear etiqueta».",
      "En Clientes y ventas › Clientes, pulsa el botón de etiqueta de un cliente y marca las que quieras asignar. Los cambios se guardan al momento.",
      "Para ver solo los clientes con una etiqueta, elígela en el desplegable «Todas las etiquetas» junto al buscador, o pulsa «Ver clientes» en la pantalla de etiquetas.",
    ],
    notes: [
      "Al eliminar una etiqueta se quita de todos los clientes que la llevan; los clientes no se borran.",
      "Los usuarios de solo lectura ven las etiquetas, pero no pueden crearlas ni asignarlas.",
    ],
    links: [
      { label: "Ir a Etiquetas", href: "/admin/crm/etiquetas" },
      { label: "Ir a Clientes", href: "/admin/crm/clientes" },
    ],
  },
  {
    id: "tareas-recordatorios",
    title: "Tareas y recordatorios del equipo",
    summary: "Apunta tareas internas con fecha y responsable en Clientes y ventas › Tareas; las de hoy y las vencidas aparecen en el Inicio.",
    contexts: [{ path: "/admin/crm/tareas" }],
    steps: [
      "En el menú, ve a Clientes y ventas › Tareas y pulsa «Nueva tarea».",
      "Escribe el título y, si quieres, una descripción, la fecha en «Vence el», el responsable y la prioridad.",
      "Para relacionarla con un cliente, una oportunidad o un presupuesto, elige el tipo en «Vincular a», búscalo y selecciónalo. Pulsa «Crear tarea».",
      "En «Mis tareas» ves las tuyas; en «Todo el equipo», las de todos. Marca «Solo vencidas» para ver lo atrasado.",
      "Pulsa el círculo de una tarea para marcarla como hecha (y otra vez para reabrirla).",
    ],
    notes: [
      "Las tareas pasadas de fecha se marcan como «Vencida». En el Inicio verás «Mis tareas pendientes» y, en los avisos, las «Tareas para hoy o vencidas».",
      "Son recordatorios internos: no se envía ningún correo al cliente ni al responsable.",
      "Desde el listado de clientes, el botón de tareas abre las tareas vinculadas a ese cliente.",
    ],
    links: [{ label: "Ir a Tareas", href: "/admin/crm/tareas" }],
  },
  {
    id: "crear-productos",
    title: "Crear productos y servicios",
    summary: "Crea tu catálogo desde Catálogo y comercio › Productos y servicios con «Nuevo producto».",
    contexts: [
      { path: "/admin/productos/experiencias" },
      { path: "/admin/productos/categorias" },
      { path: "/admin/productos/variantes" },
      { path: "/admin/productos/ubicaciones" },
    ],
    steps: [
      "En el menú, ve a Catálogo y comercio › Productos y servicios.",
      "Pulsa «Nuevo producto». Se abre «Nuevo producto o servicio».",
      "Campos obligatorios: Nombre, Precio (€, impuestos incluidos), Categoría y Lugar de servicio o venta. Opcionales: imágenes (hasta 4, máximo 10 MB cada una), Tipo de precio (Por persona / Por unidad), Activo, Destacado en Home y la dirección en la web.",
      "Pulsa el botón de guardar del final del formulario (se llama «Crear producto»). Un aviso confirma que el producto se ha creado.",
      "Si necesitas una categoría nueva, ve a Catálogo y comercio › Categorías, pulsa «Nueva Categoría», rellena Nombre y Slug y pulsa «Crear Categoría».",
      "Para precios alternativos de un mismo producto, ve a Variantes y precios, pulsa «Nueva Variante», elige el producto, el nombre de la variante y el tipo de precio (Precio fijo, Por persona o Porcentaje) y pulsa «Crear Variante».",
    ],
    notes: [
      "En el asistente de primeros pasos el primer producto se crea con «Precio (€, impuestos incluidos)» y el tipo de IVA, la misma convención que el gestor de productos; si no existen, se crean la categoría «General» y el lugar «Principal».",
    ],
    links: [
      { label: "Ir a Productos y servicios", href: "/admin/productos/experiencias" },
      { label: "Categorías", href: "/admin/productos/categorias" },
      { label: "Variantes y precios", href: "/admin/productos/variantes" },
    ],
  },
  {
    id: "crear-presupuestos",
    title: "Crear y enviar presupuestos",
    summary: "Prepara presupuestos en Clientes y ventas › Presupuestos con «Nuevo Presupuesto»; puedes guardarlos como borrador o enviarlos.",
    contexts: [{ path: "/admin/crm", tab: "quotes" }, { path: "/admin/crm/propuestas" }],
    steps: [
      "En el menú, ve a Clientes y ventas › Presupuestos (pestaña «Presupuestos»).",
      "Pulsa «Nuevo Presupuesto». Puedes «Buscar cliente existente» o escribir los datos del cliente.",
      "Campos obligatorios: Nombre, Email, «Asunto del presupuesto» y al menos un concepto en «Conceptos» (escribe el concepto o busca un producto del catálogo). Opcionales: Teléfono, Empresa, Fecha de actividad, Válido hasta, Notas para el cliente, Condiciones y «Plan de pago fraccionado».",
      "Pulsa «Guardar borrador» para revisarlo más tarde o «Crear y Enviar al cliente» para enviarlo ya.",
      "Desde la lista puedes, entre otras acciones: Enviar al cliente (los borradores), Reenviar, Descargar en PDF, Duplicar o Marcar como perdido.",
    ],
    notes: [
      "El cliente recibe un enlace para ver el presupuesto y aceptarlo y pagarlo en línea, si tienes los pagos configurados.",
    ],
    links: [{ label: "Ir a Presupuestos", href: "/admin/crm?tab=quotes" }],
  },
  {
    id: "crear-pedidos",
    title: "Crear pedidos",
    summary: "Registra pedidos en Clientes y ventas › Pedidos (pestaña «Reservas») con «Nueva Reserva»; al guardar se genera también la factura.",
    contexts: [{ path: "/admin/crm", tab: "reservations" }],
    steps: [
      "En el menú, ve a Clientes y ventas › Pedidos. La pestaña se llama «Reservas».",
      "Pulsa «Nueva Reserva» (si la lista está vacía, «Nuevo pedido»).",
      "Campos obligatorios: Nombre completo, Email, el producto («Experiencia o pack»), Fecha del servicio e Importe total (€). Opcionales: número de personas, importe cobrado, método de pago, canal y notas internas.",
      "Pulsa «Crear Reserva». El aviso indica el número del pedido y el de la factura creada.",
    ],
    notes: [
      "Los pedidos también llegan solos cuando un cliente acepta y paga un presupuesto, o cuando conviertes un presupuesto en pedido pendiente de cobro.",
      "Desde cada pedido puedes reenviar la confirmación, descargar la factura en PDF, generar la factura si aún no la tiene o anularlo.",
    ],
    links: [{ label: "Ir a Pedidos", href: "/admin/crm?tab=reservations" }],
  },
  {
    id: "gestionar-facturas",
    title: "Gestionar facturas, abonos y cobros",
    summary: "Consulta, descarga, reenvía y rectifica facturas en Facturación › Facturas; los cobros pendientes tienen su propia pantalla.",
    contexts: [
      { path: "/admin/crm", tab: "invoices" },
      { path: "/admin/crm", tab: "anulaciones" },
      { path: "/admin/crm", tab: "pagos_pendientes" },
    ],
    steps: [
      "Las facturas se emiten al crear un pedido o al confirmarse su pago. Si un pedido no tiene factura, usa «Generar factura» desde el pedido.",
      "En Facturación › Facturas tienes, para cada factura: visualizar, descargar, generar el PDF, reenviar por email y confirmar un pago manual («Confirmar cobro»).",
      "Para devolver dinero o corregir una factura cobrada, usa «Generar factura de abono», indica el «Motivo del abono» y pulsa «Generar abono». La factura original queda abonada.",
      "«Anular factura» no se puede deshacer; para reembolsos usa el abono.",
      "En Facturación › Cobros pendientes (pestaña «Pagos Pendientes») puedes confirmar pagos, reenviar recordatorios o cancelarlos.",
      "En Facturación › Anulaciones y abonos (pestaña «Anulaciones») se gestionan las solicitudes de cancelación de pedidos.",
    ],
    notes: ["La numeración de las facturas se configura en Facturación › Series y numeración."],
    links: [
      { label: "Ir a Facturas", href: "/admin/crm?tab=invoices" },
      { label: "Cobros pendientes", href: "/admin/crm?tab=pagos_pendientes" },
      { label: "Series y numeración", href: "/admin/numeracion" },
    ],
  },
  {
    id: "invitar-empleados",
    title: "Invitar a empleados",
    summary: "Invita a tu equipo desde Organización › Usuarios y permisos con «Nuevo usuario»; recibirán un correo para definir su contraseña.",
    contexts: [{ path: "/admin/usuarios" }],
    steps: [
      "En el menú, ve a Organización › Usuarios y permisos (pantalla «Gestión de Usuarios»).",
      "Pulsa «Nuevo usuario» (o «Invitar a alguien» si todavía estás solo).",
      "Rellena Nombre completo y Email y elige el rol (por ejemplo, Administrador o Agente Comercial).",
      "Pulsa «Crear y enviar invitación». La persona invitada recibe un correo con un enlace que caduca a las 72 horas para establecer su contraseña.",
      "Si el enlace caduca, usa «Reenviar invitación» en el menú del usuario.",
    ],
    notes: [
      "Tu plan limita el número de usuarios del panel (Essential incluye 3). Si llegas al límite, el panel te lo indica: desactiva un usuario o amplía tu plan.",
      "Puedes ver cuántos usuarios usas en Suscripción › Plan y uso.",
    ],
    links: [{ label: "Ir a Usuarios y permisos", href: "/admin/usuarios" }],
  },
  {
    id: "consultar-suscripcion",
    title: "Consultar tu suscripción",
    summary: "En Suscripción › Plan y uso ves tu plan, los días de prueba que quedan, los límites y las funcionalidades incluidas.",
    contexts: [{ path: "/admin/suscripcion" }],
    steps: [
      "En el menú, ve a Suscripción › Plan y uso.",
      "Arriba verás el plan y su estado (por ejemplo, Prueba gratuita, Activa o Solo lectura) y, durante la prueba, los días que quedan.",
      "En «Límites del plan» se muestran los usuarios, sedes y entidades fiscales incluidos y los usuarios que ya usas.",
      "En «Funcionalidades incluidas» tienes lo que incluye tu plan, agrupado por áreas.",
    ],
    notes: [
      "Cuando termina la prueba sin contratar, la cuenta pasa a solo lectura: no se borra nada y puedes seguir consultando tus datos.",
      "Esta pantalla no muestra las facturas de la suscripción ni los precios.",
    ],
    links: [{ label: "Ir a Plan y uso", href: "/admin/suscripcion" }],
  },
  {
    id: "cambiar-plan",
    title: "Contratar o cambiar de plan",
    summary: "El cambio de plan no se hace dentro del panel: desde Suscripción accedes a las opciones de contratación de Elephant Source.",
    contexts: [],
    steps: [
      "Ve a Suscripción › Plan y uso.",
      "Usa «Contratar el plan» (durante la prueba), «Ver opciones de contratación» o, en la sección «Ampliar», «Ver planes y módulos». Se abren en otra pestaña.",
      "Si no aparece ningún botón, la pantalla te indica que escribas a tu contacto comercial de Elephant Source para ampliar o contratar.",
    ],
    notes: ["Los cambios de plan los aplica Elephant Source; cuando se activan, el menú y los límites del panel se actualizan solos."],
    links: [{ label: "Ir a Plan y uso", href: "/admin/suscripcion#ampliar" }],
  },
  {
    id: "recuperar-contrasena",
    title: "Recuperar la contraseña",
    summary: "Desde la pantalla de acceso, «¿Has olvidado tu contraseña?» te envía un enlace válido durante 60 minutos.",
    contexts: [],
    steps: [
      "En la pantalla de acceso pulsa «¿Has olvidado tu contraseña?».",
      "Escribe tu email y pulsa «Enviar enlace de recuperación».",
      "Abre el correo (revisa también la carpeta de spam) y sigue el enlace. Caduca a los 60 minutos.",
      "Escribe la nueva contraseña (mínimo 8 caracteres), confírmala y pulsa «Guardar nueva contraseña».",
      "Si el enlace ya no es válido, pulsa «Solicitar nuevo enlace» y repite el proceso.",
    ],
    notes: ["Por seguridad, la pantalla responde lo mismo exista o no el email."],
    links: [{ label: "Recuperar contraseña", href: "/recuperar-contrasena" }],
  },
  {
    id: "publicar-blog",
    title: "Publicar en el blog de tu web",
    summary: "Escribe entradas desde Web › Blog con «Nueva entrada»; solo las publicadas aparecen en la dirección /blog de tu web.",
    contexts: [{ path: "/admin/cms/blog" }],
    steps: [
      "En el menú, ve a Web › Blog y pulsa «Nueva entrada» (si aún no tienes ninguna, «Crear la primera entrada»).",
      "Escribe el título: la dirección de la entrada se propone sola (puedes cambiarla; solo minúsculas, números y guiones). Añade un extracto y el texto de la entrada.",
      "Opcionalmente, sube una imagen destacada con su texto alternativo, indica el autor y una categoría, y rellena el título y la descripción SEO.",
      "Pulsa «Vista previa» para ver cómo quedará el texto en la web (no guarda nada).",
      "En Estado elige «Borrador (no se ve en la web)» o «Publicada» y pulsa «Guardar borrador» o «Publicar». Con una fecha de publicación futura, el botón es «Programar publicación» y la entrada aparece en la web a esa hora.",
      "Pulsa «Ver el blog» para abrir tu blog público.",
    ],
    notes: [
      "Los borradores y las entradas programadas nunca se ven en la web ni en el sitemap.",
      "El texto admite HTML básico, como las páginas; los scripts y estilos se eliminan al publicar.",
    ],
    links: [{ label: "Ir al blog", href: "/admin/cms/blog" }],
  },
];

export function getHelpArticle(id: string | null | undefined): HelpArticle | undefined {
  return id ? HELP_ARTICLES.find((a) => a.id === id) : undefined;
}

/** Ayuda contextual de una pantalla: coincide la ruta y, si el artículo la indica, la pestaña. */
export function helpForLocation(path: string, search = ""): HelpArticle | undefined {
  const clean = path.replace(/\/+$/, "") || "/";
  const tab = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("tab");
  let fallback: HelpArticle | undefined;
  for (const a of HELP_ARTICLES) {
    for (const c of a.contexts) {
      const samePath = c.prefix ? clean.startsWith(c.path) : clean === c.path;
      if (!samePath) continue;
      if (c.tab) {
        if (c.tab === tab) return a;
      } else if (!fallback) fallback = a;
    }
  }
  return fallback;
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Búsqueda sencilla (sin acentos ni mayúsculas) en título, resumen y pasos. */
export function searchHelp(query: string): HelpArticle[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return HELP_ARTICLES;
  return HELP_ARTICLES.filter((a) => {
    const text = norm([a.title, a.summary, ...a.steps, ...(a.notes ?? [])].join(" "));
    return terms.every((t) => text.includes(t));
  });
}

/** Dirección de correo simple: sin espacios ni caracteres que alteren un enlace mailto (?, &, #…). */
export const SUPPORT_EMAIL_RE = /^[^\s@<>"(),;:?&#/\\]+@[^\s@<>"(),;:?&#/\\]+\.[A-Za-z]{2,}$/;

/** Enlace de correo de soporte (sin promesas de horario). `null` si no hay dirección válida. */
export function supportMailto(email: string | null | undefined, context?: string): string | null {
  if (!email || !SUPPORT_EMAIL_RE.test(email)) return null;
  const subject = encodeURIComponent(context ? `Ayuda: ${context}` : "Ayuda con el panel");
  return `mailto:${email}?subject=${subject}`;
}
