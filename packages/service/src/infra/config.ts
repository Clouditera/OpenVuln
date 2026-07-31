/** Service configuration loaded from environment variables */

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
  db: { url: string };
  sessionSecret: string;
  vulnhunter: {
    baseUrl: string;
    authMode: VulnHunterAuthMode;
    username: string;
    password: string;
    apiToken: string;
    mock: boolean;
  };
  github: {
    clientId: string;
    clientSecret: string;
    serverToken: string;
  };
  scan: {
    concurrency: number;
    cooldownDays: number;
    dispatcherIntervalMs: number;
    pollerIntervalMs: number;
  };
  adminGithubLogins: string[];
  log: { level: string };
}

export function loadConfig(): ServiceConfig {
  const authMode = optionalEnv("VULNHUNTER_AUTH_MODE", "cookie");
  if (authMode !== "cookie" && authMode !== "token") {
    throw new Error(`Invalid VULNHUNTER_AUTH_MODE: ${authMode}`);
  }

  const adminRaw = optionalEnv("ADMIN_GITHUB_LOGINS", "");
  const adminGithubLogins = adminRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    port: Number(optionalEnv("PORT", "7860")),
    publicBaseUrl: optionalEnv("PUBLIC_BASE_URL", "http://localhost:7860"),
    db: {
      url: optionalEnv(
        "DATABASE_URL",
        "postgresql://openvuln:openvuln@localhost:5432/openvuln",
      ),
    },
    sessionSecret: optionalEnv("SESSION_SECRET", "dev-session-secret-change-me"),
    vulnhunter: {
      baseUrl: optionalEnv("VULNHUNTER_BASE_URL", "http://localhost:28080"),
      authMode,
      username: optionalEnv("VULNHUNTER_USERNAME", ""),
      password: optionalEnv("VULNHUNTER_PASSWORD", ""),
      apiToken: optionalEnv("VULNHUNTER_API_TOKEN", ""),
      mock: optionalEnv("VULNHUNTER_MOCK", "false") === "true",
    },
    github: {
      clientId: optionalEnv("GITHUB_CLIENT_ID", ""),
      clientSecret: optionalEnv("GITHUB_CLIENT_SECRET", ""),
      serverToken: optionalEnv("GITHUB_SERVER_TOKEN", ""),
    },
    scan: {
      concurrency: Number(optionalEnv("SCAN_CONCURRENCY", "1")),
      // Stage default in .env is 36500 (one scan / project). Code fallback 7 for local experiments.
      cooldownDays: Number(optionalEnv("SCAN_COOLDOWN_DAYS", "7")),
      dispatcherIntervalMs: Number(optionalEnv("SCAN_DISPATCHER_INTERVAL_MS", "10000")),
      pollerIntervalMs: Number(optionalEnv("SCAN_POLLER_INTERVAL_MS", "30000")),
    },
    adminGithubLogins,
    log: {
      level: optionalEnv("LOG_LEVEL", "info"),
    },
  };
}
