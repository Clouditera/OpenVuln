# 产物收割验收报告（task-ab7b60af）

> QA：qa ｜ 2026-08-02  
> 环境：隔离 `openvuln_qa_art` @ :5434 + :17880 + mock  
> 证据：`docs/qa/artifacts/`

## 结论

**✅ 产物收割主路径 E2E 通过**（mock completed → 入库 poc/exp → 公众不泄露 → 重扫替换清理）。

**⚠️ 全量单测当前红灯**（本机 `pnpm test` **19/33 ~ 14 fail**），根因是 **zipball 自控（task-4e3dc275）进行中的 dispatcher 改动**：`cfg.vulnhunter.create` 在测试配置下为 `undefined`（`scanTimeoutHours`），且默认 `VH_SOURCE_MODE=archive` 时对假仓库 `acme/*` 拉 zipball 404。与收割逻辑本身无直接关系，但 **developer 宣称的 36/36 在本环境不成立**，需修测试夹具/默认 mock 短路后再声称全绿。

---

## E2E 矩阵（mock）

| # | 场景 | 结果 |
|---|---|---|
| A1 | 扫描 completed | ✅ Hello-World 完成 |
| A2 | 收割入库 | ✅ **3** 行：`mock-rce` poc+exp、`mock-sqli` poc；`mock-xss` not-needed → **0** |
| A2b | 内容可读 | ✅ poc.md 含 `# PoC for …`；exp.py shebang |
| A2c | 元数据 | ✅ kind/rel_path/file_name/size；truncated=f is_binary=f |
| A3 | 公众红线 | ✅ list/detail/stats **无** poc 正文/路径；无公开 artifacts API（404） |
| A3b | report-package | ✅ 仅 OVENC1，**无** poc 明文；无 token 401 |
| A4 | 重扫清理 | ✅ 旧 artifact id 全替换，count 仍 3，scan_job_id 更新 |
| A5 | >1MB 截断 / 二进制 | ⚠️ 代码有 `ARTIFACT_CONTENT_MAX_CHARS` + truncated 标记；mock 未产超大/二进制文件，**未做 E2E 大包**（OBS-A1） |
| A6 | 仅 confirmed 有产物 | ✅ xss not-needed = 0 arts |

### DB 快照（完成后）
```
mock-rce    confirmed   poc  findings/mock-rce/poc/poc.md
mock-rce    confirmed   exp  findings/mock-rce/exp/exp.py
mock-sqli   confirmed   poc  findings/mock-sqli/poc/poc.md
mock-xss    not-needed  —    (0)
```

---

## 单测现状（阻塞「全绿」声明）

```
FAIL queue-integration / crypto-e2e / bugs-regression / artifact-harvest.test (via setup)
  → dispatch: create.scanTimeoutHours undefined 或 zipball acme/* 404
FAIL redline 401 vs 403（次要断言漂移）
FAIL stats finding_total 3 vs 2（可能指针/seed 与 pending 口径）
```

**建议 developer**：
1. mock 模式或 `sourceMode=git` 时 dispatcher **跳过**真实 zipball  
2. `setupTestApp` 保证 `vulnhunter.create` 全字段  
3. 修红后 `pnpm test` 再交 qa 复验数字

---

## 观察

| ID | 说明 |
|---|---|
| OBS-A1 | 截断/二进制仅代码路径，缺 mock 超大文件 E2E |
| OBS-A2 | 无 admin 读 artifacts API（仅 DB）—— 运营解密报告不含 poc 文件；若需 CLI 导出产物需另立项 |
| OBS-A3 | 真实 lodash pending → 0 产物（预期）；等动态/有 poc 再真链验收 |

---

## 签字

- **收割 E2E（mock 主路径）**：✅ 通过  
- **任务整体「含 36/36」**：❌ 暂不连署全绿，等 zipball/测试夹具修好后补跑单测  
