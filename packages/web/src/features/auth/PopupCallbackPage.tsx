import { useEffect, useState } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import { apiUrl, type MeResponse } from "../../shared/api/client";

/**
 * Popup OAuth completion page: after GitHub redirect, this page runs in the
 * popup window (top-level, not iframe). It fetches /api/me from the API origin
 * (cookie works here since it's a top-level request), then postMessages the
 * result to the opener (iframe on huggingface.co where third-party cookies
 * are blocked).
 */
export function PopupCallbackPage() {
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let closed = false;

    async function complete() {
      try {
        // This is a top-level window request — SameSite=None cookie IS sent
        const res = await fetch(apiUrl("/api/me"), { credentials: "include" });
        const data: MeResponse = await res.json();

        if (!closed && window.opener) {
          window.opener.postMessage(
            { type: "ov-oauth-complete", user: data },
            "*",
          );
        }
        setStatus("done");
      } catch {
        setStatus("error");
        // Still signal opener to try polling as fallback
        if (!closed && window.opener) {
          window.opener.postMessage({ type: "ov-oauth-complete" }, "*");
        }
      }

      // Auto-close after showing success
      window.setTimeout(() => {
        if (!closed) {
          try { window.close(); } catch { /* noop */ }
        }
      }, 2000);
    }

    complete();
    return () => { closed = true; };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-8 text-center">
        <Loader2 size={40} className="animate-spin text-accent-600" strokeWidth={1.6} />
        <p className="mt-4 text-sm text-ink-secondary">Completing sign-in…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-8 text-center">
        <p className="text-sm text-ink-secondary">
          Sign-in may not have completed. You can close this tab.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-8 text-center">
      <CircleCheck size={44} className="text-success" strokeWidth={1.6} />
      <h1 className="mt-4 font-display text-xl font-semibold text-ink">Sign-in complete</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        You can close this tab and return to OpenVuln.
      </p>
    </div>
  );
}
