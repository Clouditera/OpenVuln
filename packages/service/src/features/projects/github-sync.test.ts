import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDefaultBranchHeadSha } from "./github.js";
import { parseGitHubUrl } from "./github-sync.js";

describe("parseGitHubUrl", () => {
  it("parses https URL", () => {
    expect(parseGitHubUrl("https://github.com/foo/bar")).toEqual({ owner: "foo", repo: "bar" });
  });

  it("strips .git and trailing slash", () => {
    expect(parseGitHubUrl("https://github.com/foo/bar.git/")).toEqual({ owner: "foo", repo: "bar" });
  });

  it("parses ssh form", () => {
    expect(parseGitHubUrl("git@github.com:acme/widget.git")).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });

  it("parses bare owner/repo", () => {
    expect(parseGitHubUrl("vercel/next.js")).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("rejects empty / garbage", () => {
    expect(parseGitHubUrl("")).toBeNull();
    expect(parseGitHubUrl("not a url")).toBeNull();
    expect(parseGitHubUrl("https://gitlab.com/foo/bar")).toBeNull();
  });
});

describe("fetchDefaultBranchHeadSha", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for missing ref (422 JSON error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "No commit found for SHA: no-such-ref-xyz" }), {
            status: 422,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      fetchDefaultBranchHeadSha("octocat", "Hello-World", "no-such-ref-xyz"),
    ).resolves.toBeNull();
  });

  it("returns full sha on plain-text success", async () => {
    const sha = "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(sha, {
            status: 200,
            headers: { "content-type": "application/vnd.github.v3.sha" },
          }),
      ),
    );
    await expect(fetchDefaultBranchHeadSha("octocat", "Hello-World", "master")).resolves.toBe(sha);
  });

  it("rejects non-sha JSON body even if 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "weird" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(fetchDefaultBranchHeadSha("octocat", "Hello-World", "x")).resolves.toBeNull();
  });
});
