import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { RepoSubmitForm } from "../../components/RepoSubmitForm";

export function SubmitPage() {
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
        statistics.
      </p>

      <div className="mt-8">
        <RepoSubmitForm />
      </div>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-display text-base font-semibold text-ink">What happens next</h2>
        <ol className="mt-4 space-y-3 text-sm text-ink-secondary">
          {[
            "We verify the repository is public and resolve forks to upstream",
            "It enters the scan queue",
            "VulnHunter scans the default branch",
            "Aggregate statistics go public; details stay owner-only",
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
