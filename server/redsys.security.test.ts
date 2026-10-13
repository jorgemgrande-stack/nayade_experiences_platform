/**
 * Seguridad de la firma y de la notificación (IPN) de Redsys.
 *
 * Hasta ahora no había pruebas del cálculo de la firma ni de la validación del IPN, que es
 * lo único que impide marcar una reserva como pagada con una notificación falsificada.
 * La clave de estas pruebas es ficticia; la firma de referencia se calcula con una
 * implementación independiente (3DES-CBC del pedido + HMAC-SHA256) escrita aquí.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";

// Clave ficticia de 24 bytes (base64), no es una credencial real.
const FAKE_KEY_B64 = Buffer.from("clave-ficticia-24-bytes!").toString("base64");

function referenceSignature(base64Params: string, order: string, keyB64 = FAKE_KEY_B64): string {
  const key = Buffer.from(keyB64, "base64").subarray(0, 24);
  const padded = Buffer.alloc(Math.ceil(Buffer.byteLength(order) / 8) * 8, 0);
  Buffer.from(order).copy(padded);
  const cipher = crypto.createCipheriv("des-ede3-cbc", key, Buffer.alloc(8, 0));
  cipher.setAutoPadding(false);
  const derived = Buffer.concat([cipher.update(padded), cipher.final()]);
  return crypto.createHmac("sha256", derived).update(base64Params).digest("base64");
}

function notification(data: Record<string, string>, opts: { key?: string; signOrder?: string } = {}) {
  const params = Buffer.from(JSON.stringify(data)).toString("base64");
  const order = opts.signOrder ?? data.Ds_Order ?? data.DS_MERCHANT_ORDER ?? "";
  return {
    Ds_SignatureVersion: "HMAC_SHA256_V1",
    Ds_MerchantParameters: params,
    Ds_Signature: referenceSignature(params, order, opts.key),
  };
}

const ENV = { ...process.env };
let redsys: typeof import("./redsys");

beforeEach(async () => {
  process.env.REDSYS_MERCHANT_KEY = FAKE_KEY_B64;
  process.env.REDSYS_MERCHANT_CODE = "999008881";
  process.env.REDSYS_MERCHANT_TERMINAL = "1";
  process.env.REDSYS_ENVIRONMENT = "test";
  vi.spyOn(console, "log").mockImplementation(() => {});
  redsys = await import("./redsys");
});
afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe("buildRedsysForm", () => {
  const base = {
    amount: 1500,
    merchantOrder: "1234AB12CD",
    productDescription: "Actividad de prueba",
    notifyUrl: "https://app.ejemplo.test/api/redsys/notification",
    okUrl: "https://app.ejemplo.test/reserva/ok",
    koUrl: "https://app.ejemplo.test/reserva/error",
  };

  it("firma con HMAC-SHA256 y clave derivada 3DES igual que la implementación de referencia", () => {
    const f = redsys.buildRedsysForm(base);
    expect(f.Ds_SignatureVersion).toBe("HMAC_SHA256_V1");
    expect(f.Ds_Signature).toBe(referenceSignature(f.Ds_MerchantParameters, base.merchantOrder));
  });

  it("los parámetros codifican el importe en céntimos, la moneda y el terminal con relleno", () => {
    const f = redsys.buildRedsysForm(base);
    const p = JSON.parse(Buffer.from(f.Ds_MerchantParameters, "base64").toString("utf8"));
    expect(p).toMatchObject({
      DS_MERCHANT_AMOUNT: "1500",
      DS_MERCHANT_ORDER: "1234AB12CD",
      DS_MERCHANT_CURRENCY: "978",
      DS_MERCHANT_TERMINAL: "001",
      DS_MERCHANT_TRANSACTIONTYPE: "0",
    });
  });

  it("usa el entorno de pruebas salvo que se indique producción explícitamente", () => {
    expect(redsys.buildRedsysForm(base).url).toContain("sis-t.redsys.es");
    process.env.REDSYS_ENVIRONMENT = "production";
    expect(redsys.buildRedsysForm(base).url).toBe("https://sis.redsys.es/sis/realizarPago");
    process.env.REDSYS_ENVIRONMENT = "cualquier-otro";
    expect(redsys.buildRedsysForm(base).url).toContain("sis-t.redsys.es");
  });

  it("rechaza importes no válidos y pedidos mal formados antes de firmar", () => {
    expect(() => redsys.buildRedsysForm({ ...base, amount: 0 })).toThrow(/Importe/);
    expect(() => redsys.buildRedsysForm({ ...base, amount: -5 })).toThrow(/Importe/);
    expect(() => redsys.buildRedsysForm({ ...base, merchantOrder: "" })).toThrow(/vacío/);
    expect(() => redsys.buildRedsysForm({ ...base, merchantOrder: "ABCD123456" })).toThrow(/numéricos/);
    expect(() => redsys.buildRedsysForm({ ...base, merchantOrder: "12345678901234" })).toThrow(/entre 4 y 12/);
    expect(() => redsys.buildRedsysForm({ ...base, merchantOrder: "1234-AB_12" })).toThrow(/no permitidos/);
  });

  it("falla de forma visible si falta la clave o el código de comercio", () => {
    delete process.env.REDSYS_MERCHANT_KEY;
    expect(() => redsys.buildRedsysForm(base)).toThrow(/MERCHANT_KEY/);
    process.env.REDSYS_MERCHANT_KEY = FAKE_KEY_B64;
    delete process.env.REDSYS_MERCHANT_CODE;
    expect(() => redsys.buildRedsysForm(base)).toThrow(/MERCHANT_CODE/);
  });
});

describe("validateRedsysNotification (IPN)", () => {
  const paid = { Ds_Order: "1234AB12CD", Ds_Response: "0000", Ds_Amount: "1500", Ds_AuthorisationCode: "123456" };

  it("acepta una notificación correctamente firmada y la marca como autorizada", () => {
    const r = redsys.validateRedsysNotification(notification(paid));
    expect(r.isValid).toBe(true);
    expect(r.isAuthorized).toBe(true);
    expect(r).toMatchObject({ merchantOrder: "1234AB12CD", amount: 1500, responseCode: "0000", authCode: "123456" });
  });

  it("rechaza una firma alterada", () => {
    const n = notification(paid);
    const sig = n.Ds_Signature;
    n.Ds_Signature = sig.slice(0, -2) + (sig.endsWith("A=") ? "B=" : "A=");
    const r = redsys.validateRedsysNotification(n);
    expect(r.isValid).toBe(false);
    expect(r.isAuthorized).toBe(false);
  });

  it("rechaza parámetros alterados con la firma original (cambio de importe o de resultado)", () => {
    const original = notification(paid);
    for (const tampered of [
      { ...paid, Ds_Amount: "1" },
      { ...paid, Ds_Response: "0000", Ds_AuthorisationCode: "999999" },
      { ...paid, Ds_Order: "9999ZZ99ZZ" },
    ]) {
      const forged = {
        ...original,
        Ds_MerchantParameters: Buffer.from(JSON.stringify(tampered)).toString("base64"),
      };
      expect(redsys.validateRedsysNotification(forged).isValid).toBe(false);
    }
  });

  it("rechaza una firma hecha con otra clave de comercio", () => {
    const other = Buffer.from("otra-clave-ficticia-24b!").toString("base64");
    const r = redsys.validateRedsysNotification(notification(paid, { key: other }));
    expect(r.isValid).toBe(false);
  });

  it("un pedido distinto del firmado invalida la firma (la clave se deriva del pedido)", () => {
    const r = redsys.validateRedsysNotification(notification(paid, { signOrder: "0000AAAA00" }));
    expect(r.isValid).toBe(false);
  });

  it("una respuesta denegada nunca queda como autorizada, aunque la firma sea válida", () => {
    for (const code of ["0101", "0180", "9915", "0190"]) {
      const r = redsys.validateRedsysNotification(notification({ ...paid, Ds_Response: code }));
      expect(r.isValid, code).toBe(true);
      expect(r.isAuthorized, code).toBe(false);
    }
  });

  it("respuestas 0000–0099 autorizan solo con firma válida", () => {
    for (const code of ["0000", "0001", "0099"]) {
      expect(redsys.validateRedsysNotification(notification({ ...paid, Ds_Response: code })).isAuthorized).toBe(true);
    }
    const forged = { ...notification(paid), Ds_Signature: "AAAA" };
    expect(redsys.validateRedsysNotification(forged).isAuthorized).toBe(false);
  });

  it("acepta la firma en base64url (con - y _), como la envía Redsys a veces", () => {
    const n = notification(paid);
    n.Ds_Signature = n.Ds_Signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(redsys.validateRedsysNotification(n).isValid).toBe(true);
  });

  it("entradas malformadas se rechazan sin lanzar", () => {
    const inputs: any[] = [
      { Ds_SignatureVersion: "x", Ds_MerchantParameters: "%%%no-es-base64%%%", Ds_Signature: "x" },
      { Ds_SignatureVersion: "x", Ds_MerchantParameters: Buffer.from("no json").toString("base64"), Ds_Signature: "x" },
      { Ds_SignatureVersion: "x", Ds_MerchantParameters: notification(paid).Ds_MerchantParameters, Ds_Signature: "" },
      { Ds_SignatureVersion: "x", Ds_MerchantParameters: notification(paid).Ds_MerchantParameters, Ds_Signature: undefined },
    ];
    for (const i of inputs) {
      let r: any;
      expect(() => (r = redsys.validateRedsysNotification(i))).not.toThrow();
      expect(r.isValid).toBe(false);
      expect(r.isAuthorized).toBe(false);
    }
  });

  it("sin clave configurada NO se acepta una firma falsificada con clave vacía", () => {
    delete process.env.REDSYS_MERCHANT_KEY;
    // Un atacante que supiera que no hay clave firmaría con la clave derivada de ceros.
    const params = Buffer.from(JSON.stringify(paid)).toString("base64");
    const forged = {
      Ds_SignatureVersion: "HMAC_SHA256_V1",
      Ds_MerchantParameters: params,
      Ds_Signature: referenceSignature(params, paid.Ds_Order, Buffer.alloc(24, 0).toString("base64")),
    };
    const r = redsys.validateRedsysNotification(forged);
    expect(r.isValid).toBe(false);
    expect(r.isAuthorized).toBe(false);
  });

  it("una clave demasiado corta tampoco valida (relleno de emergencia no es una clave)", () => {
    process.env.REDSYS_MERCHANT_KEY = Buffer.from("abc").toString("base64");
    const params = Buffer.from(JSON.stringify(paid)).toString("base64");
    // Relleno de emergencia del código: [K1|K2|K1] con K = clave + ceros hasta 16 bytes
    const k16 = Buffer.alloc(16, 0);
    Buffer.from("abc").copy(k16);
    const padded = Buffer.concat([k16, k16.subarray(0, 8)]);
    const forged = {
      Ds_SignatureVersion: "HMAC_SHA256_V1",
      Ds_MerchantParameters: params,
      Ds_Signature: referenceSignature(params, paid.Ds_Order, padded.toString("base64")),
    };
    expect(redsys.validateRedsysNotification(forged).isValid).toBe(false);
  });

  it("sin clave configurada no se valida nada como correcto", () => {
    delete process.env.REDSYS_MERCHANT_KEY;
    const r = redsys.validateRedsysNotification(notification(paid));
    expect(r.isValid).toBe(false);
  });
});

describe("generateMerchantOrder", () => {
  it("cumple el formato de Redsys: 10 caracteres, los 4 primeros numéricos, solo alfanumérico", () => {
    for (let i = 0; i < 200; i++) {
      const o = redsys.generateMerchantOrder();
      expect(o).toHaveLength(10);
      expect(/^\d{4}/.test(o)).toBe(true);
      expect(/^[0-9A-F]+$/.test(o)).toBe(true);
    }
  });

  it("no repite pedidos en ráfagas", () => {
    const set = new Set(Array.from({ length: 2000 }, () => redsys.generateMerchantOrder()));
    expect(set.size).toBeGreaterThan(1900);
  });

  it("todo pedido generado pasa la validación de buildRedsysForm", () => {
    for (let i = 0; i < 50; i++) {
      expect(() =>
        redsys.buildRedsysForm({
          amount: 100,
          merchantOrder: redsys.generateMerchantOrder(),
          productDescription: "x",
          notifyUrl: "https://a.test/n",
          okUrl: "https://a.test/ok",
          koUrl: "https://a.test/ko",
        }),
      ).not.toThrow();
    }
  });
});
