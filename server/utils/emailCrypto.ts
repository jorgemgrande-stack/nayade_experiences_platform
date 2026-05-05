/**
 * emailCrypto.ts — AES-256-GCM encryption for email account credentials.
 * Key derived from EMAIL_ENCRYPTION_KEY env var (or DATABASE_URL as fallback).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12; // 96-bit IV recommended for GCM
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw =
    process.env.EMAIL_ENCRYPTION_KEY ||
    process.env.DATABASE_URL ||
    "nayade-email-key-please-set-env";
  return scryptSync(raw, "nayade-email-salt-v1", KEY_LEN) as Buffer;
}

export function encryptPassword(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + encrypted)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptPassword(encoded: string): string {
  if (!encoded) return "";
  try {
    const key = getKey();
    const buf = Buffer.from(encoded, "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const encrypted = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
