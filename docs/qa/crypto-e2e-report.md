# 加密管理通道 E2E 验收报告

> 任务：task-168568cd ｜ QA：qa ｜ 2026-08-01  
> 依据：docs/crypto-admin-channel.md + pm No.318  
> 环境：隔离 `openvuln_qa` + `:17860` + mock + **QA 专用 RSA 密钥对**（`/tmp/openvuln-qa-crypto/`，未入库）  
> 证据：`docs/qa/crypto-e2e/`

## 结论

**✅ 通过（Ready）** — 密文入库、公众无 `enc_payload`、service 生产代码无解密、CLI 全流程、验签防御、**重扫同 key 保留披露（C8b）** 均达标。

> OBS-CRYPTO-1 已由 developer 将 mock key 改为稳定串后，qa 于 2026-08-01 补跑 C8b **PASS**（见文末）。

---

## 场景矩阵

| # | 场景 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| C1 | 提交→扫描完成 | completed + NVD counts | critical/high/medium 各 1 | ✅ |
| C2 | DB 密文 | title/path/detail 空；`enc_payload=OVENC1.*`；severity/cwe 明文 | 3 行 OVENC1，title/pf/detail_json 全 NULL | ✅ |
| C2b | 公众 API | 无 enc_payload / OVENC1 / 路径 / 未披露 title | 仅聚合 + 空 disclosed | ✅ |
| C3 | CLI fetch-package | 密文包，需 ADMIN_TOKEN | 3 items 皆 OVENC1；无 token→401 | ✅ |
| C4 | CLI decrypt | 可读报告含 title/path/snippet | report.md/json 明文完整 | ✅ |
| C4b | 错误私钥解密 | 失败 | OAEP decoding error，无输出文件 | ✅ |
| C4c | AAD 绑 finding.id | 错 id 解密失败 | `unable to authenticate data` | ✅ |
| C5 | CLI disclose | 公众 disclosed_findings 出现 CLI 带入 title | high 披露成功；summary 入库 | ✅ |
| C6 | 无签名 | 拒绝 | **401** missing_signature | ✅ |
| C6 | 坏签名 / 错密钥 | 拒绝 | **401** bad_signature | ✅ |
| C6 | 过期/未来 timestamp | 拒绝 | **422** timestamp_out_of_window | ✅ |
| C6 | nonce 重放 | 拒绝 | **409** nonce_replay | ✅ |
| C6 | 跨项目/不存在 finding | 拒绝 | **404** none_matched_project | ✅ |
| C6 | 错 ADMIN_TOKEN | 拒绝 | **401** invalid_admin_token | ✅ |
| C8 | retry 后仍加密且不膨胀 | OVENC1；counts 不变 | ✅ counts 恒 1/1/1/0 | ✅ |
| C8b | 同 key 重扫保留 disclosed | 保留 | 初测 mock key 不稳 ⚠️；补跑 ✅ 见下 | ✅ 补跑 PASS |
| C9 | service 生产代码无解密 | 无 privateDecrypt/decryptForAdmin | src/dist features 无引用（仅 *.test.ts） | ✅ |
| C12 | 再披露 + stats | disclosed_count 同步 | finding_disclosed_count=2 | ✅ |

---

## 证据摘要

### 密文入库（C2）
```
severity | enc_prefix              | title_null | pf_null | dj_null
critical | OVENC1.487bc1eb0c9b5a01 | t          | t       | t
high     | OVENC1.487bc1eb0c9b5a01 | t          | t       | t
medium   | OVENC1.487bc1eb0c9b5a01 | t          | t       | t
```
kid 与 QA keygen 一致（`487bc1eb0c9b5a01`）。

### CLI 解密片段（C4 → report.md）
- `[critical] Remote code execution via deserialization` · `src/serde/handler.ts`
- `[high] SQL Injection in query builder` · `src/db/query.ts`
- `[medium] Reflected XSS in search parameter` · `src/web/search.tsx`

### 披露后公众页（C5）
`disclosed_findings`: title=`SQL Injection in query builder`，**无** path/enc_payload；其余 severity 仍仅计在 counts。

### 验签矩阵（C6）
见 `docs/qa/crypto-e2e/c6-sig-tests.json`。

### 红线（C9）
```
packages/service/src/**/*.ts (!*.test.ts): 无 privateDecrypt|decryptForAdmin|ADMIN_PRIVATE
packages/service/dist/features: 同上
decrypt 仅存在于 packages/shared + packages/admin-cli（+ service 测试文件）
```

---

## OBS-CRYPTO-1 — mock finding_key 不稳定，重扫披露保留无法 E2E

- **现象**：disclose 后 admin retry → mock 新 task id → `mock-sqli-<new>` 替换 `mock-sqli-<old>` → 按 key 的 disclosure 映射 miss → 公众 `disclosed_findings=[]`
- **设计**：`docs/crypto-admin-channel.md` §4「按 finding_key 保留 disclosure_state + disclosed_*」
- **判定**：保留逻辑在 key 稳定时才会命中；当前 mock 使该路径不可测。**非密文/验签缺陷**。
- **建议**：mock 的 finding_key 改为与 task 无关的稳定串（如 `mock-sqli` / `mock-xss` / `mock-crit`），qa 补跑 C8b；或真实 VH 联调时验收。

---

## 未测 / 边界

| 项 | 状态 |
|---|---|
| 真实 VulnHunter 同步加密 | 未测（mock） |
| 私钥 passphrase 保护 | 未测 |
| 密钥轮换 / 多 kid | 未测 |
| disclosed_detail 全文公开字段 | 未行使（默认 NULL） |
| 前端披露列表 UI | 另测 |

---

## 签字

- **加密管理通道（task-168568cd）**：✅ QA 签字通过  
- **OBS-CRYPTO-1** 请 developer 评估是否顺手改 mock key；不改也不阻断本任务  
- 下一步建议：前端联调全站验收 / 真实 VH 冒烟

---

## C8b 补跑（2026-08-01，OBS-CRYPTO-1 关闭）

mock key 已稳定为 `mock-rce` / `mock-sqli` / `mock-xss`。隔离环境重建后：

1. 扫描完成 → keys 为稳定串，OVENC1 密文  
2. CLI disclose `mock-sqli` + `mock-xss` → 公众 disclosed=2  
3. admin fail + retry → completed  
4. **断言全过**：
   - `severity_counts` 前后均为 `{critical:1,high:1,medium:1,low:0}`（不膨胀）
   - DB：`mock-sqli:disclosed`、`mock-xss:disclosed`、`mock-rce:owner_only`，`disclosed_title` 保留
   - 公众 `disclosed_findings` 仍 2 条（title 正确）
   - `enc_payload` 仍为 OVENC1；公众 JSON 无密文/路径

证据：`docs/qa/crypto-e2e/c8b-before.json`、`c8b-after-retry.json`

**OBS-CRYPTO-1：✅ 关闭**
