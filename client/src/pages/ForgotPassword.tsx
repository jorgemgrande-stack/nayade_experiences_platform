/**
 * ForgotPassword.tsx — Página /recuperar-contrasena
 *
 * Muestra un formulario donde el usuario introduce su email.
 * Llama a POST /api/auth/forgot-password y muestra confirmación. Aspecto: el de la empresa (AuthShell).
 */

import { useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { AuthAlert, AuthLoading, AuthShell, AuthSubmit, authInputClass, authLinkClass, useLoginLook } from "@/components/auth/AuthShell";
import { validateEmail } from "@shared/authForm";

export default function ForgotPassword() {
  const { look } = useLoginLook();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const v = validateEmail(email);
    setEmailError(v);
    if (v) {
      e.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), origin: window.location.origin }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(res.status === 429 ? "Demasiadas solicitudes seguidas. Espera unos minutos y vuelve a intentarlo." : data.error ?? "No se ha podido enviar el correo. Inténtalo de nuevo.");
        return;
      }
      setSent(true);
    } catch {
      setError("No hay conexión con el servidor. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (!look) return <AuthLoading />;

  return (
    <AuthShell look={look} title="¿Has olvidado tu contraseña?" titleHighlight="contraseña" message="No te preocupes: te enviaremos un enlace seguro para crear una nueva.">
      {sent ? (
        <div className="text-center" role="status">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-emerald-700" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Revisa tu correo</h2>
          <p className="text-slate-600 leading-relaxed mb-2">
            Si existe una cuenta con <strong className="text-slate-900">{email.trim()}</strong>, recibirás un enlace para restablecer tu contraseña en los próximos minutos.
          </p>
          <p className="text-slate-500 text-sm mb-8">El enlace caduca en 60 minutos. Revisa también la carpeta de correo no deseado.</p>
          <Link href="/login" className={`inline-flex items-center gap-1 ${authLinkClass}`}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Volver al inicio de sesión
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Recuperar contraseña</h2>
            <p className="text-slate-600">Escribe tu correo y te enviaremos un enlace para restablecer tu contraseña.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-800 text-sm font-medium">Correo electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(undefined);
                  }}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? "email-err" : undefined}
                  className={`pl-10 ${authInputClass}`}
                />
              </div>
              {emailError && <p id="email-err" className="text-sm text-red-700">{emailError}</p>}
            </div>
            <div aria-live="assertive">{error && <AuthAlert>{error}</AuthAlert>}</div>
            <AuthSubmit loading={loading} loadingLabel="Enviando enlace…">Enviar enlace de recuperación</AuthSubmit>
          </form>
          <div className="mt-6 text-center">
            <Link href="/login" className={`inline-flex items-center gap-1 ${authLinkClass}`}>
              <ArrowLeft className="w-3 h-3" aria-hidden="true" />
              Volver al inicio de sesión
            </Link>
          </div>
        </>
      )}
    </AuthShell>
  );
}
