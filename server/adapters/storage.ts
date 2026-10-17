/**
 * adapters/storage.ts — Punto de entrada de almacenamiento para los adaptadores locales.
 *
 * Delega en server/storage.ts (y, con el servicio de objetos activo, en server/_core/files/service.ts):
 * un único camino de escritura persistente, con bucket privado y metadatos por empresa. Antes este
 * fichero tenía su propia copia del cliente S3 y del disco local (/tmp/local-storage), que construía
 * URL públicas del bucket.
 */
export { storagePut, storageGet } from "../storage";
