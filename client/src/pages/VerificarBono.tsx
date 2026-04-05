/**
 * VerificarBono — Página pública de consulta de bonos compensatorios Náyade.
 * El cliente introduce su código de bono y puede ver el estado, valor y caducidad
 * sin necesidad de autenticarse.
 */
import React, { useState, useEffect } from "react";
import { Link, useSearch } from "wouter";
import {
  Gift, Search, CheckCircle2, XCircle, Clock, AlertTriangle,
  ArrowRight, Euro, CalendarClock, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  enviado: {
    label: "Activo — pendiente de canjear",
    icon: <CheckCircle2 className="w-5 h-5 text-green-400" />,
    color: "border-green-500/30 bg-green-500/5",
    textColor: "text-green-400",
  },
  generado: {
    label: "Activo — pendiente de canjear",
    icon: <CheckCircle2 className="w-5 h-5 text-green-400" />,
    color: "border-green-500/30 bg-green-500/5",
    textColor: "text-green-400",
  },
  canjeado: {
    label: "Ya canjeado",
    icon: <CheckCircle2 className="w-5 h-5 text-blue-400" />,
    color: "border-blue-500/30 bg-blue-500/5",
    textColor: "text-blue-400",
  },
  caducado: {
    label: "Caducado",
    icon: <XCircle className="w-5 h-5 text-red-400" />,
    color: "border-red-500/30 bg-red-500/5",
    textColor: "text-red-400",
  },
  anulado: {
    label: "Anulado",
    icon: <XCircle className="w-5 h-5 text-gray-400" />,
    color: "border-gray-500/30 bg-gray-500/5",
    textColor: "text-gray-400",
  },
} as const;

// ─── Componente principal ─────────────────────────────────────────────────────

export default function VerificarBono() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const codeFromUrl = params.get("code")?.toUpperCase().trim() ?? null;

  const [inputCode, setInputCode] = useState(codeFromUrl ?? "");
  const [queryCode, setQueryCode] = useState<string | null>(codeFromUrl);

  // Si llega con ?code= en la URL, lanzar la consulta automáticamente
  useEffect(() => {
    if (codeFromUrl) {
      setInputCode(codeFromUrl);
      setQueryCode(codeFromUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading, isFetching } = trpc.discounts.verifyVoucher.useQuery(
    { code: queryCode ?? "" },
    { enabled: !!queryCode }
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputCode.trim().toUpperCase();
    if (trimmed.length < 3) return;
    setQueryCode(trimmed);
  }

  const statusCfg = data?.found && data.status
    ? STATUS_CONFIG[data.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.enviado
    : null;

  const isActive = data?.found && (data.status === "enviado" || data.status === "generado");

  return (
    <PublicLayout>
      <div className="min-h-screen bg-[#0a0a0a] text-white">

        {/* ── Hero ── */}
        <div className="relative py-20 px-4 text-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-[#1a0a2e]/60 to-transparent pointer-events-none" />
          <div className="relative max-w-xl mx-auto">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 mb-6">
              <Gift className="w-8 h-8 text-purple-400" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              Verificar bono de compensación
            </h1>
            <p className="text-gray-400 text-base leading-relaxed">
              Introduce el código de tu bono para consultar su estado, valor y fecha de caducidad.
            </p>
          </div>
        </div>

        {/* ── Formulario de consulta ── */}
        <div className="max-w-lg mx-auto px-4 pb-20">
          <form onSubmit={handleSubmit} className="flex gap-2 mb-8">
            <Input
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              placeholder="Ej: BON-A1B2-C3D4"
              className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 font-mono text-sm h-11 flex-1"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="submit"
              disabled={inputCode.trim().length < 3 || isLoading || isFetching}
              className="bg-purple-600 hover:bg-purple-700 text-white px-5 h-11"
            >
              {isLoading || isFetching
                ? <Clock className="w-4 h-4 animate-spin" />
                : <Search className="w-4 h-4" />
              }
            </Button>
          </form>

          {/* ── Resultado ── */}
          {data && !data.found && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 text-center">
              <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-300 font-medium">Código no encontrado</p>
              <p className="text-gray-500 text-sm mt-1">
                Comprueba que el código es correcto o contacta con nosotros.
              </p>
            </div>
          )}

          {data?.found && statusCfg && (
            <div className={`rounded-xl border ${statusCfg.color} p-5 space-y-4`}>

              {/* Cabecera estado */}
              <div className="flex items-center gap-3">
                {statusCfg.icon}
                <div>
                  <p className={`font-semibold text-base ${statusCfg.textColor}`}>{statusCfg.label}</p>
                  <p className="text-gray-500 text-xs font-mono">{data.code}</p>
                </div>
              </div>

              <hr className="border-white/10" />

              {/* Detalles */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {data.value > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-500 text-xs flex items-center gap-1"><Euro className="w-3 h-3" />Valor</span>
                    <span className="text-white font-bold text-lg">{data.value.toFixed(2)} €</span>
                  </div>
                )}
                {data.expiresAt && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-500 text-xs flex items-center gap-1"><CalendarClock className="w-3 h-3" />Válido hasta</span>
                    <span className="text-white font-medium">
                      {new Date(data.expiresAt).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}
                    </span>
                  </div>
                )}
                {!data.expiresAt && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-500 text-xs flex items-center gap-1"><CalendarClock className="w-3 h-3" />Caducidad</span>
                    <span className="text-gray-400 font-medium">Sin caducidad</span>
                  </div>
                )}
                {data.activityName && (
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-gray-500 text-xs">Actividad</span>
                    <span className="text-white font-medium">{data.activityName}</span>
                  </div>
                )}
              </div>

              {data.conditions && (
                <div className="bg-white/5 rounded-lg p-3 text-xs text-gray-400 leading-relaxed">
                  <p className="text-gray-300 font-medium mb-1 flex items-center gap-1"><Info className="w-3 h-3" />Condiciones de uso</p>
                  {data.conditions}
                </div>
              )}

              {/* CTA si el bono está activo */}
              {isActive && (
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4 text-center">
                  <p className="text-purple-200 text-sm font-medium mb-1">¿Listo para usarlo?</p>
                  <p className="text-gray-400 text-xs mb-3">
                    Aplica este código al hacer tu reserva online. El importe se descontará automáticamente.
                  </p>
                  <Link href="/experiencias">
                    <Button className="bg-purple-600 hover:bg-purple-700 text-white text-sm gap-2">
                      Ver experiencias <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              )}

              {data.status === "canjeado" && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-center">
                  <p className="text-blue-200 text-sm">
                    Este bono ya fue utilizado en una reserva. Si crees que es un error, contacta con nosotros.
                  </p>
                </div>
              )}

              {data.status === "caducado" && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center">
                  <p className="text-red-200 text-sm">
                    Este bono ha caducado. Si necesitas ayuda, contacta con nuestro equipo.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Aviso informativo ── */}
          {!data && !isLoading && (
            <div className="mt-8 rounded-xl border border-white/5 bg-white/3 p-5 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-400/60 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">
                Los bonos de compensación solo son válidos para reservas a través de esta web.<br />
                Si tienes dudas, contacta con nosotros indicando tu número de expediente.
              </p>
            </div>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
