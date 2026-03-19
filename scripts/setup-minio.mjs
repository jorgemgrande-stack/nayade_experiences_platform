#!/usr/bin/env node
/**
 * scripts/setup-minio.mjs
 *
 * Inicializa MinIO para el proyecto Nayade Experiences:
 *  1. Crea el bucket (si no existe)
 *  2. Configura la política de acceso público (lectura sin autenticación)
 *  3. Crea las carpetas base (uploads/, generated/, avatars/)
 *
 * Uso:
 *   node scripts/setup-minio.mjs
 *
 * Variables de entorno (lee del .env automáticamente):
 *   S3_ENDPOINT   → URL de MinIO (default: http://localhost:9000)
 *   S3_BUCKET     → Nombre del bucket (default: nayade-media)
 *   S3_ACCESS_KEY → Access Key (default: minioadmin)
 *   S3_SECRET_KEY → Secret Key (default: minioadmin)
 *   S3_REGION     → Región (default: us-east-1)
 */

import "dotenv/config";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const ENDPOINT   = process.env.S3_ENDPOINT   ?? "http://localhost:9000";
const BUCKET     = process.env.S3_BUCKET     ?? "nayade-media";
const ACCESS_KEY = process.env.S3_ACCESS_KEY ?? "minioadmin";
const SECRET_KEY = process.env.S3_SECRET_KEY ?? "minioadmin";
const REGION     = process.env.S3_REGION     ?? "us-east-1";

const client = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

// Política de lectura pública para todo el bucket
const publicReadPolicy = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PublicReadGetObject",
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${BUCKET}/*`],
    },
  ],
});

async function bucketExists() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch {
    return false;
  }
}

async function createPlaceholder(key) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: "",
    ContentType: "application/x-directory",
  }));
}

async function main() {
  console.log(`\n🪣  Configurando MinIO en ${ENDPOINT}...`);
  console.log(`   Bucket: ${BUCKET}`);

  // 1. Crear bucket si no existe
  if (await bucketExists()) {
    console.log(`✅ El bucket "${BUCKET}" ya existe.`);
  } else {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`✅ Bucket "${BUCKET}" creado.`);
  }

  // 2. Aplicar política pública
  await client.send(new PutBucketPolicyCommand({
    Bucket: BUCKET,
    Policy: publicReadPolicy,
  }));
  console.log(`✅ Política de lectura pública aplicada.`);

  // 3. Crear carpetas base (objetos vacíos que actúan como prefijos)
  const folders = ["uploads/", "generated/", "avatars/", "hotel/", "spa/", "experiences/"];
  for (const folder of folders) {
    await createPlaceholder(folder);
  }
  console.log(`✅ Carpetas base creadas: ${folders.join(", ")}`);

  console.log(`\n🎉 MinIO listo. URL pública: ${ENDPOINT}/${BUCKET}/`);
  console.log(`   Consola web: ${ENDPOINT.replace(":9000", ":9001")} (minioadmin / minioadmin)\n`);
}

main().catch(err => {
  console.error("\n❌ Error configurando MinIO:", err.message);
  console.error("   Asegúrate de que MinIO está corriendo: docker compose up -d minio");
  process.exit(1);
});
