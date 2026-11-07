/**
 * Formulario de ficha de huésped (registro de viajeros, RD 933/2021) y aviso de protección de datos, compartidos por la
 * recepción y la pantalla de huéspedes.
 */
import { ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface GuestFormValue {
  firstName: string; lastName: string; secondLastName: string; sex: string; birthDate: string; nationality: string; docType: string;
  docNumber: string; docSupportNumber: string; docIssueDate: string; address: string; city: string; postalCode: string; country: string;
  phone: string; email: string;
}

export const EMPTY_GUEST: GuestFormValue = {
  firstName: "", lastName: "", secondLastName: "", sex: "", birthDate: "", nationality: "", docType: "", docNumber: "", docSupportNumber: "",
  docIssueDate: "", address: "", city: "", postalCode: "", country: "", phone: "", email: "",
};

export function guestToForm(g: any | null | undefined): GuestFormValue {
  if (!g) return { ...EMPTY_GUEST };
  const out = { ...EMPTY_GUEST };
  for (const k of Object.keys(out) as (keyof GuestFormValue)[]) out[k] = g[k] ?? "";
  return out;
}

/** Valores para el servidor: vacío → null. */
export function guestPayload(f: GuestFormValue) {
  const n = (v: string) => (v.trim() ? v.trim() : null);
  return {
    firstName: n(f.firstName), lastName: n(f.lastName), secondLastName: n(f.secondLastName), sex: (n(f.sex) as any) ?? null, birthDate: n(f.birthDate),
    nationality: n(f.nationality), docType: (n(f.docType) as any) ?? null, docNumber: n(f.docNumber), docSupportNumber: n(f.docSupportNumber),
    docIssueDate: n(f.docIssueDate), address: n(f.address), city: n(f.city), postalCode: n(f.postalCode), country: n(f.country), phone: n(f.phone),
    email: f.email.trim() || null,
  };
}

export function GuestForm({ value, onChange }: { value: GuestFormValue; onChange: (v: GuestFormValue) => void }) {
  const set = (k: keyof GuestFormValue) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="space-y-1"><Label className="text-xs">Nombre *</Label><Input value={value.firstName} maxLength={120} onChange={set("firstName")} /></div>
      <div className="space-y-1"><Label className="text-xs">Primer apellido *</Label><Input value={value.lastName} maxLength={160} onChange={set("lastName")} /></div>
      <div className="space-y-1"><Label className="text-xs">Segundo apellido</Label><Input value={value.secondLastName} maxLength={160} onChange={set("secondLastName")} /></div>
      <div className="space-y-1">
        <Label className="text-xs">Sexo *</Label>
        <Select value={value.sex || "none"} onValueChange={(v) => onChange({ ...value, sex: v === "none" ? "" : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="M">Mujer</SelectItem><SelectItem value="H">Hombre</SelectItem><SelectItem value="X">Otro</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="space-y-1"><Label className="text-xs">Fecha de nacimiento *</Label><Input type="date" value={value.birthDate} onChange={set("birthDate")} /></div>
      <div className="space-y-1"><Label className="text-xs">Nacionalidad *</Label><Input value={value.nationality} maxLength={80} onChange={set("nationality")} /></div>
      <div className="space-y-1">
        <Label className="text-xs">Documento (desde 14 años)</Label>
        <Select value={value.docType || "none"} onValueChange={(v) => onChange({ ...value, docType: v === "none" ? "" : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="DNI">DNI</SelectItem><SelectItem value="NIE">NIE</SelectItem><SelectItem value="PASAPORTE">Pasaporte</SelectItem><SelectItem value="OTRO">Otro</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="space-y-1"><Label className="text-xs">Número de documento</Label><Input value={value.docNumber} maxLength={64} onChange={set("docNumber")} /></div>
      <div className="space-y-1"><Label className="text-xs">N.º de soporte (DNI/NIE)</Label><Input value={value.docSupportNumber} maxLength={64} onChange={set("docSupportNumber")} /></div>
      <div className="space-y-1"><Label className="text-xs">Expedición del documento</Label><Input type="date" value={value.docIssueDate} onChange={set("docIssueDate")} /></div>
      <div className="sm:col-span-2 space-y-1"><Label className="text-xs">Dirección</Label><Input value={value.address} maxLength={255} onChange={set("address")} /></div>
      <div className="space-y-1"><Label className="text-xs">Localidad</Label><Input value={value.city} maxLength={120} onChange={set("city")} /></div>
      <div className="space-y-1"><Label className="text-xs">Código postal</Label><Input value={value.postalCode} maxLength={16} onChange={set("postalCode")} /></div>
      <div className="space-y-1"><Label className="text-xs">País</Label><Input value={value.country} maxLength={80} onChange={set("country")} /></div>
      <div className="space-y-1"><Label className="text-xs">Teléfono</Label><Input value={value.phone} maxLength={40} onChange={set("phone")} /></div>
      <div className="sm:col-span-3 space-y-1"><Label className="text-xs">Correo</Label><Input type="email" value={value.email} maxLength={255} onChange={set("email")} /></div>
    </div>
  );
}

export function GdprNotice() {
  return (
    <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
      <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
      <p>
        Datos personales del registro de viajeros (RD 933/2021). Solo los ve quien gestiona el hotel. Recoge únicamente lo necesario, informa al huésped
        del tratamiento según tu política de privacidad y no los uses para otros fines. La conservación se configura en Huéspedes (desactivada por defecto).
      </p>
    </div>
  );
}
