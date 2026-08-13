#!/usr/bin/env node
/**
 * ARCHIVED helper — mock seed for local UI prototyping only.
 *
 * Demo/prod now runs against real VulnHunter + real DB findings.
 * Refusing to run unless ALLOW_SEED_DEMO=1 to avoid wiping real data.
 *
 * Usage (explicit opt-in only):
 *   ALLOW_SEED_DEMO=1 DATABASE_URL=... node packages/service/scripts/seed-demo.mjs
 *   ALLOW_SEED_DEMO=1 node packages/service/scripts/seed-demo.mjs --reset
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { generateAdminKeyPair, encryptForAdmin, decodePublicKeyEnv } from "@openvuln/shared/crypto";

if (process.env.ALLOW_SEED_DEMO !== "1") {
  console.error(
    "[seed-demo] Refusing to run: demo DB is real-mode.\n" +
      "This script injects mock projects/findings and can pollute production data.\n" +
      "If you really need it locally: ALLOW_SEED_DEMO=1 ...",
  );
  process.exit(2);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://openvuln:openvuln@localhost:5433/openvuln";
const RESET = process.argv.includes("--reset");


/** @type {Array<{owner:string,name:string,desc:string,lang:string,stars:number,repoId:number}>} */
const PROJECTS = [
  { owner: "facebook", name: "react", desc: "The library for web and native user interfaces.", lang: "JavaScript", stars: 228000, repoId: 10270250 },
  { owner: "vercel", name: "next.js", desc: "The React Framework for the Web.", lang: "JavaScript", stars: 129000, repoId: 21289110 },
  { owner: "vuejs", name: "core", desc: "Vue.js framework monorepo.", lang: "TypeScript", stars: 48000, repoId: 11730342 },
  { owner: "angular", name: "angular", desc: "Deliver web apps with confidence.", lang: "TypeScript", stars: 97000, repoId: 24195339 },
  { owner: "sveltejs", name: "svelte", desc: "Cybernetically enhanced web apps.", lang: "JavaScript", stars: 82000, repoId: 54495999 },
  { owner: "nodejs", name: "node", desc: "Node.js JavaScript runtime.", lang: "JavaScript", stars: 110000, repoId: 27193779 },
  { owner: "denoland", name: "deno", desc: "A modern runtime for JavaScript and TypeScript.", lang: "Rust", stars: 98000, repoId: 92564518 },
  { owner: "oven-sh", name: "bun", desc: "Incredibly fast JavaScript runtime.", lang: "Zig", stars: 78000, repoId: 41881900 },
  { owner: "microsoft", name: "vscode", desc: "Visual Studio Code.", lang: "TypeScript", stars: 168000, repoId: 41881900 + 1 },
  { owner: "microsoft", name: "TypeScript", desc: "TypeScript is a superset of JavaScript.", lang: "TypeScript", stars: 102000, repoId: 20929025 },
  { owner: "golang", name: "go", desc: "The Go programming language.", lang: "Go", stars: 126000, repoId: 23096959 },
  { owner: "rust-lang", name: "rust", desc: "Empowering everyone to build reliable software.", lang: "Rust", stars: 100000, repoId: 724712 },
  { owner: "python", name: "cpython", desc: "The Python programming language.", lang: "Python", stars: 65000, repoId: 81598961 },
  { owner: "torvalds", name: "linux", desc: "Linux kernel source tree.", lang: "C", stars: 190000, repoId: 2325298 },
  { owner: "kubernetes", name: "kubernetes", desc: "Production-Grade Container Scheduling.", lang: "Go", stars: 113000, repoId: 20580498 },
  { owner: "docker", name: "compose", desc: "Define and run multi-container applications.", lang: "Go", stars: 35000, repoId: 12345601 },
  { owner: "hashicorp", name: "terraform", desc: "Infrastructure as code.", lang: "Go", stars: 44000, repoId: 12345602 },
  { owner: "ansible", name: "ansible", desc: "Automation engine.", lang: "Python", stars: 64000, repoId: 12345603 },
  { owner: "prometheus", name: "prometheus", desc: "Monitoring system and time series database.", lang: "Go", stars: 57000, repoId: 12345604 },
  { owner: "grafana", name: "grafana", desc: "The open observability platform.", lang: "TypeScript", stars: 66000, repoId: 12345605 },
  { owner: "elastic", name: "elasticsearch", desc: "Free and Open Source search engine.", lang: "Java", stars: 72000, repoId: 12345606 },
  { owner: "apache", name: "kafka", desc: "Distributed event streaming platform.", lang: "Java", stars: 29000, repoId: 12345607 },
  { owner: "redis", name: "redis", desc: "In-memory data structure store.", lang: "C", stars: 68000, repoId: 12345608 },
  { owner: "postgres", name: "postgres", desc: "Mirror of the official PostgreSQL GIT repository.", lang: "C", stars: 17000, repoId: 12345609 },
  { owner: "mongodb", name: "mongo", desc: "The MongoDB Database.", lang: "C++", stars: 27000, repoId: 12345610 },
  { owner: "tensorflow", name: "tensorflow", desc: "An Open Source Machine Learning Framework.", lang: "C++", stars: 187000, repoId: 12345611 },
  { owner: "pytorch", name: "pytorch", desc: "Tensors and Dynamic neural networks.", lang: "Python", stars: 87000, repoId: 12345612 },
  { owner: "huggingface", name: "transformers", desc: "State-of-the-art Machine Learning.", lang: "Python", stars: 139000, repoId: 12345613 },
  { owner: "langchain-ai", name: "langchain", desc: "Build context-aware reasoning applications.", lang: "Python", stars: 98000, repoId: 12345614 },
  { owner: "openai", name: "whisper", desc: "Robust Speech Recognition via Large-Scale Weak Supervision.", lang: "Python", stars: 78000, repoId: 12345615 },
  { owner: "tiangolo", name: "fastapi", desc: "FastAPI framework, high performance.", lang: "Python", stars: 82000, repoId: 12345616 },
  { owner: "django", name: "django", desc: "The Web framework for perfectionists with deadlines.", lang: "Python", stars: 82000, repoId: 12345617 },
  { owner: "pallets", name: "flask", desc: "The Python micro framework for building web apps.", lang: "Python", stars: 69000, repoId: 12345618 },
  { owner: "expressjs", name: "express", desc: "Fast, unopinionated, minimalist web framework for Node.", lang: "JavaScript", stars: 66000, repoId: 12345619 },
  { owner: "nestjs", name: "nest", desc: "A progressive Node.js framework.", lang: "TypeScript", stars: 70000, repoId: 12345620 },
  { owner: "spring-projects", name: "spring-boot", desc: "Spring Boot helps you to create stand-alone apps.", lang: "Java", stars: 76000, repoId: 12345621 },
  { owner: "rails", name: "rails", desc: "Ruby on Rails.", lang: "Ruby", stars: 57000, repoId: 12345622 },
  { owner: "laravel", name: "laravel", desc: "A PHP framework for web artisans.", lang: "PHP", stars: 80000, repoId: 12345623 },
  { owner: "gin-gonic", name: "gin", desc: "Gin is a HTTP web framework written in Go.", lang: "Go", stars: 81000, repoId: 12345624 },
  { owner: "tokio-rs", name: "tokio", desc: "A runtime for writing reliable async applications with Rust.", lang: "Rust", stars: 28000, repoId: 12345625 },
];

const CWES = [
  ["CWE-79", "XSS"],
  ["CWE-89", "SQL Injection"],
  ["CWE-22", "Path Traversal"],
  ["CWE-78", "OS Command Injection"],
  ["CWE-352", "CSRF"],
  ["CWE-918", "SSRF"],
  ["CWE-287", "Auth Bypass"],
  ["CWE-502", "Deserialization"],
  ["CWE-611", "XXE"],
  ["CWE-94", "Code Injection"],
  ["CWE-200", "Info Exposure"],
  ["CWE-601", "Open Redirect"],
  ["CWE-798", "Hard-coded Credentials"],
  ["CWE-862", "Missing Authorization"],
];

const SEVS = /** @type {const} */ (["critical", "high", "medium", "low"]);

function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sha(seed) {
  return [...Array(40)]
    .map((_, i) => ((seed * (i + 3) * 17) % 16).toString(16))
    .join("");
}

async function main() {
  let publicKeyPem;
  if (process.env.ADMIN_PUBLIC_KEY) {
    publicKeyPem = decodePublicKeyEnv(process.env.ADMIN_PUBLIC_KEY);
  } else {
    const k = generateAdminKeyPair();
    publicKeyPem = k.publicKeyPem;
    console.log("NOTE: ephemeral seed key — export for server:");
    console.log("ADMIN_PUBLIC_KEY=" + k.publicKeyEnv);
  }

  console.log(`Connecting ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  const sql = postgres(DATABASE_URL, { max: 4 });

  await sql`SELECT 1`;

  // Ensure schema exists (migrations may not have run on fresh DB)
  const tables = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='projects'
  `;
  if (tables.length === 0) {
    console.error("Schema missing. Start the service once to run migrations, then re-run seed.");
    process.exit(1);
  }

  if (RESET) {
    console.log("RESET: truncating tables…");
    await sql`TRUNCATE findings, scan_jobs, projects CASCADE`;
  }

  let projectCount = 0;
  let findingCount = 0;
  let disclosedCount = 0;

  for (let i = 0; i < PROJECTS.length; i++) {
    const p = PROJECTS[i];
    const rand = mulberry32(p.repoId + 99);
    const fullName = `${p.owner}/${p.name}`;
    const htmlUrl = `https://github.com/${fullName}`;
    const daysAgo = Math.floor(rand() * 25) + 1;
    const createdAt = new Date(Date.now() - daysAgo * 86400000);
    const finishedAt = new Date(createdAt.getTime() + 3600000 * (2 + rand() * 20));
    const commit = sha(p.repoId);

    const rows = await sql`
      INSERT INTO projects (
        github_repo_id, owner_login, name, full_name, html_url,
        description, language, stars, default_branch, created_at, updated_at
      ) VALUES (
        ${p.repoId}, ${p.owner}, ${p.name}, ${fullName}, ${htmlUrl},
        ${p.desc}, ${p.lang}, ${p.stars}, 'main', ${createdAt}, ${finishedAt}
      )
      ON CONFLICT (github_repo_id) DO UPDATE SET
        description = EXCLUDED.description,
        language = EXCLUDED.language,
        stars = EXCLUDED.stars,
        updated_at = now(),
        removed_at = NULL
      RETURNING id::text
    `;
    const projectId = rows[0].id;
    projectCount++;

    // Replace scans/findings for this project for a clean demo snapshot
    await sql`DELETE FROM findings WHERE project_id = ${projectId}::uuid`;
    await sql`DELETE FROM scan_jobs WHERE project_id = ${projectId}::uuid`;

    const jobId = randomUUID();
    const isScanning = i === PROJECTS.length - 1; // last one "live"
    await sql`
      INSERT INTO scan_jobs (id, project_id, state, commit_sha, created_at, started_at, finished_at)
      VALUES (
        ${jobId}::uuid,
        ${projectId}::uuid,
        ${isScanning ? "scanning" : "completed"},
        ${isScanning ? null : commit},
        ${createdAt},
        ${createdAt},
        ${isScanning ? null : finishedAt}
      )
    `;

    if (isScanning) continue;

    const nFindings = 4 + Math.floor(rand() * 10); // 4–13
    for (let f = 0; f < nFindings; f++) {
      const sev = SEVS[Math.floor(rand() * SEVS.length)];
      const [cwe] = CWES[Math.floor(rand() * CWES.length)];
      const key = `${p.name}-${sev}-${f + 1}`;
      const title = `${sev.toUpperCase()}: sample issue #${f + 1} in ${p.name}`;
      const disclose = rand() < 0.08; // ~8% disclosed
      const findingId = randomUUID();
      const primaryFile = `src/${p.name}/module_${f + 1}.ts`;
      const enc = encryptForAdmin(publicKeyPem, findingId, {
        title,
        primary_file: primaryFile,
        detail: { note: "demo detail — owner only", cwe },
      });
      await sql`
        INSERT INTO findings (
          id, project_id, scan_job_id, finding_key, severity, cwe,
          enc_payload, disclosure_state, disclosed_at, disclosed_title,
          item_type, poc_status
        ) VALUES (
          ${findingId}::uuid, ${projectId}::uuid, ${jobId}::uuid, ${key}, ${sev}, ${cwe},
          ${enc},
          ${disclose ? "disclosed" : "owner_only"},
          ${disclose ? finishedAt : null},
          ${disclose ? title : null},
          'finding', 'confirmed'
        )
      `;
      // Point public visibility at this completed job
      await sql`UPDATE projects SET current_scan_job_id = ${jobId}::uuid WHERE id = ${projectId}::uuid`;
      findingCount++;
      if (disclose) disclosedCount++;
    }
  }

  const stats = await sql`
    SELECT
      (SELECT count(*) FROM projects WHERE removed_at IS NULL) AS projects,
      (SELECT count(*) FROM findings) AS findings,
      (SELECT count(*) FROM findings WHERE disclosure_state='disclosed') AS disclosed
  `;

  console.log(
    `Seeded ${projectCount} projects, ${findingCount} findings (${disclosedCount} disclosed this run).`,
  );
  console.log(
    `DB now: ${stats[0].projects} projects, ${stats[0].findings} findings, ${stats[0].disclosed} disclosed.`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
