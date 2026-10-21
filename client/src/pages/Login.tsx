/**
 * Login.tsx — Inicio de sesión del panel de la empresa que sirve el dominio (LOCAL_AUTH=true).
 *
 * Llama a POST /api/auth/login, obtiene la cookie de sesión y redirige al destino. El aspecto (marca, colores,
 * fondo y mensaje) es el de la empresa (`AuthShell` + `shared/loginBrand.ts`); la autenticación no cambia.
 */

import { useState, useEffect, useId } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { AuthAlert, AuthLoading, AuthShell, AuthSubmit, authInputClass, authLinkClass, useLoginLook } from "@/components/auth/AuthShell";
import { loginErrorMessage, validateLogin, type LoginErrors } from "@shared/authForm";

/**
 * Página de inicio según el rol del usuario. Los partners van a su panel,
 * los empleados al Portal del Empleado, el resto al panel de admin.
 * Sin esto, un empleado aterrizaba en /admin y recibía "Sin permisos".
 * Nota: 'monitor' sí tiene acceso al panel de admin (Operaciones), por eso
 * no se redirige al portal — va a /admin como el resto.
 */
function homeForRole(role: string | undefined): string {
  if (role === "partner_admin" || role === "partner_user") return "/partner/dashboard";
  if (role === "supplier") return "/supplier/dashboard";
  if (role === "employee") return "/empleado";
  if (role === "gestoria") return "/gestoria";
  return "/admin";
}

/** Solo rutas internas: un `returnTo` hacia otro dominio no redirige fuera. */
function safeReturnTo(): string | null {
  const r = new URLSearchParams(window.location.search).get("returnTo");
  return r && r.startsWith("/") && !r.startsWith("//") && !r.startsWith("/\\") ? r : null;
}

export interface LoginFormProps {
  email: string;
  password: string;
  onEmail?: (v: string) => void;
  onPassword?: (v: string) => void;
  errors?: LoginErrors;
  error?: string | null;
  loading?: boolean;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Vista previa: no envía nada ni navega. */
  preview?: boolean;
}

/** Formulario de acceso (también lo usa la vista previa del administrador). */
export function LoginForm({ email, password, onEmail, onPassword, errors = {}, error, loading = false, onSubmit, preview = false }: LoginFormProps) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Iniciar sesión</h2>
        <p className="text-slate-600">Accede con tu correo y tu contraseña.</p>
      </div>

      <form onSubmit={preview ? (e) => e.preventDefault() : onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor={`${id}-email`} className="text-slate-800 text-sm font-medium">Correo electrónico</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
            <Input
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              readOnly={preview}
              onChange={(e) => onEmail?.(e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? `${id}-email-err` : undefined}
              className={`pl-10 ${authInputClass}`}
            />
          </div>
          {errors.email && <p id={`${id}-email-err`} className="text-sm text-red-700">{errors.email}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${id}-password`} className="text-slate-800 text-sm font-medium">Contraseña</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
            <Input
              id={`${id}-password`}
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              readOnly={preview}
              onChange={(e) => onPassword?.(e.target.value)}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? `${id}-pass-err` : undefined}
              className={`pl-10 pr-12 ${authInputClass}`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={show}
              aria-controls={`${id}-password`}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--auth-link)]"
            >
              {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
            </button>
          </div>
          {errors.password && <p id={`${id}-pass-err`} className="text-sm text-red-700">{errors.password}</p>}
        </div>

        <div className="flex justify-end">
          {preview ? (
            <span className={authLinkClass}>¿Has olvidado tu contraseña?</span>
          ) : (
            <Link href="/recuperar-contrasena" className={authLinkClass}>¿Has olvidado tu contraseña?</Link>
          )}
        </div>

        <div aria-live="assertive">{error && <AuthAlert>{error}</AuthAlert>}</div>

        <AuthSubmit loading={loading} loadingLabel="Entrando…">Entrar</AuthSubmit>
      </form>
    </>
  );
}

export default function Login() {
  const { look } = useLoginLook();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Si ya hay sesión activa, redirigir
  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });

  useEffect(() => {
    if (meQuery.data) navigate(safeReturnTo() ?? homeForRole((meQuery.data as { role?: string } | null)?.role));
  }, [meQuery.data, navigate]);

  useEffect(() => {
    if (look?.brand.fullName) document.title = `Iniciar sesión · ${look.brand.fullName}`;
  }, [look?.brand.fullName]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    const v = validateLogin(email, password);
    setErrors(v);
    if (v.email || v.password) {
      // Foco en el primer campo con error (tras pintar los mensajes)
      setTimeout(() => form.querySelector<HTMLInputElement>("[aria-invalid='true']")?.focus(), 0);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        setError(loginErrorMessage(res.status, data.error));
        return;
      }
      // Invalidar caché de auth para que useAuth recargue el usuario
      await utils.auth.me.invalidate();
      const me = await utils.auth.me.fetch();
      navigate(safeReturnTo() ?? homeForRole((me as { role?: string } | null)?.role));
    } catch {
      setError("No hay conexión con el servidor. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (meQuery.isLoading || !look) return <AuthLoading />;

  return (
    <AuthShell look={look}>
      <LoginForm
        email={email}
        password={password}
        onEmail={(v) => {
          setEmail(v);
          if (errors.email) setErrors({ ...errors, email: undefined });
        }}
        onPassword={(v) => {
          setPassword(v);
          if (errors.password) setErrors({ ...errors, password: undefined });
        }}
        errors={errors}
        error={error}
        loading={loading}
        onSubmit={handleSubmit}
      />
      <div className="mt-8 text-center">
        <a href="/" className="text-sm text-slate-500 hover:text-slate-800 underline-offset-4 hover:underline">← Volver a la web</a>
      </div>
    </AuthShell>
  );
}
