/**
 * Travel Net — adaptadores de proveedor. Contrato estable para que expedientes y operaciones programen contra una
 * interfaz desde ya; hoy solo existe el ADAPTADOR MANUAL (ninguna integración real con bancos de camas u otros
 * proveedores): el envío, la confirmación y la cancelación se hacen fuera del sistema y se registran a mano en el panel.
 */
import type { OperationStatus } from "./rules";

export const CONNECTION_MODES = ["manual", "email", "api"] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export interface ServiceBookingRequest {
  operationId: number;
  fileNumber: string | null;
  serviceTitle: string;
  serviceDate: string | null;
  endDate: string | null;
  quantity: number;
  clientName: string;
  adults: number;
  children: number;
}

export interface SubmitResult {
  status: OperationStatus;
  providerLocator?: string;
  note: string;
}

export interface CancelResult {
  cancelled: boolean;
  note: string;
}

export interface SupplierAdapter {
  readonly mode: ConnectionMode;
  submitBooking(request: ServiceBookingRequest): Promise<SubmitResult>;
  cancelBooking(locator: string | null, reason: string): Promise<CancelResult>;
}

/** No llama a nada: deja la operación esperando la gestión humana con el proveedor. */
export class ManualSupplierAdapter implements SupplierAdapter {
  readonly mode = "manual" as const;

  async submitBooking(): Promise<SubmitResult> {
    return { status: "submitted", note: "Gestión manual: contacta con el proveedor y registra aquí su confirmación y el localizador." };
  }

  async cancelBooking(): Promise<CancelResult> {
    return { cancelled: false, note: "Gestión manual: cancela directamente con el proveedor y registra el resultado." };
  }
}

/** Adaptador según el modo de conexión del proveedor. Hoy siempre el manual (correo o API se añadirán aquí). */
export function resolveSupplierAdapter(_mode: string): SupplierAdapter {
  return new ManualSupplierAdapter();
}
