import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { filterArchiveEntries, unsafeEntryPath } from "./archive-filter.js";

const SYMLINK_MODE = 0o120777; // lrwxrwxrwx
const FILE_MODE = 0o100644; // -rw-r--r--

async function buildZip(
  entries: Array<{ name: string; content: string; mode?: number; dir?: boolean }>,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const e of entries) {
    if (e.dir) zip.folder(e.name);
    else zip.file(e.name, e.content, { unixPermissions: e.mode ?? FILE_MODE });
  }
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX" });
}

async function listEntries(buf: Buffer): Promise<Record<string, string>> {
  const z = await JSZip.loadAsync(buf);
  const out: Record<string, string> = {};
  for (const name of Object.keys(z.files)) {
    const f = z.files[name];
    if (!f.dir) out[name] = await f.async("string");
  }
  return out;
}

describe("filterArchiveEntries (task-08627338)", () => {
  it("drops dangling symlinks, keeps everything else byte-identical", async () => {
    const buf = await buildZip([
      { name: "repo-sha/src/main.ts", content: "console.log('hi');" },
      { name: "repo-sha/README.md", content: "# readme" },
      // dangling: target does not exist anywhere in the archive
      { name: "repo-sha/src/config/config", content: "../build/config", mode: SYMLINK_MODE },
    ]);
    const r = await filterArchiveEntries(buf);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain("src/config/config");
    expect(r.skipped[0]).toContain("dangling");
    const entries = await listEntries(r.buffer);
    expect(entries["repo-sha/src/main.ts"]).toBe("console.log('hi');");
    expect(entries["repo-sha/README.md"]).toBe("# readme");
    expect(entries["repo-sha/src/config/config"]).toBeUndefined();
  });

  it("drops symlinks with absolute / escaping targets (VH unsafe-path class)", async () => {
    const buf = await buildZip([
      { name: "repo-sha/.trunk/actions", content: "/usr/lib/trunk/actions", mode: SYMLINK_MODE },
      { name: "repo-sha/.corepack/bin/pnpm", content: "../../../../usr/local/bin/pnpm", mode: SYMLINK_MODE },
      { name: "repo-sha/treefmt", content: "/opt/homebrew/bin/treefmt", mode: SYMLINK_MODE },
      { name: "repo-sha/ok.ts", content: "ok" },
    ]);
    const r = await filterArchiveEntries(buf);
    expect(r.skipped.length).toBe(3);
    const entries = await listEntries(r.buffer);
    expect(Object.keys(entries)).toEqual(["repo-sha/ok.ts"]);
  });

  it("keeps resolvable symlinks (target exists inside the archive)", async () => {
    const buf = await buildZip([
      { name: "repo-sha/real/target.txt", content: "data" },
      { name: "repo-sha/link", content: "real/target.txt", mode: SYMLINK_MODE },
    ]);
    const r = await filterArchiveEntries(buf);
    expect(r.skipped).toHaveLength(0);
    const entries = await listEntries(r.buffer);
    expect(entries["repo-sha/link"]).toBe("real/target.txt");
  });

  it("skips entries whose own path has traversal components", async () => {
    // JSZip sanitizes '..' on write, so exercise the guard directly + via one zip case
    expect(unsafeEntryPath("repo-sha/evil/../../../etc/passwd")).toBe(true);
    expect(unsafeEntryPath("/etc/passwd")).toBe(true);
    expect(unsafeEntryPath("C:\\Windows\\system32")).toBe(true);
    expect(unsafeEntryPath("repo-sha/normal/file.ts")).toBe(false);
    const buf = await buildZip([
      { name: "repo-sha/normal.txt", content: "fine" },
    ]);
    const r = await filterArchiveEntries(buf);
    expect(r.skipped).toHaveLength(0);
  });

  it("clean archive passes through with zero skips (byte-equal content)", async () => {
    const files = [
      { name: "repo-sha/a.ts", content: "export const a = 1;" },
      { name: "repo-sha/nested/deep/b.py", content: "print('b')\n" },
      { name: "repo-sha/docs/guide.md", content: "# guide\n".repeat(50) },
    ];
    const buf = await buildZip(files);
    const r = await filterArchiveEntries(buf);
    expect(r.skipped).toHaveLength(0);
    const entries = await listEntries(r.buffer);
    for (const f of files) expect(entries[f.name]).toBe(f.content);
  });

  it("bitfinite-core shape: src/config/config dangling link filtered, rest intact", async () => {
    // real-world case: src/config/config -> build/config (build/ never committed)
    const buf = await buildZip([
      { name: "bitfinite-core-6e44f377/src/main.go", content: "package main" },
      { name: "bitfinite-core-6e44f377/src/config/config", content: "build/config", mode: SYMLINK_MODE },
      { name: "bitfinite-core-6e44f377/go.mod", content: "module bitfinite" },
    ]);
    const r = await filterArchiveEntries(buf);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain("bitfinite-core-6e44f377/src/config/config");
    const entries = await listEntries(r.buffer);
    expect(entries["bitfinite-core-6e44f377/src/main.go"]).toBe("package main");
    expect(entries["bitfinite-core-6e44f377/go.mod"]).toBe("module bitfinite");
  });
});
