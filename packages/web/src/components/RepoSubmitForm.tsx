import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleAlert } from "lucide-react";
import { ApiError, api } from "../shared/api/client";
import { Button } from "./Button";

function mapError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }
  const reason = String(err.context?.reason ?? "");
  const message = String(err.context?.message ?? "");
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
  return message || err.message || "Submission failed.";
}

export function RepoSubmitForm({
  size = "default",
  className = "",
}: {
  size?: "default" | "hero";
  className?: string;
}) {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const hero = size === "hero";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const git_url = url.trim();
    if (!git_url) {
      setError("Please paste a GitHub repository URL.");
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
