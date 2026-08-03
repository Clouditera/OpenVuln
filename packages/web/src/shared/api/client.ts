import type {
  OverviewStats,
  ProjectListResponse,
  ProjectPublicView,
  SubmitProjectRequest,
  SubmitProjectResponse,
} from "@openvuln/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type OpenVulnRuntimeConfig = {
  /** API origin with no trailing slash. Empty = same-origin relative /api. */
  apiBase?: string;
  /** Which home page to show. */
  landing?: "zai" | "product";
};

declare global {
  interface Window {
    __OPENVULN__?: OpenVulnRuntimeConfig;
  }
}

/**
 * Resolve API base at runtime (deploy-time config.js), then optional Vite dev env.
 * Default: "" → same-origin `/api/...` (no hardcoded production URL in the bundle).
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const runtime = window.__OPENVULN__?.apiBase;
    if (runtime !== undefined && runtime !== null) {
      return String(runtime).replace(/\/$/, "");
    }
  }
  const vite = import.meta.env.VITE_API_BASE_URL;
  if (typeof vite === "string" && vite.length > 0) {
    return vite.replace(/\/$/, "");
  }
  return "";
}

export function getLandingMode(): "zai" | "product" {
  if (typeof window !== "undefined") {
    const l = window.__OPENVULN__?.landing;
    if (l === "product" || l === "zai") return l;
  }
  const vite = import.meta.env.VITE_LANDING;
  if (vite === "product" || vite === "zai") return vite;
  return "zai";
}

/** Absolute or root-relative URL for API paths and download links. */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBase()}${p}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let code = "ERR_UNKNOWN";
    let summary = res.statusText;
    let context: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; summary?: string; context?: Record<string, unknown> };
      };
      code = body.error?.code ?? code;
      summary = body.error?.summary ?? summary;
      context = body.error?.context;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code, summary, context);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  overview: () => request<OverviewStats>("/api/stats/overview"),
  listProjects: (params?: { sort?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams();
    if (params?.sort) q.set("sort", params.sort);
    if (params?.page) q.set("page", String(params.page));
    if (params?.page_size) q.set("page_size", String(params.page_size));
    const qs = q.toString();
    return request<ProjectListResponse>(`/api/projects${qs ? `?${qs}` : ""}`);
  },
  getProject: (owner: string, repo: string) =>
    request<ProjectPublicView>(
      `/api/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    ),
  submitProject: (body: SubmitProjectRequest) =>
    request<SubmitProjectResponse>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
