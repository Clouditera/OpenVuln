import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, CircleAlert, Github, LoaderCircle } from "lucide-react";
import { ApiError, api, navigateToLogin } from "../shared/api/client";
import { useMe } from "../features/auth/useAuth";
import { Button } from "./Button";

function mapError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }
  const reason = String(err.context?.reason ?? "");
  const message = String(err.context?.message ?? "");
  if (err.status === 401) {
    return "Please sign in with GitHub to submit a repository.";
  }
  if (err.status === 403) {
    return (
      message ||
      "Only accounts with admin or maintain permission on this repository can submit it."
    );
  }
  if (reason === "invalid_github_url") {
    return "That doesn't look like a GitHub repository URL. Expected: https://github.com/owner/repo";
  }
  if (reason === "private_repo") {
    return "This repository is private or does not exist. OpenVuln scans public projects only.";
  }
  if (reason === "cooldown") {
    const days = err.context?.retry_after_days;
    return `This project was scanned recently. You can resubmit after ${days ?? "a few"} day(s).`;
  }
  if (reason === "duplicate" || err.status === 409) {
    return message || "This project is already on OpenVuln.";
  }
  if (err.status === 404) {
    return "This repository is private or does not exist. OpenVuln scans public projects only.";
  }
  if (err.status >= 500) {
    return "OpenVuln is temporarily unavailable. Please try again in a moment.";
  }
  return message || err.message || "Submission failed.";
}

export function RepoSubmitForm({
  size = "default",
  appearance = "default",
  className = "",
}: {
  size?: "default" | "hero";
  appearance?: "default" | "dark";
  className?: string;
}) {
  const nav = useNavigate();
  const meQ = useMe();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const hero = size === "hero";
  const dark = appearance === "dark";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const git_url = url.trim();
    if (!git_url) {
      setError("Please paste a GitHub repository URL.");
      return;
    }
    // 未登录 → 整页跳 GitHub OAuth，登录后回到当前页
    if (meQ.data && !meQ.data.authenticated) {
      navigateToLogin();
      window.dispatchEvent(new Event("ov-oauth-popup-opened"));
      return;
    }
    setPending(true);
    try {
      const res = await api.submitProject({ git_url });
      nav(`/p/${res.project.owner_login}/${res.project.name}`, {
        state: { justSubmitted: true },
      });
    } catch (err) {
      setError(mapError(err));
    } finally {
      setPending(false);
    }
  };

  if (dark) {
    return (
      <form
        onSubmit={(e) => void onSubmit(e)}
        className={className}
        aria-label="Submit a GitHub repository"
        aria-busy={pending}
      >
        <div
          className={`openvuln-composer group flex min-h-[66px] items-center gap-3 rounded-[22px] border bg-[#111216] p-2 pl-5 shadow-[0_24px_90px_rgba(0,0,0,0.52)] transition focus-within:bg-[#15161b] focus-within:shadow-[0_28px_110px_rgba(68,70,88,0.2)] ${
            error ? "border-[#a94d55]" : "border-[#333] focus-within:border-[#555866]"
          }`}
        >
          <Github
            size={20}
            className="shrink-0 text-[#6d6f78] transition group-focus-within:text-[#acacb0]"
          />
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="Paste a public GitHub repository URL"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-3 text-[15px] text-[#f0f2f6] outline-none placeholder:text-[#696a70] sm:text-base"
            aria-label="GitHub repository URL"
            aria-invalid={!!error}
          />
          <button
            type="submit"
            aria-label={pending ? "Submitting repository" : "Analyze repository"}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#0d0d0f] bg-[#ebecf0] text-[#0d0d0f] shadow-sm transition hover:scale-[1.03] hover:bg-white active:scale-95 focus-ring-dark disabled:cursor-not-allowed disabled:bg-[#484a58] disabled:text-[#989aa5] disabled:opacity-100"
            disabled={!url.trim() || pending}
          >
            {pending ? (
              <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <ArrowUp size={21} strokeWidth={2.2} />
            )}
          </button>
        </div>

        <div className="mt-3 flex min-h-5 items-start justify-center gap-1.5 text-center text-xs text-[#77787e]">
          {error ? (
            <span className="inline-flex items-start gap-1.5 text-[#ff9ca5]" role="alert">
              <CircleAlert size={14} className="mt-px shrink-0" />
              <span>{error}</span>
            </span>
          ) : pending ? (
            <span className="text-[#b9bfd2]" role="status">Submitting repository…</span>
          ) : (
            <span>Public repositories · Repository maintainers only</span>
          )}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={className}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          spellCheck={false}
          className={`h-12 flex-1 rounded-lg border bg-surface-raised px-3.5 font-mono text-sm text-ink placeholder:text-ink-tertiary focus-ring ${
            error ? "border-danger" : "border-line"
          }`}
          aria-invalid={!!error}
        />
        <Button type="submit" size="lg" disabled={pending} className="rounded-lg shrink-0">
          {pending ? "Submitting…" : "Submit"}
        </Button>
      </div>
      {error && (
        <p
          className={`mt-2 flex items-start gap-1.5 text-sm text-danger ${hero ? "justify-center text-left" : ""}`}
          role="alert"
        >
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </form>
  );
}
