import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { api, type NotificationItem } from "../shared/api/client";
import { useMe } from "../features/auth/useAuth";
import { formatRelativeTime } from "../shared/lib/format";

function summary(n: NotificationItem): string {
  const c = n.payload.counts;
  const total = c.critical + c.high + c.medium + c.low;
  if (n.payload.no_value) return "Scan completed — no auditable content found";
  if (total === 0) return "Scan completed — no findings";
  const parts: string[] = [];
  if (c.critical) parts.push(`${c.critical} critical`);
  if (c.high) parts.push(`${c.high} high`);
  if (c.medium) parts.push(`${c.medium} medium`);
  if (c.low) parts.push(`${c.low} low`);
  return `Scan completed — ${parts.join(" · ")}`;
}

/** 站内通知铃铛（task-78c9fb3a）：未读红点 + 下拉列表，点击跳项目页并标已读。60s 轮询。 */
export function NotificationBell({ appearance = "light" }: { appearance?: "light" | "dark" }) {
  const meQ = useMe();
  const authed = meQ.data?.authenticated === true;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const listQ = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications(20),
    enabled: authed,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const readM = useMutation({ mutationFn: api.markNotificationsRead, onSettled: invalidate });
  const readAllM = useMutation({ mutationFn: api.markAllNotificationsRead, onSettled: invalidate });

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!authed) return null;

  const dark = appearance === "dark";
  const items = listQ.data?.notifications ?? [];
  const unread = listQ.data?.unread_count ?? 0;

  const openItem = (n: NotificationItem) => {
    setOpen(false);
    if (!n.read_at) readM.mutate([n.id]);
    const [owner, repo] = n.payload.full_name.split("/");
    if (owner && repo) nav(`/p/${owner}/${repo}`);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className={
          dark
            ? "relative flex h-9 w-9 items-center justify-center rounded-full border border-[#333] bg-[#030303] text-[#acacb0] transition hover:border-[#484a58] hover:bg-[#111216] hover:text-white focus-ring-dark"
            : "relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink focus-ring"
        }
      >
        <Bell size={dark ? 14 : 16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={
            dark
              ? "absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-xl border border-[#333] bg-[#111216] shadow-[0_16px_50px_rgba(0,0,0,0.5)]"
              : "absolute right-0 top-full z-40 mt-1.5 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
          }
        >
          <div
            className={`flex items-center justify-between border-b px-3.5 py-2.5 ${dark ? "border-[#26272c]" : "border-line"}`}
          >
            <span className={`text-[13px] font-medium ${dark ? "text-[#f0f2f6]" : "text-ink"}`}>
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => readAllM.mutate()}
                disabled={readAllM.isPending}
                className={`inline-flex items-center gap-1 text-[12px] ${dark ? "text-[#acacb0] hover:text-white" : "text-ink-secondary hover:text-ink"}`}
              >
                <CheckCheck size={13} />
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {listQ.isPending ? (
              <li className={`px-3.5 py-6 text-center text-[13px] ${dark ? "text-[#77787e]" : "text-ink-tertiary"}`}>
                Loading…
              </li>
            ) : items.length === 0 ? (
              <li className={`px-3.5 py-6 text-center text-[13px] ${dark ? "text-[#77787e]" : "text-ink-tertiary"}`}>
                No notifications yet
              </li>
            ) : (
              items.map((n) => {
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openItem(n)}
                      className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors ${
                        dark ? "hover:bg-[#1a1b20]" : "hover:bg-surface-sunken"
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isUnread ? "bg-accent-600" : "bg-transparent"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[13px] font-medium ${dark ? "text-[#f0f2f6]" : "text-ink"}`}>
                          {n.payload.full_name}
                        </span>
                        <span className={`mt-0.5 block text-[12px] leading-snug ${dark ? "text-[#acacb0]" : "text-ink-secondary"}`}>
                          {summary(n)}
                        </span>
                        <span className={`mt-0.5 block font-mono text-[11px] ${dark ? "text-[#696a70]" : "text-ink-tertiary"}`}>
                          {formatRelativeTime(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
