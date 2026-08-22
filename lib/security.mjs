import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function encryptionKey() {
  const encoded = process.env.CONSULTATION_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) {
    throw new Error("consultation_encryption_not_configured");
  }
  return key;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function consultationHash(value) {
  return createHmac("sha256", encryptionKey()).update(value).digest("hex");
}

export function encryptMessage(consultationId, author, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${consultationId}:${author}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext,
    iv,
    authenticationTag: cipher.getAuthTag(),
  };
}

export function decryptMessage(consultationId, author, encrypted) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    encrypted.encryption_iv,
  );
  decipher.setAAD(Buffer.from(`${consultationId}:${author}`, "utf8"));
  decipher.setAuthTag(encrypted.authentication_tag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function consultantKeyMatches(candidate) {
  const configured = process.env.CONSULTANT_ACCESS_KEY ?? "";
  if (!configured || !candidate) return false;
  const expected = createHash("sha256").update(configured).digest();
  const actual = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expected, actual);
}
