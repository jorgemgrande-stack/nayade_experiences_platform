import { catalogFromModules, flatCatalog, type Messages } from "@shared/i18n/core";

/** Todos los diccionarios del panel (`shared/i18n/locales/<idioma>/<espacio>.ts`), cargados sin lista central. */
const modules = import.meta.glob("../../../shared/i18n/locales/*/*.ts", { eager: true }) as Record<string, { default: Messages }>;

export const FLAT = flatCatalog(catalogFromModules(modules));
