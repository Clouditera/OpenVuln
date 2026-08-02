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
    mock: boolean;
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
  scan: {
    concurrency: number;
    cooldownDays: number;
    dispatcherIntervalMs: number;
    pollerIntervalMs: number;
    vhFailGracePolls: number;
  };
  adminToken: string;
  adminPublicKeyPem: string;
  log: { level: string };
}

export function loadConfig(): ServiceConfig {
  const authModeRaw = optionalEnv("VULNHUNTER_AUTH_MODE", "cookie");
  if (authModeRaw !== "cookie" && authModeRaw !== "token") {
    throw new Error(`Invalid VULNHUNTER_AUTH_MODE: ${authModeRaw}`);
  }
  const authMode = authModeRaw as VulnHunterAuthMode;
  const mock = optionalEnv("VULNHUNTER_MOCK", "false") === "true";
  const adminToken = optionalEnv("ADMIN_TOKEN", "");
  const adminKeyRaw = optionalEnv("ADMIN_PUBLIC_KEY", "");
  let adminPublicKeyPem = "";
  if (adminKeyRaw) {
    adminPublicKeyPem = decodePublicKeyEnv(adminKeyRaw);
  } else if (!mock && process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_PUBLIC_KEY is required in production");
  }
  const corsRaw = optionalEnv("CORS_ALLOWED_ORIGINS", "");
  const corsAllowedOrigins = corsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sourceModeRaw = optionalEnv("VH_SOURCE_MODE", "archive").toLowerCase();
  const sourceMode = sourceModeRaw === "git" ? "git" : "archive";

  return {
    port: Number(optionalEnv("PORT", "7860")),
    publicBaseUrl: optionalEnv("PUBLIC_BASE_URL", "http://localhost:7860"),
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
      mock,
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
    scan: {
      concurrency: Number(optionalEnv("SCAN_CONCURRENCY", "4")),
      cooldownDays: Number(optionalEnv("SCAN_COOLDOWN_DAYS", "7")),
      dispatcherIntervalMs: Number(optionalEnv("SCAN_DISPATCHER_INTERVAL_MS", "10000")),
      pollerIntervalMs: Number(optionalEnv("SCAN_POLLER_INTERVAL_MS", "30000")),
      vhFailGracePolls: Number(optionalEnv("SCAN_VH_FAIL_GRACE_POLLS", "3")),
    },
    adminToken,
    adminPublicKeyPem,
    log: {
      level: optionalEnv("LOG_LEVEL", "info"),
    },
  };
}
