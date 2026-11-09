/**
 * Alta de la prueba repetida a la vez con la MISMA clave de idempotencia (doble envío del formulario): la segunda
 * petición devuelve la solicitud que creó la primera, nunca «Ya hay una solicitud de prueba en curso». Se reproducen
 * de forma determinista las dos ventanas de la carrera que vio el CI con MySQL (server/trials.mysql.test.ts):
 *  1) la segunda lee la clave antes de que la primera inserte, y la comprobación del correo ya la ve abierta;
 *  2) las dos pasan las comprobaciones y MySQL rechaza la segunda por el índice del correo antes que por el de la clave.
 * Con OTRA clave el correo sigue sin admitir una segunda prueba abierta.
 */
import { describe, it, expect } from "vitest";
import { MemoryTrialStore, TrialConflict, type TrialStore } from "./trials/store";
import { TrialError, TrialService } from "./trials/service";

const input = (key: string, email = "idem@acme.es") => ({ email, companyName: "Acme", configuration: { plan: null, addons: [] as string[] }, idempotencyKey: key });
// Claves de idempotencia ficticias (las genera el navegador): se construyen aquí, sin aspecto de credencial
const idem = (n: number) => `idem-${String(n).repeat(32)}`;
const KEY = idem(1);

describe("misma clave a la vez: la existente, nunca el conflicto del correo", () => {
  it("ventana 1: la clave se leyó antes de que la otra petición insertara", async () => {
    const store = new MemoryTrialStore();
    const first = await new TrialService({ store }).register(input(KEY));
    // La segunda petición leyó la clave cuando aún no existía (lectura atrasada); después el correo ya está abierto
    let stale = true;
    const racing = new Proxy(store, {
      get(target, prop, recv) {
        if (prop === "byIdempotencyKey") return async (k: string) => (stale ? ((stale = false), null) : target.byIdempotencyKey(k));
        return Reflect.get(target, prop, recv);
      },
    }) as TrialStore;
    const second = await new TrialService({ store: racing }).register(input(KEY));
    expect(second).toEqual({ trial: expect.objectContaining({ id: first.trial.id }), created: false, verificationToken: null });
  });

  it("ventana 2: MySQL avisa antes del índice del correo que del de la clave", async () => {
    const store = new MemoryTrialStore();
    const first = await new TrialService({ store }).register(input(KEY));
    let reads = 0;
    const racing = new Proxy(store, {
      get(target, prop, recv) {
        // Las comprobaciones previas no ven nada (la otra petición aún no había insertado)…
        if (prop === "byIdempotencyKey") return async (k: string) => (reads++ === 0 ? null : target.byIdempotencyKey(k));
        if (prop === "openByEmail" || prop === "openByMailbox") return async () => null;
        // …y el INSERT choca con el índice del correo
        if (prop === "insert") return async () => Promise.reject(new TrialConflict("duplicate_email", "correo"));
        return Reflect.get(target, prop, recv);
      },
    }) as TrialStore;
    const second = await new TrialService({ store: racing }).register(input(KEY));
    expect(second).toEqual({ trial: expect.objectContaining({ id: first.trial.id }), created: false, verificationToken: null });
  });

  it("con otra clave, el mismo correo sigue sin admitir una segunda prueba abierta", async () => {
    const store = new MemoryTrialStore();
    const svc = new TrialService({ store });
    await svc.register(input(KEY));
    await expect(svc.register(input(idem(2)))).rejects.toMatchObject({ code: "conflict" });
    await expect(svc.register(input(idem(2)))).rejects.toBeInstanceOf(TrialError);
  });

  it("la misma clave con otro correo no devuelve la prueba ajena", async () => {
    const store = new MemoryTrialStore();
    const svc = new TrialService({ store });
    await svc.register(input(KEY));
    await expect(svc.register(input(KEY, "otra-persona@otra.es"))).rejects.toMatchObject({ code: "conflict" });
  });
});
