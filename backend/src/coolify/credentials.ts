import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AppConfig } from "../config.js";

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class CredentialsKeyError extends Error {
  readonly code = "COOLIFY_CREDENTIALS_KEY_MISSING";

  constructor() { super("Managed Coolify credentials are unavailable because COOLIFY_CREDENTIALS_KEY is not configured."); }
}

export function encryptToken(token: string, config: AppConfig): EncryptedToken {
  const key = credentialsKey(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptToken(value: EncryptedToken, config: AppConfig) {
  const key = credentialsKey(config);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Managed Coolify credentials could not be decrypted.");
  }
}

function credentialsKey(config: AppConfig) {
  const raw = config.coolifyCredentialsKey?.trim();
  if (!raw) throw new CredentialsKeyError();
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error("COOLIFY_CREDENTIALS_KEY must be a base64-encoded 32-byte key.");
  return decoded;
}
