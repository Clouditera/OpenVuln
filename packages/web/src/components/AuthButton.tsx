import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { UserRound, LogOut, ChevronDown, FolderGit2 } from "lucide-react";
import { navigateToLogin, navigateToLoginPopup, isEmbedded, currentReturnTo } from "../shared/api/client";
import { useLogout, useMe } from "../features/auth/useAuth";

/**
 * 顶栏登录态：未登录 = Sign in with GitHub；已登录 = 头像 + 下拉（Logout）。
 * appearance="dark" 用于 zai 深色着陆页头部（与 GitHub pill 同族样式）。
 */
export function AuthButton({ appearance = "light" }: { appearance?: "light" | "dark" }) {
  const meQ = useMe();
  const logoutM = useLogout();
  const { pathname, search } = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  // 加载中/后端未接入 auth：按未登录渲染（不阻塞页面）
  const user = meQ.data?.authenticated ? meQ.data.user : null;
  const dark = appearance === "dark";
  // loginUrl for href fallback (non-iframe); navigateToLogin for onClick
  void pathname; void search;

  if (!user) {
    return (
      <button
        key="auth-anon"
        type="button"
        data-auth-state="signed-out"
        aria-label="Sign in"
        title="Sign in"
        onClick={() => {
          if (isEmbedded()) {
            navigateToLoginPopup();
            window.dispatchEvent(new Event("ov-oauth-popup-opened"));
          } else {
            navigateToLogin(currentReturnTo());
          }
        }}
        className={
          dark
            ? "inline-flex h-9 items-center gap-2 rounded-full border border-[#333] bg-[#030303] px-3.5 text-xs font-medium text-[#acacb0] transition hover:border-[#484a58] hover:bg-[#111216] hover:text-white focus-ring-dark"
            : "inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-sunken focus-ring"
        }
      >
        {/* UserRound only — never Github (repo link is a separate control) */}
        <UserRound size={dark ? 14 : 15} aria-hidden strokeWidth={2} />
        Sign in
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Signed in as ${user.login}`}
        className={
          dark
            ? "flex h-9 items-center gap-1.5 rounded-full border border-[#333] bg-[#030303] p-1 pr-2 transition hover:border-[#484a58] hover:bg-[#111216] focus-ring-dark"
            : "flex h-9 items-center gap-1 rounded-md border border-line bg-surface p-1 pr-1.5 transition-colors hover:bg-surface-sunken focus-ring"
        }
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700">
            {user.login.slice(0, 1).toUpperCase()}
          </span>
        )}
        <ChevronDown
          size={13}
          className={`transition-transform ${dark ? "text-[#77787e]" : "text-ink-tertiary"} ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={
            dark
              ? "absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-xl border border-[#333] bg-[#111216] shadow-[0_16px_50px_rgba(0,0,0,0.5)]"
              : "absolute right-0 top-full z-40 mt-1.5 w-44 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
          }
        >
          <div
            className={`border-b px-3.5 py-2.5 text-[13px] font-medium ${dark ? "border-[#26272c] text-[#f0f2f6]" : "border-line text-ink"}`}
          >
            {user.login}
          </div>
          <a
            role="menuitem"
            href="/my"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              nav("/my");
            }}
            className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] transition-colors ${
              dark
                ? "text-[#acacb0] hover:bg-[#1a1b20] hover:text-white"
                : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            }`}
          >
            <FolderGit2 size={14} />
            My submissions
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logoutM.mutate();
            }}
            disabled={logoutM.isPending}
            className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] transition-colors ${
              dark
                ? "text-[#acacb0] hover:bg-[#1a1b20] hover:text-white"
                : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            }`}
          >
            <LogOut size={14} />
            {logoutM.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
