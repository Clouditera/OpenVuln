import { describe, expect, it } from "vitest";
import {
  type DiscloseBody,
  canonicalJson,
  decodePublicKeyEnv,
  decryptForAdmin,
  disclosePayloadHash,
  encryptForAdmin,
  generateAdminKeyPair,
  isTimestampFresh,
  newNonce,
  publicKeyId,
  sha256hex,
  signDiscloseBody,
  verifyDiscloseBody,
} from "./crypto-admin.js";

describe("crypto-admin", () => {
  const { publicKeyPem, privateKeyPem, kid, publicKeyEnv } = generateAdminKeyPair();

  it("keygen: kid matches public key, env base64 round-trips", () => {
    expect(kid).toBe(publicKeyId(publicKeyPem));
    expect(decodePublicKeyEnv(publicKeyEnv)).toBe(publicKeyPem);
    // PEM passthrough also accepted (whitespace-normalized)
    expect(decodePublicKeyEnv(publicKeyPem)).toBe(publicKeyPem.trim());
  });

  it("envelope encrypt → decrypt round-trip", () => {
    const findingId = crypto.randomUUID();
    const payload = {
      title: "SQLi in login",
      primary_file: "src/auth/login.ts",
      detail: { severity: "high", cvss_score: 8.1 },
    };
    const env = encryptForAdmin(publicKeyPem, findingId, payload);
    const parts = env.split(".");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("OVENC1");
    expect(parts[1]).toBe(kid);

    const out = decryptForAdmin(privateKeyPem, findingId, env);
    expect(out).toEqual(payload);
  });

  it("decrypt fails with wrong AAD (finding id binding)", () => {
    const findingId = crypto.randomUUID();
    const env = encryptForAdmin(publicKeyPem, findingId, {
      title: "t",
      primary_file: null,
      detail: {},
    });
    expect(() => decryptForAdmin(privateKeyPem, crypto.randomUUID(), env)).toThrow();
  });

  it("decrypt fails with wrong private key", () => {
    const other = generateAdminKeyPair();
    const findingId = crypto.randomUUID();
    const env = encryptForAdmin(publicKeyPem, findingId, {
      title: "t",
      primary_file: null,
      detail: {},
    });
    expect(() => decryptForAdmin(other.privateKeyPem, findingId, env)).toThrow();
  });

  it("rejects unsupported envelope version", () => {
    expect(() => decryptForAdmin(privateKeyPem, "id", "OVENC9.x.y.z.w")).toThrow(
      /Unsupported envelope/,
    );
  });

  it("disclose sign → verify round-trip; tamper detection", () => {
    const body: DiscloseBody = {
      action: "disclose",
      project_id: crypto.randomUUID(),
      items: [{ finding_id: crypto.randomUUID(), title: "XSS", cwe: "CWE-79" }],
      timestamp: Math.floor(Date.now() / 1000),
      nonce: newNonce(),
    };
    const sig = signDiscloseBody(privateKeyPem, body);
    expect(verifyDiscloseBody(publicKeyPem, body, sig)).toBe(true);

    // tampered body must not verify
    const first = body.items[0];
    if (!first) throw new Error("test body requires one item");
    const tampered: DiscloseBody = {
      ...body,
      items: [{ ...first, title: "RCE" }],
    };
    expect(verifyDiscloseBody(publicKeyPem, tampered, sig)).toBe(false);
    // wrong key must not verify
    const other = generateAdminKeyPair();
    expect(verifyDiscloseBody(other.publicKeyPem, body, sig)).toBe(false);
  });

  it("canonicalJson is key-order independent", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(disclosePayloadHash).toBeTypeOf("function");
    expect(sha256hex("x")).toHaveLength(64);
  });

  it("isTimestampFresh window", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(isTimestampFresh(nowSec)).toBe(true);
    expect(isTimestampFresh(nowSec - 299)).toBe(true);
    expect(isTimestampFresh(nowSec - 301)).toBe(false);
    expect(isTimestampFresh(nowSec + 301)).toBe(false);
  });
});
