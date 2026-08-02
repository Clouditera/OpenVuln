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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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
    request<ProjectPublicView>(`/api/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
  submitProject: (body: SubmitProjectRequest) =>
    request<SubmitProjectResponse>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
