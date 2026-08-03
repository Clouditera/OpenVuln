/** Service configuration loaded from environment variables */
import { decodePublicKeyEnv } from "@openvuln/shared/crypto";

export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export type VulnHunterAuthMode = "cookie" | "token";

export interface ServiceConfig {
  port: number;
  publicBaseUrl: string;
  corsAllowedOrigins: string[];
  db: { url: string };
  vulnhunter: {
    baseUrl: string;
    authMode: VulnHunterAuthMode;
    username: string;
    password: string;
    apiToken: string;
    credentialId: string;

    create: {
      scanTimeoutHours: number;
      maxItemsPerRecon: number;
      agentMaxParallel: number;
      auditFocus: string;
      enableDynamicVerify: boolean;
      enableDynamicExploit: boolean;
    };
    sourceMode: "archive" | "git";
    zipMaxMb: number;
    zipDownloadTimeoutMs: number;
  };
  github: { serverToken: string };
  githubOAuth: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    /** HMAC secret for OAuth state (defaults to client secret). */
    stateSecret: string;
  };
  submitDailyLimit: number;
  scan: {
    concurrency: number;
    cooldownDays: number;
    dispatcherIntervalMs: number;
    pollerIntervalMs: number;
    vhFailGracePolls: number;
    /** dispatching older than this is requeued/failed. */
    dispatchStaleMinutes: number;
  };
  adminToken: string;
  adminPublicKeyPem: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
  };
  notify: { emailEnabled: boolean };
  log: { level: string };
}

export function loadConfig(): ServiceConfig {
  const authModeRaw = optionalEnv("VULNHUNTER_AUTH_MODE", "cookie");
  if (authModeRaw !== "cookie" && authModeRaw !== "token") {
    throw new Error(`Invalid VULNHUNTER_AUTH_MODE: ${authModeRaw}`);
  }
  const authMode = authModeRaw as VulnHunterAuthMode;
  const adminToken = optionalEnv("ADMIN_TOKEN", "");
  const adminKeyRaw = optionalEnv("ADMIN_PUBLIC_KEY", "");
  let adminPublicKeyPem = "";
  if (adminKeyRaw) {
    adminPublicKeyPem = decodePublicKeyEnv(adminKeyRaw);
  }
  // ADMIN_PUBLIC_KEY optional after plaintext migration (legacy decrypt only)
  const oauthClientId = optionalEnv("GITHUB_CLIENT_ID", "");
  const oauthClientSecret = optionalEnv("GITHUB_CLIENT_SECRET", "");
  const publicBaseUrl = optionalEnv("PUBLIC_BASE_URL", "http://localhost:7860");
  const oauthCallback =
    optionalEnv("GITHUB_OAUTH_CALLBACK_URL", "") ||
    `${publicBaseUrl.replace(/\/$/, "")}/api/auth/github/callback`;
  const corsRaw = optionalEnv("CORS_ALLOWED_ORIGINS", "");
  const corsAllowedOrigins = corsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sourceModeRaw = optionalEnv("VH_SOURCE_MODE", "archive").toLowerCase();
  const sourceMode = sourceModeRaw === "git" ? "git" : "archive";

  return {
    port: Number(optionalEnv("PORT", "7860")),
    publicBaseUrl,
    corsAllowedOrigins,
    db: {
      url: optionalEnv("DATABASE_URL", "postgresql://openvuln:openvuln@localhost:5432/openvuln"),
    },
    vulnhunter: {
      baseUrl: optionalEnv("VULNHUNTER_BASE_URL", "http://localhost:28080"),
      authMode,
      username: optionalEnv("VULNHUNTER_USERNAME", ""),
      password: optionalEnv("VULNHUNTER_PASSWORD", ""),
      apiToken: optionalEnv("VULNHUNTER_API_TOKEN", ""),
      credentialId: optionalEnv("VULNHUNTER_CREDENTIAL_ID", ""),
      create: {
        scanTimeoutHours: Number(optionalEnv("VH_SCAN_TIMEOUT_HOURS", "24")),
        maxItemsPerRecon: Number(optionalEnv("VH_MAX_ITEMS_PER_RECON", "10")),
        agentMaxParallel: Number(optionalEnv("VH_AGENT_MAX_PARALLEL", "5")),
        auditFocus: optionalEnv("VH_AUDIT_FOCUS", "全面扫描，确保高覆盖率和高 poc/exp 执行率"),
        enableDynamicVerify: optionalEnv("VH_ENABLE_DYNAMIC_VERIFY", "true") === "true",
        enableDynamicExploit: optionalEnv("VH_ENABLE_DYNAMIC_EXPLOIT", "true") === "true",
      },
      sourceMode,
      zipMaxMb: Number(optionalEnv("VH_ZIP_MAX_MB", "500")),
      zipDownloadTimeoutMs: Number(optionalEnv("VH_ZIP_DOWNLOAD_TIMEOUT_MS", "120000")),
    },
    github: {
      serverToken: optionalEnv("GITHUB_SERVER_TOKEN", ""),
    },
    githubOAuth: {
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      callbackUrl: oauthCallback,
      stateSecret: optionalEnv("GITHUB_OAUTH_STATE_SECRET", "") || oauthClientSecret || "dev-oauth-state",
    },
    submitDailyLimit: Number(optionalEnv("SUBMIT_DAILY_LIMIT", "10")),
    scan: {
      concurrency: Number(optionalEnv("SCAN_CONCURRENCY", "4")),
      cooldownDays: Number(optionalEnv("SCAN_COOLDOWN_DAYS", "7")),
      dispatcherIntervalMs: Number(optionalEnv("SCAN_DISPATCHER_INTERVAL_MS", "10000")),
      pollerIntervalMs: Number(optionalEnv("SCAN_POLLER_INTERVAL_MS", "30000")),
      vhFailGracePolls: Number(optionalEnv("SCAN_VH_FAIL_GRACE_POLLS", "3")),
      /** dispatching stuck longer than this → requeue or fail. */
      dispatchStaleMinutes: Number(optionalEnv("SCAN_DISPATCH_STALE_MINUTES", "30")),
    },
    adminToken,
    adminPublicKeyPem,
    smtp: {
      host: optionalEnv("SMTP_HOST", ""),
      port: Number(optionalEnv("SMTP_PORT", "465")),
      secure: optionalEnv("SMTP_SECURE", "true") === "true",
      user: optionalEnv("SMTP_USER", ""),
      password: optionalEnv("SMTP_PASSWORD", "") || optionalEnv("SMTP_PASS", ""),
      from: optionalEnv("SMTP_FROM", ""),
    },
    notify: {
      emailEnabled: optionalEnv("NOTIFY_EMAIL_ENABLED", "true") === "true",
    },
    log: {
      level: optionalEnv("LOG_LEVEL", "info"),
    },
  };
}
