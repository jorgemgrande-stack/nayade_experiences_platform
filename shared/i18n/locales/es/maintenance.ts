/** Control del modo mantenimiento de la web pública. */
export default {
  technical: {
    on: "Mantenimiento ACTIVO",
    off: "Modo mantenimiento",
    title: "Modo mantenimiento — Web pública",
    description:
      "Cuando está activo, la web pública muestra este aviso y bloquea todas las rutas excepto el panel de administración. El acceso a /admin sigue funcionando con normalidad.",
    switchLabel: "Desactivar web pública",
    switchHint: "Ningún usuario podrá reservar ni navegar la web mientras esté activo.",
    savedOn: "Web pública desactivada",
    savedOff: "Web pública reactivada",
    saveOn: "Desactivar web y guardar",
  },
  web: {
    on: "Web en mantenimiento",
    off: "Mantenimiento de la web",
    title: "Web en mantenimiento",
    description: "Mientras esté activo, tu web pública muestra este aviso en lugar de su contenido. El panel sigue funcionando con normalidad.",
    switchLabel: "Poner la web en mantenimiento",
    switchHint: "Nadie podrá navegar por tu web mientras esté activo.",
    savedOn: "Tu web está en mantenimiento",
    savedOff: "Tu web vuelve a estar disponible",
    saveOn: "Poner en mantenimiento y guardar",
  },
  errorPrefix: "Error: {message}",
  warning: "Al guardar, la web dejará de estar accesible al público inmediatamente.",
  messageShown: "Mensaje mostrado",
  cancel: "Cancelar",
  save: "Guardar",
};
