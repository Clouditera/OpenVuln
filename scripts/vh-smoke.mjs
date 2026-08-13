#!/usr/bin/env node
/**
 * VulnHunter connectivity smoke test (token mode).
 *
 * Reads secrets from a local credentials file (never prints them):
 *   ~/.private/prod-openvuln-account/credentials.txt   (key: value lines)
 * Or env:
 *   VULNHUNTER_BASE_URL + VULNHUNTER_API_TOKEN
 *
 * Usage:
 *   node scripts/vh-smoke.mjs
 *   node scripts/vh-smoke.mjs --create   # also try createScanTask (needs LLM creds on VH account)
 *   node scripts/vh-smoke.mjs --task <id>  # poll existing task + list findings
 *
 * Exit 0 = health + auth OK (and optional create/poll steps if requested and successful).
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadCreds() {
  const path =
    process.env.VULNHUNTER_CREDENTIALS_FILE ||
    join(homedir(), ".private/prod-openvuln-account/credentials.txt");
  const out = {
    baseUrl: process.env.VULNHUNTER_BASE_URL || "",
    apiToken: process.env.VULNHUNTER_API_TOKEN || "",
    credentialId: process.env.VULNHUNTER_CREDENTIAL_ID || "",
  };
  if (existsSync(path)) {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#") || !s.includes(":")) continue;
      const i = s.indexOf(":");
      const k = s.slice(0, i).trim().toLowerCase();
      const v = s.slice(i + 1).trim();
      if (k === "base_url" || k === "url") out.baseUrl = v;
      if (k === "api_token" || k === "token") out.apiToken = v;
      if (k === "credential_id") out.credentialId = v;
    }
    console.log(`loaded credentials file (${path})`);
  }
  out.baseUrl = out.baseUrl.replace(/\/$/, "");
  if (!out.baseUrl.startsWith("http")) out.baseUrl = `https://${out.baseUrl}`;
  return out;
}

async function req(base, token, method, path, body) {
  const headers = {
    accept: "application/json",
    "user-agent": "OpenVuln-vh-smoke/0.1",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, json, text };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name) {
  return process.argv.includes(name);
}

async function main() {
  const creds = loadCreds();
  if (!creds.baseUrl) {
    console.error("missing base_url");
    process.exit(2);
  }
  console.log(`base_url host ok (len=${creds.baseUrl.length}) token=${creds.apiToken ? "yes" : "no"}`);

  // 1) health (no auth)
  const health = await req(creds.baseUrl, "", "GET", "/health");
  console.log(`health: ${health.status}`);
  if (health.status !== 200) process.exit(1);

  // 2) auth — list tasks
  const tasks = await req(creds.baseUrl, creds.apiToken, "GET", "/api/tasks?limit=1");
  console.log(`GET /api/tasks: ${tasks.status}`);
  if (tasks.status !== 200) {
    console.error("token auth failed", tasks.json?.error || tasks.json);
    process.exit(1);
  }

  // 3) credentials present?
  const credList = await req(
    creds.baseUrl,
    creds.apiToken,
    "GET",
    "/api/settings/credentials",
  );
  const n =
    credList.json?.credentials?.length ??
    credList.json?.items?.length ??
    (Array.isArray(credList.json) ? credList.json.length : 0);
  console.log(`GET /api/settings/credentials: ${credList.status} count=${n}`);

  const taskId = arg("--task");
  if (taskId) {
    const t = await req(creds.baseUrl, creds.apiToken, "GET", `/api/tasks/${taskId}`);
    const state = t.json?.task?.state ?? t.json?.state;
    console.log(`GET task: ${t.status} state=${state}`);
    const f = await req(
      creds.baseUrl,
      creds.apiToken,
      "GET",
      `/api/tasks/${taskId}/findings?item_type=all&limit=5`,
    );
    const findings = f.json?.findings ?? f.json?.items ?? [];
    console.log(`GET findings: ${f.status} count=${findings.length}`);
    if (findings[0]) {
      const sample = findings[0];
      console.log(
        "finding_fields",
        Object.keys(sample).sort().join(","),
      );
      console.log(
        "has_poc_status",
        "poc_status" in sample,
        "has_cvss",
        "cvss_score" in sample || "cvss" in sample,
        "item_type",
        sample.item_type,
      );
    }
  }

  if (has("--create")) {
    if (n === 0 && !creds.credentialId) {
      console.error(
        "BLOCKED: VH account has 0 LLM credentials. Configure a model credential on the service account (or pass credential_id) before createScanTask can succeed.",
      );
      process.exit(3);
    }
    const name = `openvuln-smoke-${Date.now()}`;
    const body = {
      git_url: arg("--git") || "https://github.com/octocat/Hello-World",
      project_name: "Hello-World",
      display_name: name,
    };
    if (creds.credentialId) body.credential_id = creds.credentialId;
    else if (n > 0) {
      const list = credList.json?.credentials || credList.json?.items || credList.json;
      const first = list[0];
      if (first?.id) body.credential_id = first.id;
    }
    const created = await req(creds.baseUrl, creds.apiToken, "POST", "/api/tasks", body);
    console.log(`POST /api/tasks: ${created.status}`);
    if (created.status >= 400) {
      console.error("create error code", created.json?.error?.code, created.json?.error?.detail || "");
      process.exit(1);
    }
    const tid = created.json?.task?.id || created.json?.id;
    console.log(`created task_id present: ${Boolean(tid)}`);
    if (tid && has("--poll")) {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const t = await req(creds.baseUrl, creds.apiToken, "GET", `/api/tasks/${tid}`);
        const state = t.json?.task?.state ?? t.json?.state;
        const f = await req(
          creds.baseUrl,
          creds.apiToken,
          "GET",
          `/api/tasks/${tid}/findings?item_type=all&limit=50`,
        );
        const findings = f.json?.findings ?? [];
        console.log(`poll[${i}] state=${state} findings=${findings.length}`);
        if (state === "completed" || state === "failed" || state === "cancelled") break;
      }
    }
  }

  console.log("smoke OK (auth + health)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
