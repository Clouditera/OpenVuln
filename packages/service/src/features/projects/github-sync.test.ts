import { describe, expect, it } from "vitest";
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
