import { getDb } from "../../infra/db/index.js";

export async function writeAudit(
  action: string,
  targetType: string,
  targetId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO admin_audit_log (action, target_type, target_id, detail)
    VALUES (${action}, ${targetType}, ${targetId}, ${JSON.stringify(detail)}::jsonb)
  `;
}

export async function listAudit(opts: {
  page?: number;
  perPage?: number;
  action?: string | null;
  targetType?: string | null;
}): Promise<{
  items: Array<{
    id: string;
    action: string;
    target_type: string;
    target_id: string | null;
    detail: unknown;
    created_at: string;
  }>;
  page: number;
  per_page: number;
  has_more: boolean;
}> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 50));
  const offset = (page - 1) * perPage;
  const db = getDb();

  const rows = await db<
    Array<{
      id: string;
      action: string;
      target_type: string;
      target_id: string | null;
      detail: unknown;
      created_at: Date;
    }>
  >`
    SELECT id::text, action, target_type, target_id, detail, created_at
    FROM admin_audit_log
    WHERE (${opts.action ?? null}::text IS NULL OR action = ${opts.action ?? null})
      AND (${opts.targetType ?? null}::text IS NULL OR target_type = ${opts.targetType ?? null})
    ORDER BY created_at DESC
    LIMIT ${perPage + 1} OFFSET ${offset}
  `;

  const hasMore = rows.length > perPage;
  const items = rows.slice(0, perPage).map((r) => ({
    ...r,
    created_at: r.created_at.toISOString(),
  }));
  return { items, page, per_page: perPage, has_more: hasMore };
}
