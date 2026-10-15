/**
 * Herramienta administrativa de operadores del plano de control. Se ejecuta EN EL SERVIDOR con
 * las credenciales de escritura del registro (quien puede ejecutarla ya administra la BD).
 *
 *   REGISTRY_ADMIN_DATABASE_URL=mysql://… tsx scripts/cp-operators.ts list
 *   … bootstrap      --username administrador --name "Administrador" [--email a@b.c] --password-file <ruta>
 *   … reset-password --username administrador --password-file <ruta>
 *
 * Las contraseñas se GENERAN (aleatorias, ~128 bits) y se escriben solo en el archivo indicado,
 * que debe estar fuera del repositorio y no existir ya. Nunca se imprimen en pantalla ni en logs.
 * bootstrap solo funciona si aún no hay operadores; reset-password cierra todas las sesiones.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { OperatorAuthError, OperatorAuthService, generatePassword } from "../server/controlPlane/operatorAuth";
import { MysqlOperatorStore } from "../server/controlPlane/operatorStore";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function passwordFile(): string {
  const p = arg("password-file");
  if (!p) throw new Error("Falta --password-file <ruta> (archivo donde guardar la contraseña generada)");
  const abs = path.resolve(p);
  if (abs === REPO || abs.startsWith(REPO + path.sep)) throw new Error("El archivo de contraseña no puede estar dentro del repositorio");
  if (fs.existsSync(abs)) throw new Error(`Ya existe ${abs}: bórralo o indica otro archivo (no se sobrescriben contraseñas)`);
  return abs;
}

function writeSecret(file: string, password: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // wx: falla si apareció entretanto; 0600 donde el sistema lo admite
  fs.writeFileSync(file, password, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function main() {
  const url = process.env.REGISTRY_ADMIN_DATABASE_URL;
  if (!url) throw new Error("Falta REGISTRY_ADMIN_DATABASE_URL");
  const cmd = process.argv[2];
  const pool = mysql.createPool({ uri: url, connectionLimit: 2 });
  const svc = new OperatorAuthService(new MysqlOperatorStore(pool));
  try {
    if (cmd === "list") {
      for (const o of await svc.list()) console.log(`${o.username}\t${o.roleLabel}\t${o.status}${o.locked ? " (bloqueado)" : ""}\t${o.email ?? ""}`);
    } else if (cmd === "bootstrap") {
      const username = arg("username");
      const name = arg("name");
      if (!username || !name) throw new Error("Uso: bootstrap --username <usuario> --name <nombre> [--email <correo>] --password-file <ruta>");
      const file = passwordFile();
      const password = generatePassword();
      await svc.bootstrap({ username, displayName: name, email: arg("email") ?? null, password });
      writeSecret(file, password);
      console.log(`Superadministrador «${username}» creado. Contraseña inicial guardada en ${file} (no se muestra).`);
    } else if (cmd === "reset-password") {
      const username = arg("username");
      if (!username) throw new Error("Uso: reset-password --username <usuario> --password-file <ruta>");
      const file = passwordFile();
      const password = generatePassword();
      await svc.adminResetFromServer(username, password);
      writeSecret(file, password);
      console.log(`Contraseña de «${username}» restablecida y sesiones cerradas. Nueva contraseña en ${file} (no se muestra).`);
    } else {
      throw new Error("Comandos: list | bootstrap | reset-password");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof OperatorAuthError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : "error");
  process.exit(1);
});
