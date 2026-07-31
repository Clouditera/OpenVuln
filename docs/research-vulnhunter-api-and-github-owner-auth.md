# 调研：VulnHunter 开放 API 能力 + GitHub Owner 认证方案

> 任务：task-d905e3b6 ｜ 调研人：architect ｜ 2025-07-30
> 调研对象代码库：`vulnhunt-srv` (local sibling checkout)（v2.3.0，pnpm monorepo）
> 结论服务：OpenVuln MVP PRD 与架构设计

---

## 一、VulnHunter 调用集成方式

### 1.1 现状：API 能否支撑外部调用链路？

**结论：业务 API 链路完整存在，但认证机制只面向浏览器会话（session cookie），不支撑服务端到服务端集成。**

OpenVuln 需要的三步调用链，VulnHunter 现有 REST API 全部具备（均在 `packages/service/src/features/`）：

| OpenVuln 需求 | 现有端点 | 位置 | 备注 |
|---|---|---|---|
| 创建扫描任务（git url） | `POST /api/tasks`（JSON） | `files/routes.ts` | body: `{git_url, git_branch?, project_name?, credential_id?, audit_focus?, scan_timeout?, enable_dynamic_verify?, enable_dynamic_exploit?, agent_max_parallel?}` → `201 {task}` |
| 探测仓库可达性/默认分支 | `GET /api/git/branches?url=` | `files/routes.ts` | 返回 `{default_branch, branches[]}`；**需登录态** |
| 查询任务状态 | `GET /api/tasks/:id`、`GET /api/tasks/:id/events` | `tasks/routes.ts` | 状态机：`queued → preparing → running → completed / failed / cancelled`（+`paused`） |
| 拉取漏洞列表 | `GET /api/tasks/:id/findings` | `findings/routes.ts` | 含 severity 统计 |
| 拉取漏洞详情 | `GET /api/tasks/:id/findings/:key` | `findings/routes.ts` | OpenVuln 仅在 owner 认证后代理展示 |
| 健康检查 | `GET /health` | `server.ts` | 无认证 |

关键行为确认：

- **不传 `git_branch` 时自动扫默认分支**（`files/git-clone.ts`：先探测默认分支，失败则 `git clone` 远端默认），与 OpenVuln「只扫默认分支」的策略天然吻合。
- **同名任务冲突返回 409**（`hasTaskNameConflict`）——OpenVuln 侧需自己查重，或对同一项目重复扫描时显式传不同 `display_name`。
- **创建任务必须解析到 LLM 凭证**（`credential_id` 缺省时取该用户默认/首个可用凭证，无则 400）。OpenVuln 的专用服务账户需预先配置好默认模型凭证。
- **任务数限制**：`users.task_limit <= 0` 表示不限，专用账户保持默认即可。
- **无 webhook/回调**：任务完成通知只有站内通知 + WS，OpenVuln 需要**轮询** `GET /api/tasks/:id`。
- `/mcp` 端点虽有 Bearer token 认证，但 token 绑定的是内部 chat/report 会话（`mcp/context.ts`），**不是**通用开放 API，不可复用。

### 1.2 认证现状

- 登录：`POST /api/auth/login`（email + password）→ HttpOnly session cookie（`middleware/auth.ts` 的 `injectUser` 只认 cookie）。
- 所有业务路由 `requireAuth`（session cookie），无 API token / Personal Access Token 机制。
- Community 版 `licenseGuard` 为 no-op，无额外阻碍。

OpenVuln 若直接用服务账户密码模拟登录维持 cookie：cookie 有过期/续期问题、与 CSRF 语义耦合、且任何会话管理变更都会击穿集成——**脆弱，不推荐**。

### 1.3 最小改动方案（给 VulnHunter 侧提 issue 的需求）

**需求标题：支持服务账户 API Token 认证（Bearer），用于外部系统（OpenVuln）服务端集成**

1. **API Token 认证**（核心，阻塞项）
   - 新增 `user_api_tokens` 表：`id, user_id, name, token_hash, created_at, last_used_at, revoked_at`；token 明文仅创建时返回一次（格式如 `vht_<random>`），库存 hash。
   - `injectUser` 中间件扩展：请求头 `Authorization: Bearer vht_xxx` 存在时，校验 token → 解析为对应 `SessionUser` 注入；与 cookie 路径并存。
   - 管理入口：最小实现可用 CLI/迁移脚本为服务账户签发；完整实现加 `GET/POST/DELETE /api/auth/tokens` 自助管理。
   - 预估改动量：小（中间件 ~30 行 + 存储 ~80 行 + 签发入口），不触碰业务路由。

2. **幂等创建辅助**（建议项，非阻塞）
   - `POST /api/tasks` 支持调用方传 `external_ref`（如 `github:{repo_id}`），冲突时返回 200 + 已有任务而非 409 撞名。OpenVuln 侧也可自行查重绕过，故非阻塞。

3. **任务完成回调**（可选，非阻塞）
   - 任务终态（completed/failed）时向配置的 webhook URL POST 一次。没有它 OpenVuln 用 30~60s 轮询也可接受。

**过渡期备选（若 issue 短期无法落地）**：OpenVuln 后端用服务账户密码调 `POST /api/auth/login` 持有 cookie，失败时自动重登。可行但脆弱，只作过渡，代码上把「VulnHunter 客户端」封装成接口以便将来无缝切换到 token。

### 1.4 OpenVuln 侧由此确定的集成架构（预览）

- OpenVuln 后端封装 `VulnHunterClient`：`createTask(gitUrl) / getTask(id) / listFindings(id) / getFinding(id,key)`，凭证走环境变量。
- 队列与限流在 OpenVuln 侧：用户提交先入 OpenVuln 队，按 VulnHunter 容量匀速投递。
- 项目开放性（public 判断）由 OpenVuln 用 GitHub API 自查，不依赖 VulnHunter。

---

## 二、GitHub Owner 认证方案

### 2.1 OAuth App vs GitHub App

| 维度 | OAuth App | GitHub App |
|---|---|---|
| 本质 | 代表「用户」行事（user token） | 代表「应用/安装实例」行事（installation token） |
| 「登录并验证我对 repo 的权限」 | ✅ 天然匹配 | 需走 installation，模型不匹配 |
| 组织准入 | 可能受组织 OAuth 限制拦截（见 2.3） | 需组织管理员安装，摩擦更大 |
| 权限粒度 | scope 较粗（`public_repo` 够用） | 细粒度，但本场景用不上 |
| 维护成本 | 低 | 高（webhook、私钥、installation 生命周期） |

**推荐：OAuth App。** OpenVuln 的场景是「用户证明自己是人、且此人对某 repo 有权限」，是典型 user-token 场景。GitHub App 的 installation 模型适合机器人/CI，不适合一次性身份验证。

**申请配置**：GitHub OAuth App，回调 `https://<openvuln>/api/auth/github/callback`，scopes：
- `read:user` — 读取登录身份
- `read:org` — 组织成员关系（组织私有成员身份时必需）
- `public_repo` — 对公开 repo 的协作者权限读取

不申请 `repo`（私有库）scope：OpenVuln 只扫公开项目，最小权限原则，也降低用户授权心理门槛。

### 2.2 Owner/Maintainer 验证流程

```
用户点击「我是项目 Owner」→ GitHub OAuth 授权 → 回调拿 user token
  → GET /user                       确认身份（拿数字 id + login）
  → GET /repos/{owner}/{repo}       返回体含 permissions: {admin, push, pull}
     （或 GET /repos/{o}/{r}/collaborators/{user}/permission → admin/maintain/write/read）
  → 判定：admin 或 maintain 角色 ⇒ 通过，授予该项目详情查看权
```

- **判定阈值建议：`admin` 或 `maintain`**。`write`（push）协作者也可看详情与否是产品决策——倾向 MVP 从严（admin/maintain），后续可放宽。两种判定的接口成本相同。
- **缓存与再验证**：权限可能变更。每次 OAuth 登录时重新校验；会话有效期内（如 24h）缓存结果，过期后查看详情触发静默重校验。
- **用户 token 不落库**：验证完即弃，OpenVuln 只存「github_user_id ↔ repo_id ↔ 角色」的授权结论（含校验时间戳），不存访问令牌，缩小泄露面。

### 2.3 边界情况

| 情况 | 处理 |
|---|---|
| **组织项目** | 组织对 repo 的 admin/maintain 成员均视为 owner（无单一 owner 概念）。风险：组织开启 **OAuth App 访问限制**时，用户 token 无法读组织资源（403），需组织管理员在 GitHub 设置里批准我们的 OAuth App——UI 需给出明确引导文案；SAML SSO 组织还需用户先对 token 做 SSO 授权。 |
| **Fork 项目** | Fork 拥有者 ≠ 上游 owner。策略：提交 fork URL 时，用 API 的 `parent/source` 字段**解析到上游根仓库**并以其为 OpenVuln「项目」；owner 验证永远针对根仓库。拒绝把 fork 本身注册为项目（避免同一项目多份记录、权限错配）。 |
| **改名/转移** | GitHub repo 全名可变、**数字 repo id 不变**。OpenVuln 项目主键绑定 `repo_id`，`full_name` 仅作展示并定期刷新。用户侧同样存数字 `user_id`。 |
| **归档项目** | 权限 API 正常返回，可验证、可扫描，无需特殊处理。 |
| **转私有/删除** | 定期（如每日）或 owner 访问时用其 token 复查；项目转私有→暂停公开统计展示并标记，删除→下线。 |
| **速率限制** | 每用户 token 5000 req/h，验证流程仅 2 次调用，无压力。 |

### 2.4 无需注册前提下的会话设计

「无需注册」= 无本地账号密码体系；身份 = GitHub 身份。

- 匿名用户：无会话，浏览公开统计。
- Owner：OAuth 回调通过后，签发 OpenVuln **服务端会话**（session 表：`id, github_user_id, created_at, expires_at`，HttpOnly + SameSite=Lax cookie，有效期建议 7 天滑动）。
- **选服务端会话而非 JWT**：可随时吊销（权限被撤、token 泄露时），代价是多一张表，查询开销可忽略。
- DB 里不需要 users 表，一张 `github_identities`（`user_id PK, login, avatar_url, first_seen, last_seen`）+ 一张 `repo_access_grants`（`user_id, repo_id, role, verified_at`）即可。

---

## 三、结论摘要

1. **VulnHunter 业务 API 链路完整**（创建→状态→findings 全覆盖，且默认分支行为天然匹配），**唯一硬缺口是服务端认证**：需要给 VulnHunter 提 issue 增加 API Token（Bearer）认证，改动量小；过渡期可用服务账户 cookie 方案兜底。
2. **Owner 认证用 GitHub OAuth App**（scopes: `read:user, read:org, public_repo`），以 repo 协作者权限 `admin/maintain` 为通过阈值；项目身份绑定数字 `repo_id`；fork 归并到上游根仓库；组织 OAuth 限制是主要已知摩擦点，靠 UI 引导解决。
3. **会话采用服务端 session**（可吊销），不建本地账号体系，不持久化用户的 GitHub token。
