/**
 * VerifyEmailChange.tsx — Página /admin/verificar-correo?token=xxx
 *
 * Confirma el cambio del correo de acceso con el enlace recibido en el correo NUEVO. Exige la sesión del propio
 * usuario (sin sesión, se inicia y se vuelve aquí). Al confirmar se cierran todas las sesiones: hay que volver a
 * entrar con el correo nuevo. Aspecto: el de la empresa (AuthShell).
 */
import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { AuthAlert, AuthLoading, AuthShell, AuthSubmit, authLinkClass, useLoginLook } from "@/components/auth/AuthShell";

export default function VerifyEmailChange() {
  const { look } = useLoginLook();
  const { user, loading } = useAuth();
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const confirm = trpc.accountSecurity.confirmEmailChange.useMutation();

  if (!look || loading) return <AuthLoading />;
  const returnTo = `/admin/verificar-correo?token=${encodeURIComponent(token)}`;

  return (
    <AuthShell look={look} title="Confirma tu nuevo correo" titleHighlight="nuevo correo" message="Un paso más para cambiar el correo de acceso de tu cuenta.">
      {!token ? (
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-8 h-8 text-red-700" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Enlace no válido</h2>
          <p className="text-slate-600 leading-relaxed">Abre el enlace completo que has recibido en tu correo nuevo.</p>
        </div>
      ) : confirm.isSuccess ? (
        <div className="text-center" role="status">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-emerald-700" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Correo actualizado</h2>
          <p className="text-slate-600 leading-relaxed mb-2">
            A partir de ahora entrarás con <strong>{confirm.data.email}</strong>.
          </p>
          <p className="text-slate-500 text-sm mb-8">Por seguridad, hemos cerrado todas tus sesiones. Vuelve a iniciar sesión con el correo nuevo.</p>
          <a href="/login" className={authLinkClass}>Ir al inicio de sesión</a>
        </div>
      ) : !user ? (
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Inicia sesión para continuar</h2>
          <p className="text-slate-600 leading-relaxed mb-8">Para confirmar el cambio, entra con tu cuenta (todavía con el correo actual).</p>
          <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className={authLinkClass}>Iniciar sesión</Link>
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            confirm.mutate({ token });
          }}
        >
          <p className="text-slate-600">
            Vas a cambiar el correo de acceso de la cuenta <strong>{user.email}</strong>.
          </p>
          {confirm.error && <AuthAlert id="verify-error">{confirm.error.message}</AuthAlert>}
          <AuthSubmit loading={confirm.isPending} loadingLabel="Confirmando…">Confirmar el cambio</AuthSubmit>
        </form>
      )}
    </AuthShell>
  );
}
