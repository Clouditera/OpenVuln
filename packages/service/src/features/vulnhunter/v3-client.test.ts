import { describe, expect, it, vi } from "vitest";
import { parseReportYaml, renderReportYamlToMarkdown } from "../report/yaml-render.js";
import { VhTaskGoneError } from "./client.js";
import { V3VulnHunterClient, recordJsonToReportYaml } from "./v3-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("V3VulnHunterClient", () => {
  it("healthCheck calls /api/healthz with Bearer header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    const client = new V3VulnHunterClient({
      baseUrl: "http://vh3.local:58921/",
      apiToken: "vht_secret_123",
      fetchImpl: fetchMock,
    });

    expect(await client.healthCheck()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://vh3.local:58921/api/healthz");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer vht_secret_123");
  });

  it("createScanTask creates a git project and code-audit task, clamping vuln_focus to 500 chars", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ project: { id: "proj_01" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ task: { id: "task_01" } }, 201));

    const client = new V3VulnHunterClient({
      baseUrl: "http://vh3.local",
      apiToken: "vht_abc",
      model: { providerId: "prov_1", modelId: "claude-sonnet" },
      fetchImpl: fetchMock,
    });

    const longFocus = "A".repeat(800);
    const res = await client.createScanTask({
      gitUrl: "https://github.com/org/repo",
      displayName: "org/repo",
      enableDynamicVerify: true,
      outputLanguage: "zh-CN",
      vulnFocus: longFocus,
    });

    expect(res).toEqual({ taskId: "task_01" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [pUrl, pInit] = fetchMock.mock.calls[0];
    expect(pUrl).toBe("http://vh3.local/api/projects");
    expect(JSON.parse(String(pInit?.body))).toEqual({
      kind: "git",
      url: "https://github.com/org/repo",
      name: "org/repo",
    });

    const [tUrl, tInit] = fetchMock.mock.calls[1];
    expect(tUrl).toBe("http://vh3.local/api/tasks");
    const taskBody = JSON.parse(String(tInit?.body));
    expect(taskBody).toEqual({
      type: "code-audit",
      name: "org/repo",
      params: {
        mode: "dynamic",
        output_lang: "zh-CN",
        skills: [],
        mcps: [],
        vuln_focus: "A".repeat(500),
      },
      source: { project: "proj_01" },
      model: { providerId: "prov_1", modelId: "claude-sonnet" },
    });
  });

  it("createScanTaskFromArchive uploads spec before archive and cleans up project if task creation fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ project: { id: "proj_zip" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ code: "invalid", detail: "quota exceeded" }, 400))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    const client = new V3VulnHunterClient({
      baseUrl: "http://vh3.local",
      apiToken: "vht_abc",
      fetchImpl: fetchMock,
    });

    await expect(
      client.createScanTaskFromArchive({
        displayName: "org/archive",
        archive: Buffer.from("PK\x05\x06" + "\0".repeat(18)),
        filename: "repo.zip",
        enableDynamicVerify: false,
        enableDynamicExploit: false,
      }),
    ).rejects.toThrow(/VH3 createTask failed: 400/);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [upUrl, upInit] = fetchMock.mock.calls[0];
    expect(upUrl).toBe("http://vh3.local/api/projects/upload");
    const form = upInit?.body as FormData;
    const keys = [...form.keys()];
    expect(keys).toEqual(["spec", "archive"]);
    expect(JSON.parse(String(form.get("spec")))).toEqual({ kind: "archive", name: "org/archive" });

    const [delUrl, delInit] = fetchMock.mock.calls[2];
    expect(delUrl).toBe("http://vh3.local/api/projects/proj_zip");
    expect(delInit?.method).toBe("DELETE");
  });

  it("getTask maps all 3.0 statuses and distinguishes RFC-7807 not_found from bare 404", async () => {
    const cases: Array<[string, string]> = [
      ["starting", "preparing"],
      ["running", "running"],
      ["paused", "paused"],
      ["succeeded", "completed"],
      ["failed", "failed"],
      ["interrupted", "failed"],
      ["stopped", "cancelled"],
    ];

    for (const [v3Status, expected] of cases) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          task: {
            id: "t1",
            status: v3Status,
            error: v3Status === "failed" ? { code: "run_error", message: "boom" } : null,
          },
        }),
      );
      const client = new V3VulnHunterClient({
        baseUrl: "http://vh3.local",
        apiToken: "vht_abc",
        fetchImpl: fetchMock,
      });
      const out = await client.getTask("t1");
      expect(out.state).toBe(expected);
      if (v3Status === "failed") expect(out.failureReason).toBe("boom");
    }

    const goneMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: "not_found", status: 404, detail: "任务不存在" }, 404))
      .mockResolvedValueOnce(new Response("<html>404 Not Found</html>", { status: 404 }));
    const client = new V3VulnHunterClient({
      baseUrl: "http://vh3.local",
      apiToken: "vht_abc",
      fetchImpl: goneMock,
    });
    await expect(client.getTask("missing")).rejects.toBeInstanceOf(VhTaskGoneError);
    await expect(client.getTask("nginx404")).rejects.toThrow(/VH3 getTask failed: 404/);
  });

  it("listFindings, getFindingDetail, listFindingArtifacts, and report.yaml fallback bridge work end-to-end", async () => {
    const record = {
      id: "BUG-001",
      title: "Command Injection in Runner",
      summary: "Unsanitized user input passed to shell.",
      cwe: "CWE-78",
      vuln_type: "command_injection",
      cvss_score: 9.8,
      cvss_vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      poc_status: "reproduced",
      remediation: "Use execFile with argument arrays.",
      dataflow: [{ step: 1, location: "src/run.ts:42-45", description: "exec(cmd)" }],
    };

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/tasks/t1/results")) {
        return jsonResponse({
          results: [
            {
              kind: "finding",
              key: "BUG-001",
              title: record.title,
              severity: "critical",
              summary: record.summary,
              path: "findings/BUG-001/record.json",
              data: {
                cwe: "CWE-78",
                cvss_score: 9.8,
                poc_status: "reproduced",
                locations: ["src/run.ts:42-45"],
              },
            },
            { kind: "other", key: "NOTE-1", title: "Ignored" },
          ],
        });
      }
      if (url.includes("/file?p=output%2Ffindings%2FBUG-001%2Frecord.json")) {
        const content = JSON.stringify(record);
        return jsonResponse({ path: "output/findings/BUG-001/record.json", content, size: content.length });
      }
      if (url.includes("/file?p=output%2Ffindings%2FBUG-001%2Freport.yaml")) {
        return jsonResponse({ code: "not_found", status: 404 }, 404);
      }
      if (url.endsWith("/api/tasks/t1/tree")) {
        return jsonResponse({
          entries: [
            { path: "output/findings/BUG-001/poc/poc.py", type: "file", size: 128 },
            { path: "output/findings/BUG-001/exp/proof.png", type: "file", size: 2048 },
            { path: "output/findings/BUG-001/report.md", type: "file", size: 500 },
          ],
        });
      }
      if (url.includes("/file?p=output%2Ffindings%2FBUG-001%2Fpoc%2Fpoc.py")) {
        return jsonResponse({ path: "output/findings/BUG-001/poc/poc.py", content: "print('pwn')\n", size: 13 });
      }
      return jsonResponse({ code: "not_found" }, 404);
    });

    const client = new V3VulnHunterClient({
      baseUrl: "http://vh3.local",
      apiToken: "vht_abc",
      fetchImpl: fetchMock,
    });

    const findings = await client.listFindings("t1");
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe("BUG-001");
    expect(findings[0].primary_file).toBe("src/run.ts");
    expect(findings[0].cvss_score).toBe(9.8);

    const detail = (await client.getFindingDetail("t1", "BUG-001")) as Record<string, unknown>;
    expect(detail.primary_file).toBe("src/run.ts");
    expect(detail.cwe).toBe("CWE-78");

    const groups = await client.listFindingArtifacts("t1", "BUG-001");
    expect(groups.poc.files).toEqual([
      { path: "poc/poc.py", size: 128, kind: "text", previewable: true },
    ]);
    expect(groups.exp.files).toEqual([
      { path: "exp/proof.png", size: 2048, kind: "image", previewable: false },
    ]);

    const pocPreview = await client.getArtifactFilePreview("t1", "findings/BUG-001/poc/poc.py");
    expect(pocPreview?.kind).toBe("text");
    expect(pocPreview?.content).toBe("print('pwn')\n");

    const yamlPreview = await client.getArtifactFilePreview("t1", "findings/BUG-001/report.yaml");
    expect(yamlPreview?.kind).toBe("text");
    const parsed = parseReportYaml(yamlPreview?.content ?? "");
    expect(parsed?.metadata.title).toBe("Command Injection in Runner");
    expect(parsed?.metadata.cwe).toBe("CWE-78");
    expect(parsed?.description.remediation).toBe("Use execFile with argument arrays.");
    const md = renderReportYamlToMarkdown(yamlPreview?.content ?? "", {
      findingKey: "BUG-001",
      projectFullName: "org/repo",
    });
    expect(md).toContain("# Command Injection in Runner");
    expect(md).toContain("src/run.ts:42-45");
  });

  it("deleteTask stops active task, deletes task, and cleans up linked project", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      const url = String(input);
      if (init?.method === "GET" && url.endsWith("/api/tasks/t9")) {
        return jsonResponse({ task: { id: "t9", status: "running", source: { project: "proj_9" } } });
      }
      return jsonResponse({ ok: true });
    });

    const client = new V3VulnHunterClient({
      baseUrl: "http://vh3.local",
      apiToken: "vht_abc",
      fetchImpl: fetchMock,
    });
    await client.deleteTask("t9");

    expect(calls).toEqual([
      "GET http://vh3.local/api/tasks/t9",
      "POST http://vh3.local/api/tasks/t9/stop",
      "DELETE http://vh3.local/api/tasks/t9",
      "DELETE http://vh3.local/api/projects/proj_9",
    ]);
  });

  it("recordJsonToReportYaml handles minimal records cleanly", () => {
    const out = recordJsonToReportYaml({ title: "Minimal" }, "BUG-002");
    const parsed = parseReportYaml(out);
    expect(parsed?.metadata.title).toBe("Minimal");
  });
});
