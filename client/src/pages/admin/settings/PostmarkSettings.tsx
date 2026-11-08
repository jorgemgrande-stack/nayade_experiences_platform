/**
 * Correo transaccional con Postmark (/admin/configuracion/postmark): activación guiada con la cuenta PROPIA de la
 * empresa. 1) pegar el token del servidor y el remitente, 2) comprobar (solo lectura), 3) copiar en Postmark la URL del
 * webhook y su token, 4) ver el estado. Sin configurar, los correos salen por el servicio de Elephant Source. Las
 * campañas comerciales no pasan por aquí (van por Brevo marketing). La autorización la aplica el servidor.
 */
import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Mail, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";

const STAT_LABEL: Record<string, string> = {
  accepted: "Aceptados",
  delivered: "Entregados",
  soft_bounced: "Rebotes temporales",
  bounced: "Rebotados",
  blocked: "Bloqueados",
  complained: "Quejas",
  failed: "Con error",
  pending: "En cola",
};

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copiado`);
  } catch {
    toast.error("No se ha podido copiar: selecciónalo y cópialo a mano");
  }
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label={title}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {done ? <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs">{n}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function PostmarkSettings() {
  const utils = trpc.useUtils();
  const status = trpc.postmarkTenant.status.useQuery(undefined, { retry: false });
  const [token, setToken] = useState("");
  const [stream, setStream] = useState("");
  const [from, setFrom] = useState("");
  const [newWebhookToken, setNewWebhookToken] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const refresh = () => utils.postmarkTenant.status.invalidate();
  const save = trpc.postmarkTenant.save.useMutation({ onSuccess: () => (toast.success("Datos guardados"), setToken(""), refresh()), onError: (e) => toastError(e) });
  const verify = trpc.postmarkTenant.verify.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const gen = trpc.postmarkTenant.generateWebhookToken.useMutation({ onSuccess: (r) => (setNewWebhookToken(r.token), refresh()), onError: (e) => toastError(e) });
  const off = trpc.postmarkTenant.disconnect.useMutation({ onSuccess: () => (toast.success("Postmark desconectado: los correos vuelven al servicio de Elephant Source"), setNewWebhookToken(null), refresh()), onError: (e) => toastError(e) });

  const s = status.data;
  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ajustes · Correo</p>
          <h1 className="text-2xl font-bold text-foreground">Correo transaccional con Postmark</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Opcional. Tus confirmaciones, facturas y avisos salen por tu propia cuenta de Postmark, con tu dominio, y en la ficha de cada cliente ves si le han llegado. Mientras no
            lo actives, se envían igualmente desde el servicio de correo de Elephant Source. Las campañas comerciales no pasan por Postmark: se envían con{" "}
            <Link href="/admin/marketing/brevo" className="text-primary underline-offset-4 hover:underline">Brevo marketing</Link>.
          </p>
        </header>

        <section aria-labelledby="vias-correo" className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <h2 id="vias-correo" className="font-semibold text-foreground">Cómo salen tus correos</h2>
          <p className="text-muted-foreground">Está incluido en tu plan (Essential, Business y Enterprise), sin coste adicional en Elephant Source. Puedes usar una de estas tres vías:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Tu cuenta de Postmark</span> (esta pantalla), solo para los correos transaccionales. Postmark te factura
              directamente a ti.
            </li>
            <li>
              <span className="font-medium text-foreground">Tu propio servidor SMTP</span>, en{" "}
              <Link href="/admin/configuracion/integraciones" className="text-primary underline-offset-4 hover:underline">Integraciones</Link>. Lo paga quien lo contrata.
            </li>
            <li>
              <span className="font-medium text-foreground">El servicio de correo de Elephant Source</span>, si no configuras ninguna de las anteriores o si tu cuenta
              falla (entonces el correo sale por este servicio para que no se pierda). Elephant Source mide este consumo y le aplica los límites del servicio.
            </li>
          </ul>
          <p className="text-muted-foreground">Lo que sale por tu propia cuenta (Postmark o SMTP) no cuenta para esos límites: Elephant Source solo lo registra, y en la ficha de cada cliente ves si le ha llegado.</p>
        </section>

        {status.isLoading && <PanelLoading />}
        {status.error && <PanelError error={status.error} onRetry={() => status.refetch()} />}
        {s && (
          <>
            <div role="status" className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${s.active ? "border-primary/40 bg-primary/5 text-foreground" : "border-border bg-muted/40 text-foreground"}`}>
              {s.active ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{s.active ? `Activo: tus correos transaccionales salen por Postmark desde ${s.fromEmail}.` : "Inactivo: tus correos salen por el servicio de Elephant Source."}</p>
                {s.problemText && s.configured && <p className="text-muted-foreground">{s.problemText}</p>}
                {s.lastCheck && (
                  <p className="text-muted-foreground">
                    Última comprobación ({new Date(s.lastCheck.at).toLocaleString("es-ES")}): {s.lastCheck.message}
                  </p>
                )}
              </div>
            </div>

            <Step n={1} title="Pega el token de tu servidor de Postmark" done={s.serverToken.set && !!s.fromEmail}>
              <p className="text-sm text-muted-foreground">
                En Postmark, crea un servidor para tu empresa, entra en <strong>API Tokens</strong> y copia el <strong>Server API token</strong> (no el de la cuenta). Se guarda cifrado y no se vuelve a mostrar.
              </p>
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate({ serverToken: token || undefined, messageStream: stream || undefined, fromEmail: from || undefined });
                }}
              >
                <label className="space-y-1.5 text-sm font-medium text-foreground sm:col-span-2">
                  <span className="flex items-center gap-1.5">
                    Token del servidor <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-label="Se guarda cifrado" />
                    {s.serverToken.set && <span className="text-xs font-normal text-muted-foreground">Guardado: {s.serverToken.display}</span>}
                  </span>
                  <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.serverToken.set ? "Déjalo vacío para conservar el actual" : "Pega aquí el Server API token"} />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>Dirección del remitente</span>
                  <Input type="email" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={s.fromEmail ?? "reservas@tuempresa.es"} />
                  <span className="block text-xs font-normal text-muted-foreground">De un dominio propio verificado y firmado (DKIM y Return-Path) en Postmark.</span>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>Flujo transaccional</span>
                  <Input value={stream} onChange={(e) => setStream(e.target.value)} placeholder={s.messageStream} />
                  <span className="block text-xs font-normal text-muted-foreground">Normalmente «outbound». Nunca uno de difusión (broadcast).</span>
                </label>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={save.isPending || (!token && !stream && !from)}>Guardar</Button>
                </div>
              </form>
            </Step>

            <Step n={2} title="Comprueba la conexión y tu dominio" done={s.connection === "connected" && s.sender.verified}>
              <p className="text-sm text-muted-foreground">Solo consulta tu servidor y el flujo en Postmark: no envía nada.</p>
              <dl className="grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted-foreground">Dominio del remitente</dt>
                <dd className="break-words text-foreground">
                  {s.sender.domain ?? "—"} {s.sender.domain && (s.sender.verified ? <span className="text-primary">(verificado en tu empresa)</span> : <span className="text-amber-700 dark:text-amber-300">(no verificado)</span>)}
                </dd>
                <dt className="text-muted-foreground">Dominios verificados</dt>
                <dd className="break-words text-foreground">{s.sender.verifiedDomains.length ? s.sender.verifiedDomains.join(", ") : "Ninguno"}</dd>
              </dl>
              <p className="text-xs text-muted-foreground">
                La firma del dominio (DKIM y Return-Path) se confirma en Postmark, en <strong>Sender Signatures</strong>: si falta, Postmark rechaza el envío y lo verás en la ficha del cliente. Tus dominios se
                verifican en <Link href="/admin/configuracion/dominios" className="text-primary underline-offset-4 hover:underline">Dominios</Link>.
              </p>
              <Button variant="outline" disabled={!s.serverToken.set || verify.isPending} onClick={() => verify.mutate()}>
                Probar conexión
              </Button>
              {verify.data && (
                <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
                  <p className={verify.data.ok ? "text-foreground" : "text-destructive"}>{verify.data.message}</p>
                  {verify.data.serverName && <p className="text-muted-foreground">Servidor: {verify.data.serverName} · {verify.data.deliveryType ?? "—"}</p>}
                  {verify.data.stream.found && <p className="text-muted-foreground">Flujo «{verify.data.stream.id}»: {verify.data.stream.type}</p>}
                  {verify.data.sender.problemText && <p className="text-amber-700 dark:text-amber-300">{verify.data.sender.problemText}</p>}
                </div>
              )}
            </Step>

            <Step n={3} title="Conecta el webhook de entregas en Postmark" done={s.webhook.configured}>
              <p className="text-sm text-muted-foreground">
                En Postmark: tu servidor → flujo «{s.messageStream}» → <strong>Webhooks</strong> → <strong>Add webhook</strong>. Pega la URL, añade una cabecera personalizada con el nombre y el token de abajo y marca
                los eventos {s.webhook.events.join(", ")}. No actives aperturas ni clics.
              </p>
              <dl className="grid gap-2 text-sm">
                <dt className="text-muted-foreground">URL del webhook</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{s.webhook.url ?? "Tu empresa aún no tiene dirección pública"}</code>
                  {s.webhook.url && (
                    <Button size="sm" variant="ghost" onClick={() => copy(s.webhook.url!, "URL")} aria-label="Copiar la URL del webhook">
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </dd>
                <dt className="text-muted-foreground">Nombre de la cabecera</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 text-xs text-foreground">{s.webhook.header}</code>
                  <Button size="sm" variant="ghost" onClick={() => copy(s.webhook.header, "Nombre de la cabecera")} aria-label="Copiar el nombre de la cabecera">
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </dd>
                <dt className="text-muted-foreground">Valor de la cabecera (token)</dt>
                <dd className="space-y-2">
                  {newWebhookToken ? (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{newWebhookToken}</code>
                        <Button size="sm" variant="ghost" onClick={() => copy(newWebhookToken, "Token")} aria-label="Copiar el token">
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <p className="text-xs text-amber-700 dark:text-amber-300">Cópialo ahora: no se volverá a mostrar. Si lo pierdes, genera otro y cámbialo en Postmark.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{s.webhook.configured ? "Generado y guardado cifrado." : "Aún no lo has generado."}</p>
                  )}
                  <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate()}>
                    <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {s.webhook.configured ? "Generar otro token" : "Generar token"}
                  </Button>
                </dd>
              </dl>
            </Step>

            <Step n={4} title="Estado de los envíos (últimos 30 días)">
              {s.stats30d && Object.keys(s.stats30d).length ? (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {Object.entries(s.stats30d).map(([k, n]) => (
                    <li key={k} className="rounded-full border border-border px-3 py-1 text-foreground">
                      {STAT_LABEL[k] ?? k}: <strong>{n}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" aria-hidden="true" /> Aún no ha salido ningún correo por tu Postmark.
                </p>
              )}
              <p className="text-xs text-muted-foreground">El detalle de cada envío (entregado, rebotado…) y el aviso de direcciones suprimidas está en la ficha de cada cliente.</p>
            </Step>

            {s.configured && (
              <div className="flex justify-end">
                <Button variant="ghost" className="text-destructive" onClick={() => setConfirmOff(true)}>
                  <Unplug className="mr-1.5 h-4 w-4" aria-hidden="true" /> Desconectar Postmark
                </Button>
              </div>
            )}
          </>
        )}
        <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Desconectar tu cuenta de Postmark?</AlertDialogTitle>
              <AlertDialogDescription>Se borran el token, el remitente y el token del webhook. Tus correos vuelven a salir por el servicio de Elephant Source. El historial de entregas se conserva.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => off.mutate()}>Desconectar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AdminLayout>
  );
}
