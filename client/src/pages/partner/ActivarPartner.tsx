import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock, Loader2, CheckCircle, AlertCircle } from "lucide-react";

export default function ActivarPartner() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [userName, setUserName] = useState("");

  const activate = trpc.partners.activateInvite.useMutation({
    onSuccess: (data) => {
      setUserName(data.name ?? "");
      setDone(true);
    },
    onError: (e) => setError(e.message),
  });

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-gray-600">Enlace de activación inválido.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-sm w-full text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2">¡Cuenta activada!</h2>
          <p className="text-gray-500 text-sm mb-6">
            Bienvenido, {userName}. Tu cuenta de colaborador está lista.
          </p>
          <Button
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => navigate("/login?returnTo=/partner/dashboard")}
          >
            Ir al portal
          </Button>
        </div>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres"); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden"); return; }
    activate.mutate({ token, password });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6 text-orange-500" />
          </div>
          <h1 className="text-xl font-semibold text-gray-800">Activar cuenta</h1>
          <p className="text-gray-500 text-sm mt-1">Elige una contraseña para tu cuenta de colaborador</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="password" className="text-sm text-gray-600">Contraseña</Label>
            <div className="relative mt-1">
              <Input
                id="password"
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="pr-10"
                required
              />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPwd(v => !v)}>
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="confirm" className="text-sm text-gray-600">Confirmar contraseña</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repite la contraseña"
              className="mt-1"
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            disabled={activate.isPending}
          >
            {activate.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Activar cuenta
          </Button>
        </form>
      </div>
    </div>
  );
}
