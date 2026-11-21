/** Estado del sistema (resumen de configuración). */
export default {
  title: "Estado del sistema",
  intro: "Resumen de la configuración del negocio y estado de integraciones.",
  card: { configured: "Configurado", partial: "Parcial", pending: "Pendiente", edit: "Editar" },
  business: {
    titleTech: "Información del negocio",
    titleCompany: "Datos de la empresa",
    name: "Nombre comercial",
    phone: "Teléfono",
    domain: "Dominio web",
    location: "Localización",
  },
  fiscal: { title: "Datos fiscales", taxId: "NIF / CIF", address: "Domicilio fiscal", vatGeneral: "IVA general", vatReduced: "IVA reducido" },
  emails: {
    title: "Emails y notificaciones",
    orders: "Email de {what}",
    admin: "Email alertas admin",
    accounting: "Email contabilidad",
    cancellations: "Email cancelaciones",
    noreply: "Remitente noreply",
    usingDefault: "(usando valor por defecto)",
  },
  branding: { titleTech: "Branding", titleBrand: "Marca", logo: "Logotipo", primary: "Color principal", accent: "Color acento", instagram: "Instagram" },
  modules: { title: "Módulos activos", none: "No hay módulos activos." },
  env: { title: "Variables de entorno (Railway)", configured: "{set}/{total} configuradas" },
};
