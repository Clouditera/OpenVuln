import type { ServiceConfig } from "../../infra/config.js";
import { logger } from "../../infra/logger.js";
import type { VulnHunterClient } from "./client.js";
import { CookieVulnHunterClient } from "./cookie-client.js";
import { TokenVulnHunterClient } from "./token-client.js";
import { MockVulnHunterClient } from "./mock-client.js";

export type { VulnHunterClient, VhFindingMeta, VhTaskState } from "./client.js";
export { MockVulnHunterClient } from "./mock-client.js";

let _client: VulnHunterClient | null = null;

export function initVulnHunterClient(config: ServiceConfig): VulnHunterClient {
  if (config.vulnhunter.mock) {
    logger.info("VulnHunter client: MOCK mode");
    _client = new MockVulnHunterClient();
  } else if (config.vulnhunter.authMode === "token") {
    if (!config.vulnhunter.apiToken) {
      throw new Error("VULNHUNTER_API_TOKEN required when AUTH_MODE=token");
    }
    logger.info({ baseUrl: config.vulnhunter.baseUrl }, "VulnHunter client: TOKEN mode");
    _client = new TokenVulnHunterClient({
      baseUrl: config.vulnhunter.baseUrl,
      apiToken: config.vulnhunter.apiToken,
      defaultCredentialId: config.vulnhunter.credentialId || undefined,
    });
  } else {
    if (!config.vulnhunter.username || !config.vulnhunter.password) {
      throw new Error("VULNHUNTER_USERNAME/PASSWORD required when AUTH_MODE=cookie");
    }
    logger.info("VulnHunter client: COOKIE mode");
    _client = new CookieVulnHunterClient({
      baseUrl: config.vulnhunter.baseUrl,
      username: config.vulnhunter.username,
      password: config.vulnhunter.password,
    });
  }
  return _client;
}

export function getVulnHunterClient(): VulnHunterClient {
  if (!_client) throw new Error("VulnHunter client not initialized");
  return _client;
}

/** Test-only override. */
export function setVulnHunterClient(client: VulnHunterClient): void {
  _client = client;
}
