/**
 * Structured HTML render of a disclosed VH/VulnForge report
 * (parsed report object preferred; raw yaml fallback).
 */
import { useMemo } from "react";
import { load as parseYaml } from "js-yaml";

type Anchor = { file_path?: string; line?: number | string; function?: string };
type FlowStep = { step?: number | string; location?: string; description?: string };
type ReportDoc = {
  metadata?: {
    title?: string;
    vuln_type?: string;
    cwe?: string;
    cvss_vector?: string;
    cvss_score?: number | string;
    ev_priority?: string;
    ev_score?: number | string;
    ev_rationale?: string;
    poc_status?: string;
    exp_status?: string;
    affected_versions?: string;
    anchors?: Anchor[];
  };
  description?: {
    background?: string;
    detailed_description?: string;
    summary?: string;
    attack_payload_description?: string;
    attack_description?: string;
    impact?: string;
    combined_impact?: string;
    remediation?: string;
    fix_suggestion?: string;
  };
  code?: {
    dataflow?: FlowStep[];
    data_flow?: FlowStep[];
    fix_patch?: string;
    patch?: string;
  };
  references?: unknown;
};

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <section>
      <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
        <span className="h-3 w-[3px] rounded-full bg-accent-600" aria-hidden />
        {label}
      </p>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Prose({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-secondary">
      {text}
    </p>
  );
}

function normalizeDoc(input: unknown): ReportDoc | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  return {
    metadata: asRecord(r.metadata) as ReportDoc["metadata"],
    description: asRecord(r.description) as ReportDoc["description"],
    code: asRecord(r.code) as ReportDoc["code"],
    references: r.references,
  };
}

export type StructuredReport = {
  metadata: Record<string, unknown>;
  description: Record<string, unknown>;
  code: Record<string, unknown>;
  references: unknown;
};

/** Prefer structured `report`; raw yaml only as fallback. */
export function ReportBody({
  report,
  yaml,
}: {
  report?: StructuredReport | null;
  yaml?: string | null;
}) {
  const doc = useMemo<ReportDoc | null>(() => {
    if (report) return normalizeDoc(report);
    if (yaml?.trim()) {
      try {
        return normalizeDoc(parseYaml(yaml));
      } catch {
        return null;
      }
    }
    return null;
  }, [report, yaml]);

  if (!doc) {
    if (yaml?.trim()) {
      return (
        <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">
          {yaml}
        </pre>
      );
    }
    return (
      <p className="mt-4 text-sm text-ink-tertiary">
        Structured report is not available for this disclosure.
      </p>
    );
  }

  const meta = doc.metadata ?? {};
  const fullTitle = typeof meta === "object" && "title" in meta ? (meta as { title?: string }).title : undefined;
  const desc = doc.description ?? {};
  const anchors = (meta.anchors ?? []).filter((a) => a && (a.file_path || a.function));
  const dataflow = (doc.code?.dataflow ?? doc.code?.data_flow ?? []).filter(Boolean);
  const refList = Array.isArray(doc.references)
    ? doc.references.filter((r) => typeof r === "string" && (r as string).trim())
    : [];

  return (
    <div className="mt-4 space-y-5">
      {fullTitle && (
        <h4 className="font-display text-[15px] font-semibold leading-snug text-ink">{fullTitle}</h4>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
        {meta.vuln_type && (
          <div>
            <dt className="text-ink-tertiary">Type</dt>
            <dd className="mt-0.5 font-medium text-ink">{meta.vuln_type}</dd>
          </div>
        )}
        {meta.cvss_score != null && (
          <div>
            <dt className="text-ink-tertiary">CVSS</dt>
            <dd className="mt-0.5 font-medium text-ink">{meta.cvss_score}</dd>
          </div>
        )}
        {meta.ev_priority && (
          <div>
            <dt className="text-ink-tertiary">EV priority</dt>
            <dd className="mt-0.5 font-medium text-ink">{meta.ev_priority}</dd>
          </div>
        )}
        {meta.poc_status && (
          <div>
            <dt className="text-ink-tertiary">PoC status</dt>
            <dd className="mt-0.5 font-medium text-ink">{meta.poc_status}</dd>
          </div>
        )}
        {meta.exp_status && (
          <div>
            <dt className="text-ink-tertiary">EXP status</dt>
            <dd className="mt-0.5 font-medium text-ink">{meta.exp_status}</dd>
          </div>
        )}
        {meta.affected_versions && (
          <div className="col-span-2 sm:col-span-2">
            <dt className="text-ink-tertiary">Affected</dt>
            <dd className="mt-0.5 font-medium text-ink">{meta.affected_versions}</dd>
          </div>
        )}
        {meta.cvss_vector && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-ink-tertiary">Vector</dt>
            <dd className="mt-0.5 font-mono text-[12px] text-ink-secondary">{meta.cvss_vector}</dd>
          </div>
        )}
      </dl>

      {str(meta.ev_rationale) && (
        <Section label="Exploitability">
          <Prose text={str(meta.ev_rationale)} />
        </Section>
      )}

      {anchors.length > 0 && (
        <Section label="Anchors">
          <ul className="space-y-1.5">
            {anchors.map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2.5 text-[13px]">
                <span className="shrink-0 font-mono font-medium text-ink">
                  {a.file_path}
                  {a.line != null && `:${a.line}`}
                </span>
                {a.function && <span className="text-ink-secondary">{a.function}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {str(desc.background) && (
        <Section label="Background">
          <Prose text={str(desc.background)} />
        </Section>
      )}
      {(str(desc.detailed_description) || str(desc.summary)) && (
        <Section label="Detailed analysis">
          <Prose text={str(desc.detailed_description) || str(desc.summary)} />
        </Section>
      )}
      {(str(desc.attack_payload_description) || str(desc.attack_description)) && (
        <Section label="Attack">
          {str(desc.attack_description) && <Prose text={str(desc.attack_description)} />}
          {str(desc.attack_payload_description) && (
            <Prose text={str(desc.attack_payload_description)} />
          )}
        </Section>
      )}
      {(str(desc.impact) || str(desc.combined_impact)) && (
        <Section label="Impact">
          <Prose text={str(desc.impact) || str(desc.combined_impact)} />
        </Section>
      )}
      {(str(desc.remediation) || str(desc.fix_suggestion)) && (
        <Section label="Remediation">
          <Prose text={str(desc.remediation) || str(desc.fix_suggestion)} />
        </Section>
      )}

      {dataflow.length > 0 && (
        <Section label="Dataflow">
          <ol className="space-y-2.5">
            {dataflow.map((st, i) => (
              <li key={i} className="flex gap-3 text-[13px]">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken font-mono text-[11px] text-ink-secondary">
                  {st.step ?? i + 1}
                </span>
                <div className="min-w-0">
                  {st.location && (
                    <p className="font-mono text-[12px] font-medium text-ink">{st.location}</p>
                  )}
                  {st.description && (
                    <p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed text-ink-secondary">
                      {st.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {(str(doc.code?.fix_patch) || str(doc.code?.patch)) && (
        <Section label="Fix patch">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-sunken px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">
            {str(doc.code?.fix_patch) || str(doc.code?.patch)}
          </pre>
        </Section>
      )}

      {refList.length > 0 && (
        <Section label="References">
          <ul className="space-y-1 text-[13px]">
            {(refList as string[]).map((r, i) =>
              /^https?:\/\//.test(r) ? (
                <li key={i}>
                  <a
                    href={r}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all font-mono text-[12px] text-accent-600 hover:underline"
                  >
                    {r}
                  </a>
                </li>
              ) : (
                <li key={i} className="text-ink-secondary">
                  {r}
                </li>
              ),
            )}
          </ul>
        </Section>
      )}
    </div>
  );
}
