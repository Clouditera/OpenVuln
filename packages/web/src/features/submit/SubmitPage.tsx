import { Link } from "react-router-dom";
import { ArrowLeft, Github } from "lucide-react";
import { RepoSubmitForm } from "../../components/RepoSubmitForm";
import { loginUrl, navigateToLogin } from "../../shared/api/client";
import { useMe } from "../../features/auth/useAuth";

export function SubmitPage() {
  const meQ = useMe();
  const authed = meQ.data?.authenticated === true;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary hover:text-ink"
      >
        <ArrowLeft size={14} /> Projects
      </Link>
      <div className="max-w-xl">
      <h1 className="mt-4 font-display text-xl font-bold text-ink">Submit a project</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Paste a public GitHub repository URL. We scan the default branch and publish aggregate
        statistics. Submitting requires a GitHub account with <strong className="font-medium text-ink">admin or maintain</strong> permission
        on the repository.
      </p>

      <div className="mt-8">
        {meQ.isLoading ? (
          <div className="h-12 animate-pulse rounded-lg bg-surface-sunken" aria-label="Loading" />
        ) : authed ? (
          <RepoSubmitForm />
        ) : (
          <div className="rounded-xl border border-line bg-surface-sunken/50 p-6 text-center">
            <p className="font-display text-base font-semibold text-ink">
              Sign in to submit your repository
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
              OpenVuln scans are available to repository owners. We verify your GitHub role on
              every submission — only maintainers and admins can start a scan.
            </p>
            <a
              href={loginUrl("/submit")}
              onClick={(e) => {
                if (window.top && window.top !== window.self) {
                  e.preventDefault();
                  navigateToLogin("/submit");
                }
              }}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#ebecf0] px-4 text-sm font-medium text-[#0d0d0f] transition-colors hover:bg-white focus-ring"
            >
              <Github size={16} />
              Sign in with GitHub
            </a>
          </div>
        )}
      </div>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-display text-base font-semibold text-ink">What happens next</h2>
        <ol className="mt-4 space-y-3 text-sm text-ink-secondary">
          {[
            "We verify your GitHub role on the repository (admin or maintain)",
            "It enters the scan queue",
            "VulnHunter scans the default branch",
            "You review full findings and choose what to disclose publicly",
          ].map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="font-mono text-ink-tertiary">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
      </div>
    </div>
  );
}
