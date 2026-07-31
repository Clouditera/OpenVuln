# OpenVuln 原型后端 E2E 验收报告

> 任务：task-84cd0081 ｜ QA：qa ｜ 2026-07-30  
> 环境：隔离 QA 实例 `PORT=17860` + DB `openvuln_qa`（compose Postgres :5433）  
> 配置：`VULNHUNTER_MOCK=true`，无 GitHub OAuth credentials  
> 依据：PRD v1.0 FR-1~FR-6 + 架构 API 契约 + 红线

## 结论

**✅ 后端原型验收通过（Ready for frontend integration）** — 2026-07-30 初次验收不通过；同日 developer 修复 BUG-1/2/3 后回归 **三项全 PASS**，红线仍成立。

> 初次结论为 Not Ready（见下文缺陷清单）；以本节回归为准。

| 维度 | 初次 | 回归后 |
|---|---|---|
| 红线（匿名不可达单条 finding 敏感字段） | ✅ PASS | ✅ PASS |
| FR-1 项目提交 | ⚠️ 并发 500 (BUG-2) | ✅ PASS |
| FR-2 扫描队列（mock） | ⚠️ retry 重复 (BUG-1) | ✅ PASS |
| FR-3 公众列表/统计 | ⚠️ retry 计数失真 | ✅ PASS |
| FR-4 Owner 详情隔离 | ✅ PASS（种子 session） | ✅ 未再全量，grant 层仍用 |
| FR-5 主动披露 | ⚠️ 非法 uuid 500 (BUG-3) | ✅ PASS |
| FR-6 Admin | ✅ PASS | ✅ retry 路径回归 PASS |
| 真实 GitHub OAuth 端到端 | ⛔ BLOCKED | ⛔ 仍无凭证 |
| 真实 VulnHunter 对接 | ⛔ MOCK | ⛔ MOCK |

---

## 环境与方法

```
docker compose -f deploy/docker-compose.yml up -d postgres
# 独立库 openvuln_qa + PORT=17860 + VULNHUNTER_MOCK=true
# 证据目录: /tmp/openvuln-qa/evidence/ （关键样本同步 docs/qa/）
```

Owner / 非 owner / admin 会话：因无 OAuth 凭证，在 QA 库种子 `github_identities` + `repo_access_grants` + `sessions`（cookie `ov_session`，hash = sha256(secret:token)），模拟登录态。**不替代真实 OAuth 联调。**

---

## 场景结果明细

### FR-1 项目提交

| # | 场景 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| 1 | 空 body / 空字符串 | 422 | `ERR_VALIDATION` field=git_url | ✅ |
| 2 | 非法 URL `not-a-url` | 422 | invalid_github_url | ✅ |
| 3 | 非 GitHub（GitLab） | 422 | invalid_github_url | ✅ |
| 4 | 不存在仓库 | 4xx 明确原因 | 404 `github_repo` | ✅ |
| 5 | 合法 `https://github.com/octocat/Hello-World` | 201 + queued | 201，state=queued，5s 内列表可见 | ✅ |
| 6 | trailing slash / `.git` 后缀 | 归一化成功 | Spoon-Knife/、git-consortium.git → 201 | ✅ |
| 7 | 重复提交（冷却期） | 409 | 409 cooldown retry_after_days=7 | ✅ |
| 8 | short form `owner/repo` | 可接受 | `octocat/linguist` → 解析为 `github-linguist/linguist`（GitHub 重定向）201 | ✅ 观察 |
| 9 | fork 提交 | 归并上游 | fork of Hello-World → 409 cooldown 指向父项目 | ✅ |
| 10 | 并发双提交同 repo | 一成一 409 | 一成一 **500** unique_violation | ❌ BUG-2 |

### FR-2 扫描队列（mock）

| # | 场景 | 结果 |
|---|---|---|
| 1 | queued → scanning → completed | ✅ ~30s 内完成（dispatcher 10s + mock + poller 30s） |
| 2 | commit_sha 回填 | ✅ 默认分支 HEAD |
| 3 | 失败态公众不泄露 internal | ✅ 注入 `fail_reason_internal` 后公众 JSON 无 secret；admin queue 可见 |
| 4 | admin retry failed → queued→completed | ⚠️ 状态机 OK，但 **findings 重复累加** → BUG-1 |

### FR-3 公众视图 / 红线

| # | 场景 | 结果 |
|---|---|---|
| 1 | 列表卡片：severity_counts high/medium/low/info，无 critical | ✅ |
| 2 | 项目页：scan 元数据 + severity + CWE，`disclosed_findings` 默认空 | ✅ |
| 3 | 匿名 `GET /api/projects/:id/findings` | ✅ 401 |
| 4 | 匿名 disclose / detail | ✅ 401 |
| 5 | 匿名 `/api/findings` 等旁路 | ✅ 404 |
| 6 | query 篡改 `?include=findings` | ✅ 忽略，仍仅聚合 |
| 7 | 公众 JSON 无 title/path/code（未披露时） | ✅ |
| 8 | 列表/overview 无 finding 敏感字段 | ✅ |
| 9 | severity 枚举 | ✅ 仅 high\|medium\|low\|info |

### FR-4 Owner 认证与详情

| # | 场景 | 结果 |
|---|---|---|
| 1 | `/api/me` 匿名 | ✅ authenticated=false |
| 2 | owner session + grant → findings 列表/详情 | ✅ 200，含 title/primary_file/detail |
| 3 | 已登录无 grant → findings | ✅ 403 `no_repo_grant` |
| 4 | 他项目 grant 不可跨项目读 | ✅ owner 读 Spoon-Knife detail → 403；nonowner 读自己 grant 的 SK → 200 |
| 5 | logout 后 session 失效 | ✅ me 匿名；findings 401 |
| 6 | OAuth login 无配置 | ⚠️ 500 `github_oauth_not_configured`（应为明确 503；真实回调未测） |
| 7 | OAuth callback 缺参/假 state | ✅ 422 |
| 8 | admin 无 grant 读 findings | ⚠️ **200**（admin 绕过 grant）— 观察项，PRD 未明确，见 OBS-1 |

### FR-5 披露

| # | 场景 | 结果 |
|---|---|---|
| 1 | 非 owner disclose | ✅ 403 |
| 2 | owner 披露 1 条 high | ✅ disclosed_count=1 |
| 3 | 公众 `disclosed_findings` 出现 title/cwe，**无** primary_file/code | ✅ |
| 4 | 未披露 medium 标题不出现在公众 | ✅ |
| 5 | severity_counts 仍含全部（含未披露） | ✅ |
| 6 | 重复披露同 id | ✅ disclosed_count=0 幂等 |
| 7 | 跨项目 finding_id | ✅ 不计入（0） |
| 8 | 空数组 | ✅ 422 |
| 9 | 非法 uuid | ❌ **500** Postgres uuid 语法错 → BUG-3 |
| 10 | 已披露 finding 的 detail API 仍需 grant | ✅ 匿名 401 |

### FR-6 Admin

| # | 场景 | 结果 |
|---|---|---|
| 1 | 非 admin 访问 queue | ✅ 403 admin_only |
| 2 | 匿名 admin | ✅ 401 |
| 3 | admin queue 见 failed + internal reason | ✅ |
| 4 | retry → attempt++ state=queued → completed | ✅（副作用 BUG-1） |
| 5 | DELETE 下架项目 | ✅ 公众 404，列表消失 |

### 其他

| # | 场景 | 结果 |
|---|---|---|
| 1 | sort=stars / newest | ✅ |
| 2 | page_size=1 分页 | ✅ total 正确 |
| 3 | 未知项目 404 | ✅ |

---

## 缺陷清单

### BUG-1 — Admin retry 后 findings 重复，公众统计膨胀
- **Severity**: **major**
- **FR**: FR-2 / FR-3
- **Steps**:
  1. 提交项目，等 mock 扫描 completed（Hello-World → high:1 medium:1）
  2. 将 scan_job 置 failed（或真实失败）
  3. `POST /api/admin/scan-jobs/:id/retry`
  4. 等待再次 completed
  5. `GET /api/projects/octocat/Hello-World`
- **Expected**: 统计反映**当前一次**扫描结果（或按 finding_key 去重/替换旧结果）；披露状态不因幽灵副本错乱
- **Actual**: 同一 `scan_job_id` 下插入新 key 的 findings，旧行保留 → `severity_counts` 变为 high:2 medium:2；已 disclose 的旧 finding 仍在，新副本为 owner_only
- **Evidence**: DB 4 行 findings（mock-sqli-e7115f8b disclosed + mock-sqli-06708d3d owner_only 等）；`docs/qa/t15c-after-retry.json`
- **Impact**: 公众看板数字不可信；retry 是 FR-6 正式能力，原型也会用

### BUG-2 — 并发重复提交返回 500 而非 409
- **Severity**: **major**
- **FR**: FR-1
- **Steps**: 并行两次 `POST /api/projects` 同一 git_url（`octocat/octocat.github.io`）
- **Expected**: 一方 201，另一方 409 CONFLICT（cooldown/duplicate）
- **Actual**: 一方 201，另一方 **500** `ERR_INTERNAL`；日志 `duplicate key value violates unique constraint "projects_github_repo_id_key"`
- **Evidence**: `docs/qa/t23-a.json` / `t23-b.json`；service log PostgresError 23505

### BUG-3 — disclose 非法 UUID 返回 500
- **Severity**: **minor**
- **FR**: FR-5
- **Steps**: owner `POST .../disclose` `{"finding_ids":["not-a-uuid"]}`
- **Expected**: 422 `ERR_VALIDATION`
- **Actual**: 500；日志 `invalid input syntax for type uuid`
- **Evidence**: `docs/qa/t13-disclose-badid.json`

---

## 观察项（不阻断，建议修）

| ID | 说明 |
|---|---|
| OBS-1 | **Admin 无 grant 可直接读 findings 详情**（200）。PRD FR-4 写「非 owner → 403」，FR-6 未授予详情权。若为运维需要请写入 PRD；否则应收紧为 403。 |
| OBS-2 | Finding `detail` 字段为 **JSON 字符串**而非对象，前端需二次 parse。建议直接返回 object。 |
| OBS-3 | `GET /api/auth/github/login` 在未配置 OAuth 时 500；建议 503 + 明确文案。 |
| OBS-4 | Admin `queue` 在全部 completed 时返回空列表（只含非终态/failed？）。若需审计历史，文档应说明过滤规则。 |
| OBS-5 | 真实私有仓库 vs 不存在：无 token 时 GitHub 均 404，无法区分；可接受。 |
| OBS-6 | 真实 GitHub OAuth（admin/maintain 阈值、org 限制、fork 验证路径）**本次未做 E2E**，需补凭证后回归。 |
| OBS-7 | 真实 VulnHunter cookie/token 客户端**未测**（仅 mock）。 |

---

## 红线专项摘要（重点）

匿名/无 grant 路径尝试获取单条 finding：

| 请求 | HTTP | Body |
|---|---|---|
| `GET /api/projects/{id}/findings` | 401 | ERR_UNAUTHORIZED |
| `GET /api/projects/{id}/findings/{key}` | 401 | ERR_UNAUTHORIZED |
| `POST /api/projects/{id}/disclose` | 401 | ERR_UNAUTHORIZED |
| `GET /api/findings` | 404 | — |
| 公众项目视图（有 2 条 owner_only） | 200 | 仅 counts/CWE，`disclosed_findings=[]`，无 path/title |
| 披露 1 条后公众视图 | 200 | 仅该条 summary（title/cwe/severity），无 primary_file/code |
| 已登录非 owner | 403 | no_repo_grant |
| logout 后原 cookie | 401 | — |

**红线结论：结构性隔离成立（在当前 API 面）。**

---

## 签字条件

修复并回归前 **不签字放行**：

1. **必须**：BUG-1（retry findings 策略：替换本 job 旧 findings / 按稳定 key upsert / 新 job 并只聚合 latest completed）
2. **必须**：BUG-2（捕获 unique_violation → 409）
3. **建议同批**：BUG-3（uuid 校验）
4. **后续**：配置 GitHub OAuth 后补 FR-4 真链；有 VH 实例后关 mock 做集成冒烟

修复后 @qa 回归：retry 计数、并发提交、disclose 校验 三项即可。

---

## 回归（2026-07-30，task-80fbc655）

隔离环境重建：`openvuln_qa` 空库 + 服务重启 `:17860`。证据：`docs/qa/regression/`。

| Bug | 结果 | 证据 |
|---|---|---|
| **BUG-1** retry findings 重复 | ✅ PASS — retry 前后 severity_counts 均为 high:1/medium:1；DB findings 行数 2（非 4）；无 level=50 日志 | `regression/bug1-before-retry.json` → `bug1-after-retry.json` |
| **BUG-2** 并发提交 500 | ✅ PASS — 并行 POST 同 repo：一方 **201**，另一方 **409** `ERR_CONFLICT` reason=duplicate；串行再提交 409 cooldown | `regression/bug2-a.json` / `bug2-b.json` / `bug2-seq.json` |
| **BUG-3** 非法 uuid 500 | ✅ PASS — `{"finding_ids":["not-a-uuid"]}` → **422** `invalid_uuid` | `regression/bug3-bad-uuid.json` |
| 红线抽检 | ✅ PASS — 匿名 findings 仍 401 | — |

### 回归观察（不阻断）
- Mock VH 每次 createTask 生成**新 finding_key**（后缀 task 短 id），故 retry 后按 key 保留的 disclosure 无法命中，`disclosed_findings` 变为空。真实 VH 侧 key 稳定时，开发者「同 key 恢复 disclosed」逻辑才会生效。建议后续用稳定 key 的 mock 或真实 VH 再验一次披露保留。
- 核心验收点「统计不膨胀」已满足。

### 签字
- **后端 API 原型**：✅ QA 签字通过（mock 模式），可继续前端联调。
- **仍非 release 条件**：真实 GitHub OAuth E2E、真实 VulnHunter 对接、前端 UI 验收均未做。
