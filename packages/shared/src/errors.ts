export type ErrorCode =
  | "ERR_VALIDATION"
  | "ERR_NOT_FOUND"
  | "ERR_CONFLICT"
  | "ERR_FORBIDDEN"
  | "ERR_UNAUTHORIZED"
  | "ERR_RATE_LIMIT"
  | "ERR_UPSTREAM"
  | "ERR_INTERNAL";

export interface ErrorCatalogEntry {
  httpStatus: number;
  summary: { en: string; zh: string };
}

export const ERROR_CATALOG: Record<ErrorCode, ErrorCatalogEntry> = {
  ERR_VALIDATION: {
    httpStatus: 422,
    summary: { en: "Invalid request", zh: "请求参数无效" },
  },
  ERR_NOT_FOUND: {
    httpStatus: 404,
    summary: { en: "Resource not found", zh: "资源不存在" },
  },
  ERR_CONFLICT: {
    httpStatus: 409,
    summary: { en: "Conflict", zh: "资源冲突" },
  },
  ERR_FORBIDDEN: {
    httpStatus: 403,
    summary: { en: "Forbidden", zh: "无权限" },
  },
  ERR_UNAUTHORIZED: {
    httpStatus: 401,
    summary: { en: "Unauthorized", zh: "未登录" },
  },
  ERR_RATE_LIMIT: {
    httpStatus: 429,
    summary: { en: "Rate limited", zh: "请求过于频繁" },
  },
  ERR_UPSTREAM: {
    httpStatus: 502,
    summary: { en: "Upstream error", zh: "上游服务异常" },
  },
  ERR_INTERNAL: {
    httpStatus: 500,
    summary: { en: "Internal server error", zh: "内部错误" },
  },
};
