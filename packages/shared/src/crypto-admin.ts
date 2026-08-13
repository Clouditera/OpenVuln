/**
 * Crypto admin channel primitives — shared by service (encrypt/verify only)
 * and admin-cli (full keygen/decrypt/sign).
 *
 * Service must NEVER import or call decrypt/privateDecrypt paths.
 */
import {
  constants,
  type KeyObject,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  sign,
  verify,
} from "node:crypto";

const ENVELOPE_VERSION = "OVENC1";
const DISCLOSE_PREFIX = "OV-DISCLOSE-v1\n";

export type EncryptedPayload = {
  title: string;
  primary_file: string | null;
  detail: unknown;
  /** Raw VH report.yaml text when available (byte-faithful). */
  report_yaml?: string | null;
};

/** Operator-supplied file body for public disclose fidelity (signed). */
export type DiscloseFile = {
  kind: "poc" | "exp" | "report" | "other";
  rel_path: string;
  file_name: string;
  content: string;
};

export type DiscloseItem = {
  finding_id: string;
  title: string;
  cwe?: string | null;
  summary?: string | null;
  /** Original report.yaml — public after disclose. */
  report_yaml?: string | null;
  /** poc/exp (and optional extra) file bodies — public after disclose. */
  files?: DiscloseFile[];
};

export type DiscloseBody = {
  action: "disclose";
  project_id: string;
  items: DiscloseItem[];
  timestamp: number;
  nonce: string;
};

// ─── helpers ───────────────────────────────────────────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

export function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function publicKeyId(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/** Recursive key-sorted JSON, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortKeys(obj[k]);
    }
    return out;
  }
  return value;
}

// ─── keygen ────────────────────────────────────────────────────────────────

export function generateAdminKeyPair(passphrase?: string): {
  publicKeyPem: string;
  privateKeyPem: string;
  kid: string;
  publicKeyEnv: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: passphrase
      ? {
          type: "pkcs8",
          format: "pem",
          cipher: "aes-256-cbc",
          passphrase,
        }
      : { type: "pkcs8", format: "pem" },
  });
  const publicKeyPem = publicKey as string;
  const privateKeyPem = privateKey as string;
  return {
    publicKeyPem,
    privateKeyPem,
    kid: publicKeyId(publicKeyPem),
    publicKeyEnv: Buffer.from(publicKeyPem, "utf8").toString("base64"),
  };
}

export function decodePublicKeyEnv(b64OrPem: string): string {
  const trimmed = b64OrPem.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) return trimmed;
  return Buffer.from(trimmed, "base64").toString("utf8");
}

// ─── envelope encrypt (service + seed) ─────────────────────────────────────

export function encryptForAdmin(
  publicKeyPem: string,
  findingId: string,
  payload: EncryptedPayload,
): string {
  const kid = publicKeyId(publicKeyPem);
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  cipher.setAAD(Buffer.from(findingId, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const wrapped = publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    dek,
  );

  return [ENVELOPE_VERSION, kid, b64url(wrapped), b64url(iv), b64url(tag), b64url(ct)].join(".");
}

// ─── envelope decrypt (CLI ONLY) ───────────────────────────────────────────

export function decryptForAdmin(
  privateKeyPem: string,
  findingId: string,
  envelope: string,
  passphrase?: string,
): EncryptedPayload {
  const parts = envelope.split(".");
  if (parts.length !== 6 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported envelope format: ${parts[0] ?? "?"}`);
  }
  const [, , wrappedB64, ivB64, tagB64, ctB64] = parts;
  const keyOpts: { key: string; passphrase?: string; padding: number; oaepHash: string } = {
    key: privateKeyPem,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  };
  if (passphrase) keyOpts.passphrase = passphrase;

  const dek = privateDecrypt(keyOpts, b64urlDecode(wrappedB64));
  const decipher = createDecipheriv("aes-256-gcm", dek, b64urlDecode(ivB64));
  decipher.setAAD(Buffer.from(findingId, "utf8"));
  decipher.setAuthTag(b64urlDecode(tagB64));
  const pt = Buffer.concat([decipher.update(b64urlDecode(ctB64)), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as EncryptedPayload;
}

// ─── disclose signing ──────────────────────────────────────────────────────

export function disclosePayloadHash(body: DiscloseBody): string {
  return sha256hex(canonicalJson(body));
}

export function signDiscloseBody(
  privateKeyPem: string,
  body: DiscloseBody,
  passphrase?: string,
): string {
  const payload = DISCLOSE_PREFIX + disclosePayloadHash(body);
  const key: KeyObject = createPrivateKey(
    passphrase ? { key: privateKeyPem, passphrase } : privateKeyPem,
  );
  const sig = sign("sha256", Buffer.from(payload, "utf8"), {
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return b64url(sig);
}

export function verifyDiscloseBody(
  publicKeyPem: string,
  body: DiscloseBody,
  signatureB64url: string,
): boolean {
  const payload = DISCLOSE_PREFIX + disclosePayloadHash(body);
  const key = createPublicKey(publicKeyPem);
  try {
    return verify(
      "sha256",
      Buffer.from(payload, "utf8"),
      {
        key,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      },
      b64urlDecode(signatureB64url),
    );
  } catch {
    return false;
  }
}

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export function isTimestampFresh(ts: number, windowSec = 300, now = Date.now()): boolean {
  const nowSec = Math.floor(now / 1000);
  return Math.abs(nowSec - ts) <= windowSec;
}
