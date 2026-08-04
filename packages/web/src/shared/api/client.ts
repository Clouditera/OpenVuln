import type {
  DisclosureState,
  ProjectCard,
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

/** GitHub OAuth login URL (full-page redirect). */
export function loginUrl(returnTo: string): string {
  // 站内相对路径与白名单绝对地址（HF 部署回跳）都放行 —— 白名单校验在后端；
  // 仅协议相对 "//…" 一律拒绝（开放重定向的唯一真风险）。
  const safe = returnTo.startsWith("//") ? "/" : returnTo;
  return apiUrl(`/api/auth/github/login?return_to=${encodeURIComponent(safe)}`);
}

/** 是否在 iframe 嵌套环境（HF Space 嵌入页；GitHub x-frame-options:deny，iframe 内跳 OAuth 必死）。 */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * 当前页作为 OAuth return_to：跨域部署（HF 静态站，API_BASE 与页面不同源）必须给
 * 本站绝对地址（后端白名单已放行），授权完才回得来；同源部署（clouditera）用相对路径。
 */
export function currentReturnTo(): string {
  const rel = window.location.pathname + window.location.search;
  if (API_BASE && new URL(API_BASE).origin !== window.location.origin) {
    return window.location.origin + rel;
  }
  return rel;
}

/**
 * Navigate to OAuth login.
 * - iframe (HF Space hub): open popup window (sandbox blocks top navigation)
 * - direct access (clouditera / HF subdomain): redirect current page
 */
export function navigateToLogin(returnTo: string = currentReturnTo()): void {
  const url = loginUrl(returnTo);
  if (isEmbedded()) {
    // Must call window.open synchronously in click handler to avoid popup blocker
    const popup = window.open(url, "ov-oauth", "width=600,height=700");
    if (!popup) {
      // Popup blocked — fall back to top navigation (may work on some platforms)
      if (window.top) window.top.location.href = url;
    }
  } else {
    window.location.href = url;
  }
}

/** Popup OAuth callback return_to path. */
export const POPUP_CALLBACK_PATH = "/auth/popup-callback";

/** return_to for popup flow: always the API origin + callback path.
 *  The callback page MUST run on the API domain (clouditera), not the HF Space domain,
 *  so that /api/me fetch is first-party (cookie works) rather than third-party (blocked).
 */
export function popupReturnTo(): string {
  return `${API_BASE}${POPUP_CALLBACK_PATH}`;
}

/** Navigate to OAuth login in popup (for embedded/iframe context). */
export function navigateToLoginPopup(): void {
  const url = loginUrl(popupReturnTo());
  window.open(url, "ov-oauth", "width=600,height=700");
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


/* ── 站内通知（task-78c9fb3a，契约以 architect 简案为准） ── */

export interface NotificationItem {
  id: string;
  type: string; // v1: "scan_completed"
  payload: {
    project_id: string;
    full_name: string;
    scan_job_id: string;
    counts: { critical: number; high: number; medium: number; low: number };
    no_value: boolean;
  };
  read_at: string | null;
  created_at: string;
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
  notifications: (limit = 20) =>
    request<{ notifications: NotificationItem[]; unread_count: number }>(
      `/api/notifications?limit=${limit}`,
    ),
  markNotificationsRead: (ids: string[]) =>
    request<void>("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids }) }),
  markAllNotificationsRead: () =>
    request<void>("/api/notifications/read-all", { method: "POST" }),
  myProjects: () => request<{ projects: ProjectCard[] }>("/api/my/projects"),
};
