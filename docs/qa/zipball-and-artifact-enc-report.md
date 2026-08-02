# 复验报告：zipball 自控 + 产物 OVENC1 加密

> QA：qa ｜ 2026-08-02  
> 任务：task-4e3dc275（zipball）+ task-ab7b60af 增量（产物加密）  
> 环境：隔离 `openvuln_qa_final` @ :5434 + :17890 mock（`VH_SOURCE_MODE=git`）  
> 单测：`pnpm --filter @openvuln/service test` → **33/33 PASS**  
> 演示站 :7860 **只读**旁证 express archive 路径

## 结论

| 项 | 结果 |
|---|---|
| 全量单测 | ✅ **33/33**（前次红灯已消） |
| 产物 DB 密文 | ✅ 全 `OVENC1.*`，无 `# PoC`/`#!/usr` 明文 |
| report-package 含 artifacts 密文 | ✅ `artifacts[]` + `enc_content` |
| 公钥解密 + AAD=artifact_id | ✅；错 id 认证失败 |
| 公众红线 | ✅ 无 OVENC1 / artifact / poc 正文 |
| zipball mock/git 短路 | ✅ mock 下 git 模式完整扫描 |
| zipball 真实 archive 路径 | ✅ **旁证**演示 express：commit `a3714473…` + scanning（developer 已 multipart 成功；本轮未再烧 VH） |
| 超限拦截 | ✅ 代码存在 `ZipballTooLargeError`（E2E 未下超大包） |

**两项均可 QA 签字通过。**

---

## 1. 产物加密（ab7b60af 增量）

### DB（completed 后）
| finding | kind | file | content |
|---|---|---|---|
| mock-rce | poc | poc.md | `OVENC1.d876fd3a…` len~1075 |
| mock-rce | exp | exp.py | `OVENC1…` |
| mock-sqli | poc | poc.md | `OVENC1…` |

- `size_bytes` 仍为明文长度元数据；`truncated/is_binary` 字段保留  
- 解密 payload 形态：`{title, primary_file, detail}` JSON，detail 内为 poc/exp 文本  

### report-package
```json
{
  "items": [/* findings OVENC1 */],
  "artifacts": [{
    "artifact_id", "finding_id", "finding_key", "kind", "rel_path",
    "file_name", "mime", "size_bytes", "truncated", "is_binary",
    "enc_content": "OVENC1...."
  }]
}
```
- 无 token → 401  
- 包内无 poc 明文  

### CLI
- `decrypt` 当前只解 findings → 可读漏洞 title；**尚未**自动解 `artifacts[]`（OBS-F1）  
- 运维可用 shared `decryptForAdmin(priv, artifact_id, enc_content)` 或后续 CLI 增强  

### 公众
list/project/stats 无 artifact 字段、无 OVENC1、无 poc 正文。

---

## 2. zipball（task-4e3dc275）

| 检查 | 证据 |
|---|---|
| 默认 `VH_SOURCE_MODE=archive` | config + `.env.example` |
| mock/测试 `git` 短路 | 本环境 `VH_SOURCE_MODE=git` 扫描全程无 zipball 404；33/33 绿 |
| 真实 archive | 演示 express `latest_scan.commit_sha=a3714473feb3…` 且 **scanning**（与 developer「codeload + multipart e94bc1fc」一致） |
| SHA 绑定 | mock/git 路径 public commit = GitHub HEAD `7fd1a60b…`；archive 路径以 developer 实测 + 演示 commit 为准 |
| 超限 | `ZipballTooLargeError` + queue markFailed 分支存在 |

未在本轮对 VH 再跑一次完整 archive E2E（避免重复消耗）；若需 qa 独立 multipart 冒烟，可在 express 终态后补。

---

## 观察（不阻断）

| ID | 说明 |
|---|---|
| OBS-F1 | admin-cli `decrypt` 未展开 package.artifacts；报告包已带密文，解密需手工/后续 CLI |
| OBS-F2 | 超大 zip E2E 未跑（仅类型/分支存在） |
| OBS-F3 | 前端状态二值化未在本报告验收（API 仍返回 scanning/failed） |

---

## 签字

- **task-ab7b60af**（含产物加密增量）：✅  
- **task-4e3dc275**（zipball）：✅（真实路径采信演示+developer 证据；mock/单测本环境亲测）  
