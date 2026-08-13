/**
 * Parse VH/VulnForge report.yaml and render a full Markdown report
 * (information-equivalent to the source yaml for public download).
 */
import * as yaml from "js-yaml";

export type ParsedReport = {
  metadata: Record<string, unknown>;
  description: Record<string, unknown>;
  code: Record<string, unknown>;
  references: unknown;
  /** Other top-level keys preserved */
  extra: Record<string, unknown>;
};

export function parseReportYaml(raw: string): ParsedReport | null {
  if (!raw?.trim()) return null;
  try {
    const doc = yaml.load(raw) as Record<string, unknown> | null;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    const metadata = asRecord(doc.metadata);
    const description = asRecord(doc.description);
    const code = asRecord(doc.code);
    const { metadata: _m, description: _d, code: _c, references, ...rest } = doc;
    return {
      metadata,
      description,
      code,
      references: references ?? null,
      extra: rest,
    };
  } catch {
    return null;
  }
}

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

function mdEscape(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

function heading(level: number, text: string): string {
  return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${text}\n\n`;
}

function para(text: string): string {
  const t = mdEscape(text).trim();
  if (!t) return "";
  return `${t}\n\n`;
}

function bullet(label: string, value: unknown): string {
  const v = str(value);
  if (!v) return "";
  return `- **${label}:** ${v}\n`;
}

function renderDataflow(code: Record<string, unknown>): string {
  const flow = code.dataflow ?? code.data_flow;
  if (!Array.isArray(flow) || flow.length === 0) return "";
  let out = heading(2, "Data flow");
  for (const step of flow) {
    if (!step || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    const n = s.step ?? "";
    const loc = str(s.location);
    const desc = str(s.description);
    out += `### Step ${n}${loc ? ` — \`${loc}\`` : ""}\n\n`;
    if (desc) out += para(desc);
  }
  return out;
}

function renderAnchors(metadata: Record<string, unknown>): string {
  const anchors = metadata.anchors;
  if (!Array.isArray(anchors) || anchors.length === 0) return "";
  let out = heading(2, "Code anchors");
  out += `| File | Line | Function |\n|---|---:|---|\n`;
  for (const a of anchors) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const file = str(r.file_path) || "—";
    const line = r.line != null ? String(r.line) : "—";
    const fn = str(r.function) || "—";
    out += `| \`${file.replace(/\|/g, "\\|")}\` | ${line} | \`${fn.replace(/\|/g, "\\|")}\` |\n`;
  }
  out += "\n";
  return out;
}

/**
 * Full markdown from report.yaml — not the thin public summary.
 */
export function renderReportYamlToMarkdown(
  raw: string,
  opts?: { findingKey?: string; projectFullName?: string },
): string {
  const parsed = parseReportYaml(raw);
  if (!parsed) {
    // Fallback: fenced raw yaml
    return [
      opts?.findingKey ? `# ${opts.findingKey}` : `# Report`,
      ``,
      "```yaml",
      raw.trimEnd(),
      "```",
      ``,
    ].join("\n");
  }

  const { metadata: m, description: d, code: c, references } = parsed;
  const title = str(m.title) || opts?.findingKey || "Disclosed finding";
  let out = "";
  out += heading(1, title);

  if (opts?.projectFullName) out += bullet("Project", opts.projectFullName);
  out += bullet("Finding key", opts?.findingKey);
  out += bullet("CWE", m.cwe ?? m.vuln_type);
  out += bullet("Severity", m.severity);
  out += bullet("CVSS", m.cvss_score != null ? `${m.cvss_score} (\`${m.cvss_vector ?? ""}\`)` : m.cvss_vector);
  out += bullet("EV priority", m.ev_priority);
  out += bullet("EV score", m.ev_score);
  out += bullet("PoC status", m.poc_status);
  out += bullet("EXP status", m.exp_status);
  out += bullet("Affected versions", m.affected_versions);
  out += "\n";

  if (str(m.ev_rationale)) {
    out += heading(2, "Exploitability rationale");
    out += para(str(m.ev_rationale));
  }

  out += renderAnchors(m);

  if (str(d.background)) {
    out += heading(2, "Background");
    out += para(str(d.background));
  }
  if (str(d.detailed_description) || str(d.summary)) {
    out += heading(2, "Description");
    out += para(str(d.detailed_description) || str(d.summary));
  }
  if (str(d.attack_description) || str(d.attack_payload_description)) {
    out += heading(2, "Attack");
    if (str(d.attack_description)) out += para(str(d.attack_description));
    if (str(d.attack_payload_description)) {
      out += heading(3, "Payload");
      out += para(str(d.attack_payload_description));
    }
  }
  if (str(d.impact) || str(d.combined_impact)) {
    out += heading(2, "Impact");
    out += para(str(d.impact) || str(d.combined_impact));
  }
  if (str(d.remediation) || str(d.fix_suggestion)) {
    out += heading(2, "Remediation");
    out += para(str(d.remediation) || str(d.fix_suggestion));
  }

  // Other description string fields
  for (const [k, v] of Object.entries(d)) {
    if (
      [
        "background",
        "detailed_description",
        "summary",
        "attack_description",
        "attack_payload_description",
        "impact",
        "combined_impact",
        "remediation",
        "fix_suggestion",
      ].includes(k)
    ) {
      continue;
    }
    if (typeof v === "string" && v.trim()) {
      out += heading(2, k.replace(/_/g, " "));
      out += para(v);
    }
  }

  out += renderDataflow(c);

  if (str(c.fix_patch) || str(c.patch)) {
    out += heading(2, "Fix / patch notes");
    out += para(str(c.fix_patch) || str(c.patch));
  }

  // Snippets
  for (const [k, v] of Object.entries(c)) {
    if (k === "dataflow" || k === "data_flow" || k === "fix_patch" || k === "patch") continue;
    if (typeof v === "string" && v.trim()) {
      out += heading(2, k.replace(/_/g, " "));
      out += "```\n" + v.replace(/\n$/, "") + "\n```\n\n";
    }
  }

  if (references != null) {
    out += heading(2, "References");
    if (Array.isArray(references)) {
      for (const ref of references) {
        if (typeof ref === "string") out += `- ${ref}\n`;
        else if (ref && typeof ref === "object") {
          const r = ref as Record<string, unknown>;
          out += `- ${str(r.title) || str(r.url) || JSON.stringify(ref)}\n`;
        }
      }
      out += "\n";
    } else if (typeof references === "string") {
      out += para(references);
    }
  }

  out += "---\n\n";
  out += "_Rendered from original VulnHunter / VulnForge `report.yaml` by OpenVuln._\n";
  return out;
}
