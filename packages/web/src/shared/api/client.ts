import type {
  DisclosureState,
  OverviewStats,
  ProjectListResponse,
  ProjectPublicView,
  Severity,
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

/**
 * Build-time API origin via `VITE_API_BASE_URL` (no trailing slash).
 * Default empty → same-origin relative `/api/...`.
 * Cross-origin deploy example:
 *   VITE_API_BASE_URL=https://openvuln.clouditera.com pnpm --filter @openvuln/web build
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

/** Absolute or root-relative URL for API paths and download links. */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
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


/* ── Auth + owner self-service (design: docs/auth-owner-selfservice-design.md) ── */

export interface MeResponse {
  authenticated: boolean;
  user: { id: number; login: string; avatar_url: string | null } | null;
}

/** GitHub OAuth 登录跳转（full-page redirect）。returnTo 必须站内路径。 */
export function loginUrl(returnTo: string): string {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return apiUrl(`/api/auth/github/login?return_to=${encodeURIComponent(safe)}`);
}

export interface OwnerFindingSummary {
  id: string;
  finding_key: string;
  severity: Severity;
  title: string;
  cwe: string | null;
  primary_file: string | null;
  disclosure_state: DisclosureState;
  detail_json: unknown;
  report_yaml: string | null;
  cvss_score: number | null;
  poc_status: string | null;
}

export interface OwnerArtifact {
  kind: string;
  rel_path: string;
  file_name: string;
  mime: string | null;
  size_bytes: number;
  truncated: boolean;
  is_binary: boolean;
  has_content: boolean;
}

export interface OwnerFindingDetail extends OwnerFindingSummary {
  report: {
    metadata?: Record<string, unknown>;
    description?: Record<string, unknown>;
    code?: Record<string, unknown>;
    references?: unknown;
  } | null;
  artifacts: OwnerArtifact[];
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
  me: () => request<MeResponse>("/api/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  ownerFindings: (projectId: string) =>
    request<{ project_id: string; findings: OwnerFindingSummary[] }>(
      `/api/projects/${projectId}/findings`,
    ),
  ownerFinding: (projectId: string, key: string) =>
    request<{ finding: OwnerFindingDetail }>(
      `/api/projects/${projectId}/findings/${encodeURIComponent(key)}`,
    ),
  ownerDisclose: (projectId: string, findingIds: string[]) =>
    request<{ disclosed_count: number }>(`/api/projects/${projectId}/disclose`, {
      method: "POST",
      body: JSON.stringify({ finding_ids: findingIds }),
    }),
};
