#!/usr/bin/env node
/**
 * OpenVuln admin CLI — keygen / fetch-package / decrypt / disclose
 * Private key never leaves this machine.
 */
import { readFileSync, writeFileSync, chmodSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  generateAdminKeyPair,
  decryptForAdmin,
  signDiscloseBody,
  newNonce,
  type DiscloseBody,
} from "@openvuln/shared/crypto";

function usage(): never {
  console.log(`openvuln-admin <command> [options]

Commands:
  keygen   --out <priv.pem> [--passphrase]
  fetch-package --api <url> --token <t> --project <id> --out <pkg.json>
  decrypt  <pkg.json> --key <priv.pem> --out <report.md|json> [--format md|json]
  disclose --api <url> --token <t> --key <priv.pem> --package <pkg.json>
           --findings <id,id,...> [--summary "..."]
  import   --api <url> --token <t> --repo owner/name --run-dir <path> [--commit sha]
`);
  process.exit(1);
}

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

function has(name: string, argv: string[]): boolean {
  return argv.includes(name);
}

async function askPassphrase(): Promise<string> {
  const rl = createInterface({ input, output });
  const p = await rl.question("Private key passphrase: ");
  rl.close();
  return p;
}

async function main(): Promise<void> {
  const [cmd, ...argv] = process.argv.slice(2);
  if (!cmd) usage();

  if (cmd === "keygen") {
    const out = arg("--out", argv) ?? "openvuln-admin.pem";
    const usePass = has("--passphrase", argv);
    const pass = usePass ? await askPassphrase() : undefined;
    const keys = generateAdminKeyPair(pass);
    writeFileSync(out, keys.privateKeyPem, { mode: 0o600 });
    chmodSync(out, 0o600);
    console.log(`Private key written to ${out} (mode 0600)`);
    console.log(`kid=${keys.kid}`);
    console.log(`\n# Set on server:\nADMIN_PUBLIC_KEY=${keys.publicKeyEnv}`);
    return;
  }

  if (cmd === "fetch-package") {
    const api = arg("--api", argv);
    const token = arg("--token", argv);
    const project = arg("--project", argv);
    const out = arg("--out", argv) ?? "package.json";
    if (!api || !token || !project) usage();
    const res = await fetch(`${api.replace(/\/$/, "")}/api/admin/projects/${project}/report-package`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(`HTTP ${res.status}`, await res.text());
      process.exit(1);
    }
    const text = await res.text();
    writeFileSync(out, text);
    console.log(`Wrote ${out}`);
    return;
  }

  if (cmd === "decrypt") {
    const pkgPath = argv.find((a) => !a.startsWith("--"));
    const keyPath = arg("--key", argv);
    const out = arg("--out", argv) ?? "report.md";
    const format = arg("--format", argv) ?? (out.endsWith(".json") ? "json" : "md");
    if (!pkgPath || !keyPath) usage();
    const pass = has("--passphrase", argv) ? await askPassphrase() : undefined;
    const priv = readFileSync(resolve(keyPath), "utf8");
    const pkg = JSON.parse(readFileSync(resolve(pkgPath), "utf8")) as {
      project: { full_name: string; id?: string };
      items: Array<{
        finding_id: string;
        finding_key: string;
        severity: string;
        cwe: string | null;
        enc_payload: string;
        disclosure_state: string;
      }>;
      artifacts?: Array<{
        artifact_id: string;
        finding_id: string;
        finding_key: string;
        kind: string;
        rel_path: string;
        file_name: string;
        mime: string | null;
        size_bytes: number;
        truncated: boolean;
        is_binary: boolean;
        enc_content: string | null;
      }>;
    };
    const rows = pkg.items.map((it) => {
      const pt = decryptForAdmin(priv, it.finding_id, it.enc_payload, pass);
      return { ...it, plain: pt };
    });
    // OVENC1 artifacts (AAD = artifact_id)
    const artPlain = (pkg.artifacts ?? []).map((a) => {
      if (!a.enc_content?.startsWith("OVENC1.")) {
        return { ...a, plain: null as ReturnType<typeof decryptForAdmin> | null };
      }
      try {
        return { ...a, plain: decryptForAdmin(priv, a.artifact_id, a.enc_content, pass) };
      } catch (err) {
        console.warn(`artifact decrypt failed ${a.artifact_id}:`, err);
        return { ...a, plain: null };
      }
    });
    if (format === "json") {
      writeFileSync(
        out,
        JSON.stringify(
          {
            project: pkg.project,
            findings: rows.map((r) => ({
              finding_id: r.finding_id,
              finding_key: r.finding_key,
              severity: r.severity,
              cwe: r.cwe,
              disclosure_state: r.disclosure_state,
              ...r.plain,
            })),
            artifacts: artPlain.map((a) => ({
              artifact_id: a.artifact_id,
              finding_id: a.finding_id,
              finding_key: a.finding_key,
              kind: a.kind,
              rel_path: a.rel_path,
              file_name: a.file_name,
              mime: a.mime,
              size_bytes: a.size_bytes,
              truncated: a.truncated,
              is_binary: a.is_binary,
              plain: a.plain,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      const artByFinding = new Map<string, typeof artPlain>();
      for (const a of artPlain) {
        const list = artByFinding.get(a.finding_id) ?? [];
        list.push(a);
        artByFinding.set(a.finding_id, list);
      }
      const lines = [
        `# ${pkg.project.full_name} — decrypted findings`,
        ``,
        ...rows.flatMap((r) => {
          const arts = artByFinding.get(r.finding_id) ?? [];
          return [
            `## [${r.severity}] ${r.plain.title}`,
            ``,
            `- key: \`${r.finding_key}\``,
            `- id: \`${r.finding_id}\``,
            `- cwe: ${r.cwe ?? "—"}`,
            `- file: ${r.plain.primary_file ?? "—"}`,
            `- state: ${r.disclosure_state}`,
            ``,
            "```json",
            JSON.stringify(r.plain.detail, null, 2),
            "```",
            ``,
            ...arts.flatMap((a) => {
              let text = "_(no plaintext / binary)_";
              if (a.plain?.detail && typeof a.plain.detail === "object") {
                const d = a.plain.detail as { text?: string };
                text = d.text ?? JSON.stringify(a.plain.detail, null, 2);
              } else if (a.plain) {
                text = JSON.stringify(a.plain, null, 2);
              }
              return [
                `### artifact [${a.kind}] ${a.file_name}`,
                ``,
                `- path: \`${a.rel_path}\``,
                `- artifact_id: \`${a.artifact_id}\``,
                ``,
                "```",
                text,
                "```",
                ``,
              ];
            }),
          ];
        }),
      ];
      writeFileSync(out, lines.join("\n"));
    }
    const artOk = artPlain.filter((a) => a.plain).length;
    console.log(
      `Decrypted ${rows.length} findings` +
        (pkg.artifacts?.length ? ` + ${artOk}/${pkg.artifacts.length} artifacts` : "") +
        ` → ${out}`,
    );
    return;
  }

  if (cmd === "disclose") {
    const api = arg("--api", argv);
    const token = arg("--token", argv);
    const keyPath = arg("--key", argv);
    const pkgPath = arg("--package", argv);
    const findingsArg = arg("--findings", argv);
    const summary = arg("--summary", argv);
    if (!api || !token || !keyPath || !pkgPath || !findingsArg) usage();
    const pass = has("--passphrase", argv) ? await askPassphrase() : undefined;
    const priv = readFileSync(resolve(keyPath), "utf8");
    const pkg = JSON.parse(readFileSync(resolve(pkgPath), "utf8")) as {
      project: { id: string };
      items: Array<{
        finding_id: string;
        finding_key: string;
        severity: string;
        cwe: string | null;
        enc_payload: string;
      }>;
    };
    const want = new Set(findingsArg.split(",").map((s) => s.trim()).filter(Boolean));
    const pkgArts = (
      pkg as {
        artifacts?: Array<{
          artifact_id: string;
          finding_id: string;
          kind: string;
          rel_path: string;
          file_name: string;
          enc_content: string | null;
        }>;
      }
    ).artifacts;
    const items = [];
    for (const it of pkg.items) {
      if (!want.has(it.finding_id) && !want.has(it.finding_key)) continue;
      const pt = decryptForAdmin(priv, it.finding_id, it.enc_payload, pass);
      const reportYaml =
        typeof pt.report_yaml === "string" && pt.report_yaml.length > 0
          ? pt.report_yaml
          : null;
      const files: Array<{
        kind: "poc" | "exp" | "report" | "other";
        rel_path: string;
        file_name: string;
        content: string;
      }> = [];
      if (reportYaml) {
        files.push({
          kind: "report",
          rel_path: "report.yaml",
          file_name: "report.yaml",
          content: reportYaml,
        });
      }
      for (const a of pkgArts ?? []) {
        if (a.finding_id !== it.finding_id) continue;
        if (!a.enc_content?.startsWith("OVENC1.")) continue;
        try {
          const ap = decryptForAdmin(priv, a.artifact_id, a.enc_content, pass);
          const text =
            ap.detail && typeof ap.detail === "object"
              ? String((ap.detail as { text?: string }).text ?? "")
              : "";
          if (!text) continue;
          const kind = (a.kind === "poc" || a.kind === "exp" ? a.kind : "other") as
            | "poc"
            | "exp"
            | "other";
          // public zip path: poc/foo.md or exp/bar.py
          const short = a.rel_path.includes("/")
            ? a.rel_path.split("/").slice(-2).join("/")
            : `${kind}/${a.file_name}`;
          files.push({
            kind,
            rel_path: short.startsWith("poc/") || short.startsWith("exp/") ? short : `${kind}/${a.file_name}`,
            file_name: a.file_name,
            content: text,
          });
        } catch {
          /* skip bad artifact */
        }
      }
      items.push({
        finding_id: it.finding_id,
        title: pt.title,
        cwe: it.cwe,
        summary: summary ?? null,
        report_yaml: reportYaml,
        files,
      });
    }
    if (items.length === 0) {
      console.error("No matching findings in package");
      process.exit(1);
    }
    const body: DiscloseBody = {
      action: "disclose",
      project_id: pkg.project.id,
      items,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: newNonce(),
    };
    const sig = signDiscloseBody(priv, body, pass);
    const res = await fetch(
      `${api.replace(/\/$/, "")}/api/admin/projects/${pkg.project.id}/disclose`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-ov-signature": sig,
        },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error(`HTTP ${res.status}`, text);
      process.exit(1);
    }
    console.log(text);
    return;
  }

  if (cmd === "import") {
    const api = arg("--api", argv);
    const token = arg("--token", argv);
    const repo = arg("--repo", argv);
    const runDir = arg("--run-dir", argv);
    const commit = arg("--commit", argv);
    if (!api || !token || !repo || !runDir) usage();
    const root = resolve(runDir);
    const findingsDir = join(root, "findings");
    let dirs: string[];
    try {
      dirs = readdirSync(findingsDir).filter((n) => {
        try {
          return statSync(join(findingsDir, n)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch (err) {
      console.error(`Cannot read ${findingsDir}`, err);
      process.exit(1);
    }

    const TEXT_RE =
      /\.(md|txt|py|sh|js|ts|c|h|ya?ml|json|log|toml|ini|cfg|conf|html|xml|csv)$/i;
    const findings = [];
    for (const key of dirs) {
      const dir = join(findingsDir, key);
      const yamlPath = join(dir, "report.yaml");
      let report_yaml: string;
      try {
        report_yaml = readFileSync(yamlPath, "utf8");
      } catch {
        continue;
      }
      const artifacts: Array<{
        kind: "poc" | "exp" | "other";
        rel_path: string;
        file_name: string;
        content: string;
      }> = [];
      for (const sub of ["poc", "exp"] as const) {
        const subDir = join(dir, sub);
        let files: string[] = [];
        try {
          files = walkFiles(subDir);
        } catch {
          continue;
        }
        for (const abs of files) {
          const rel = relative(dir, abs).replace(/\\/g, "/");
          if (!TEXT_RE.test(rel) && !/\/$/.test(rel)) {
            // skip obvious binaries by extension
            if (/\.(zip|gz|tgz|png|jpg|jpeg|bin|so|exe|o|a)$/i.test(rel)) continue;
          }
          if (/\.(zip|gz|tgz|png|jpg|jpeg|bin|so|exe|o|a)$/i.test(rel)) continue;
          let content: string;
          try {
            content = readFileSync(abs, "utf8");
          } catch {
            continue;
          }
          // skip if looks binary
          if (content.includes("\u0000")) continue;
          artifacts.push({
            kind: sub,
            rel_path: rel,
            file_name: abs.split(/[/\\]/).pop() || rel,
            content,
          });
        }
      }
      findings.push({ finding_key: key, report_yaml, artifacts });
    }

    console.log(`Parsed ${findings.length} finding dirs from ${findingsDir}`);
    const res = await fetch(`${api.replace(/\/$/, "")}/api/admin/import`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repo,
        commit_sha: commit ?? null,
        findings,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`HTTP ${res.status}`, text);
      process.exit(1);
    }
    console.log(text);
    return;
  }

  usage();
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkFiles(p));
    else if (st.isFile()) out.push(p);
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
