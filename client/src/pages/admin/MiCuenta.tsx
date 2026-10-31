/**
 * MiCuenta.tsx — /admin/mi-cuenta: seguridad de la cuenta del usuario en curso.
 *  - Correo de acceso: solicitar el cambio (con la contraseña actual); se confirma desde el enlace del correo nuevo.
 *  - Dispositivos con los que ha iniciado sesión: ver y olvidar.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, MonitorSmartphone, Trash2 } from "lucide-react";
import { toastError } from "@/lib/errorMessage";

const fmt = (iso: string) => new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });

function EmailSection() {
  const { user } = useAuth();
  const pendingQ = trpc.accountSecurity.pendingEmailChange.useQuery();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const request = trpc.accountSecurity.requestEmailChange.useMutation({
    onSuccess: (r) => {
      toast.success(r.sent ? `Te hemos enviado un enlace a ${r.newEmail}. Ábrelo para confirmar el cambio.` : "Solicitud registrada, pero no se pudo enviar el correo. Inténtalo de nuevo más tarde.");
      setNewEmail("");
      setCurrentPassword("");
      pendingQ.refetch();
    },
    onError: (e) => toastError(e),
  });
  const pending = pendingQ.data?.pending ?? null;
  const unavailable = pendingQ.data?.available === false;

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-4" aria-labelledby="mi-cuenta-correo">
      <div className="flex items-center gap-2">
        <Mail className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        <h2 id="mi-cuenta-correo" className="font-semibold text-foreground">Correo de acceso</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Correo actual: <span className="font-medium text-foreground">{user?.email ?? "—"}</span>
      </p>
      {pending && (
        <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2" role="status">
          Cambio pendiente de confirmar a <strong>{pending.newEmail}</strong> (el enlace caduca el {fmt(pending.expiresAt)}).
        </p>
      )}
      {unavailable ? (
        <p className="text-sm text-muted-foreground">El cambio de correo todavía no está disponible en esta empresa.</p>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate({ newEmail, currentPassword });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="mi-cuenta-nuevo-correo">Correo nuevo</Label>
            <Input id="mi-cuenta-nuevo-correo" type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mi-cuenta-contrasena">Contraseña actual</Label>
            <Input id="mi-cuenta-contrasena" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={request.isPending || !newEmail || !currentPassword}>
              {request.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              Enviar enlace de verificación
            </Button>
            <span className="text-xs text-muted-foreground">El cambio se aplica al abrir el enlace del correo nuevo. Después tendrás que volver a iniciar sesión.</span>
          </div>
        </form>
      )}
    </section>
  );
}

function DevicesSection() {
  const devicesQ = trpc.accountSecurity.myDevices.useQuery();
  const forget = trpc.accountSecurity.forgetDevice.useMutation({
    onSuccess: () => {
      toast.success("Dispositivo olvidado. Si se vuelve a usar, te avisaremos por correo.");
      devicesQ.refetch();
    },
    onError: (e) => toastError(e),
  });
  const data = devicesQ.data;

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-4" aria-labelledby="mi-cuenta-dispositivos">
      <div className="flex items-center gap-2">
        <MonitorSmartphone className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        <h2 id="mi-cuenta-dispositivos" className="font-semibold text-foreground">Dispositivos con los que has iniciado sesión</h2>
      </div>
      <p className="text-sm text-muted-foreground">Cuando inicies sesión desde un dispositivo nuevo te avisaremos por correo. Si no reconoces alguno, olvídalo y cambia tu contraseña.</p>
      {devicesQ.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Cargando" /></div>
      ) : data?.available === false ? (
        <p className="text-sm text-muted-foreground">El registro de dispositivos todavía no está disponible en esta empresa.</p>
      ) : !data?.devices.length ? (
        <p className="text-sm text-muted-foreground">Todavía no hay dispositivos registrados. Se registran al iniciar sesión.</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {d.label}
                  {d.current && <span className="ml-2 text-xs font-normal text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">Este dispositivo</span>}
                </p>
                <p className="text-xs text-muted-foreground">Primera vez: {fmt(d.firstSeenAt)} · Último acceso: {fmt(d.lastSeenAt)}</p>
              </div>
              <Button variant="outline" size="sm" disabled={forget.isPending} onClick={() => forget.mutate({ id: d.id })} aria-label={`Olvidar ${d.label}`}>
                <Trash2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                Olvidar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function MiCuenta() {
  return (
    <AdminLayout title="Mi cuenta">
      <div className="max-w-3xl space-y-6">
        <EmailSection />
        <DevicesSection />
      </div>
    </AdminLayout>
  );
}
