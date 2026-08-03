import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "*.api_key",
    "*.password",
    "*.session_token",
    "*.access_token",
    "*.token",
    "*.github_token",
    "github_token",
    "githubToken",
  ],
});
