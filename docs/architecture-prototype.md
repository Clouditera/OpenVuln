# OpenVuln 原型架构方案

> 任务：task-d2514415 ｜ 依据：PRD v1.0（docs/prd-openvuln-mvp.md）+ 调研（docs/research-vulnhunter-api-and-github-owner-auth.md）
> 原则：**速度优先、不过度设计**；结构向 VulnHunter dev-guide 靠拢以便未来归并

---

## 1. 总体形态

```
浏览器 (React SPA)
   │  /api/* 同源
   ▼
OpenVuln service (Hono, 单进程：API + 静态资源 + 扫描调度循环)
   │                    │                    │
   ▼                    ▼                    ▼
PostgreSQL        VulnHunter 实例        GitHub REST API
(唯一状态存储)     (远端扫描引擎)         (repo 元数据 / owner 验证)
```

- 无独立 worker、无消息队列、无 MinIO —— 重活全在远端 VulnHunter
- 一个 Dockerfile 产出单容器，直接适配 HF Docker Spaces

## 2. 仓库结构（pnpm monorepo）

```
OpenVuln/
├── packages/
│   ├── shared/            # 仅类型与常量（DTO、错误码、Severity），零运行时依赖
│   │   └── src/api/       # 前后端契约类型，单一事实源
│   ├── service/           # Hono 后端
│   │   └── src/
│   │       ├── main.ts / server.ts
│   │       ├── infra/     # config.ts(env)、db.ts(postgres.js)、logger.ts(pino)
│   │       ├── middleware/# auth.ts(session)、error-handler.ts
│   │       └── features/  # 按域划分，遵循 dev-guide 标准结构
│   │           ├── projects/    routes/service/storage/github-sync + index.ts
│   │           ├── scans/       routes/service/storage/queue.ts(调度) + index.ts
│   │           ├── findings/    routes/service/storage + index.ts
│   │           ├── auth/        routes(GitHub OAuth)/service/session + index.ts
│   │           ├── disclosure/  routes/service + index.ts
│   │           └── vulnhunter/  client.ts(接口)/cookie-client.ts/token-client.ts + index.ts
│   └── web/               # React + Vite + TanStack Query
│       └── src/
│           ├── shared/api/      # api-client.ts（只引 shared 类型，不写裸 fetch）
│           └── features/        # home / submit / project / owner / auth
├── deploy/
│   ├── Dockerfile               # 多阶段：web build → service runtime
│   ├── docker-compose.yml       # 本地开发：service + postgres
│   └── migrations/              # SQL 迁移（node-pg-migrate 或手写迁移器）
└── docs/
```

约定（对齐 VulnHunter dev-guide，刻意简化处已标注）：
- feature 标准结构 `routes/service/storage/index`；跨 feature 只许从 `index.ts` 导入
- 前后端共享类型只放 `packages/shared/src/api/`
- **刻意偏离**：原型不加 `tenant_id`（OpenVuln 数据天然公开/单租户）。归并 VulnHunter 时加列回填默认 tenant 即可，成本极低，不为未来付现在的税

## 3. 数据模型（PostgreSQL，迁移文件即事实源）

```sql
projects (
  id uuid PK,
  github_repo_id bigint UNIQUE NOT NULL,      -- 数字 id，改名/转移不受影响
  owner_login text NOT NULL, name text NOT NULL, full_name text NOT NULL,
  html_url text NOT NULL, description text, language text, stars int,
  default_branch text NOT NULL,
  created_at timestamptz, updated_at timestamptz,
  removed_at timestamptz                      -- 下架（FR-6），非物理删除
)

scan_jobs (
  id uuid PK, project_id uuid REFERENCES projects,
  vulnhunter_task_id uuid,                    -- 创建后回填
  state text NOT NULL,          -- queued | dispatching | scanning | completed | failed
  commit_sha text,                            -- 提交时取默认分支 HEAD
  attempt int NOT NULL DEFAULT 1,
  fail_reason_internal text,                  -- 仅内部可见，不外泄
  created_at timestamptz, started_at timestamptz, finished_at timestamptz
)
CREATE INDEX ON scan_jobs (state, created_at);  -- 队列消费

findings (
  id uuid PK, project_id uuid REFERENCES, scan_job_id uuid REFERENCES,
  finding_key text NOT NULL,                  -- VulnHunter 侧 key
  severity text NOT NULL,                     -- high|medium|low|info（对齐 VH，无 critical）
  title text, cwe text, primary_file text,
  detail_json jsonb,                          -- 完成时缓存的 VH 详情(YAML→JSON)
  disclosure_state text NOT NULL DEFAULT 'owner_only',  -- owner_only | disclosed
  disclosed_at timestamptz, disclosed_by bigint,        -- github_user_id
  UNIQUE (scan_job_id, finding_key)
)

github_identities (
  user_id bigint PK,                          -- GitHub 数字 id
  login text, avatar_url text,
  first_seen_at timestamptz, last_seen_at timestamptz
)

repo_access_grants (
  id uuid PK,
  github_user_id bigint REFERENCES github_identities,
  github_repo_id bigint NOT NULL,
  role text NOT NULL,                         -- admin | maintain
  verified_at timestamptz,
  UNIQUE (github_user_id, github_repo_id)
)

sessions (
  id uuid PK,                                 -- cookie 携带随机 id，库存 hash
  github_user_id bigint REFERENCES github_identities,
  created_at timestamptz, expires_at timestamptz  -- 7 天滑动
)
```

- 公众统计（severity 计数、CWE 分布）从 `findings` 实时聚合，原型不做物化统计表
- **PRD 对齐项**：PRD 写了 critical/high/medium/low，但 VulnHunter severity 实际为 `high|medium|low|info`（`shared/domain/severity.ts`）——原型按 VH 实际值实现，PRD 措辞需修正

## 4. VulnHunterClient

```ts
// features/vulnhunter/client.ts — 接口即切换点
export interface VulnHunterClient {
  createScanTask(input: { gitUrl: string; displayName: string }): Promise<{ taskId: string }>;
  getTask(taskId: string): Promise<{ state: VhTaskState }>;   // queued|preparing|running|completed|failed|cancelled
  listFindings(taskId: string): Promise<VhFindingMeta[]>;     // GET /api/tasks/:id/findings
  getFindingDetail(taskId: string, key: string): Promise<unknown>; // GET .../findings/:key
  healthCheck(): Promise<boolean>;                            // GET /health（无需认证）
}
```

- `CookieVulnHunterClient`（**过渡期默认**）：`POST /api/auth/login` 取 cookie 注入后续请求；401 时自动重登一次；`VULNHUNTER_AUTH_MODE=cookie`
- `TokenVulnHunterClient`（API Token issue 落地后）：`Authorization: Bearer`，`VULNHUNTER_AUTH_MODE=token` —— 切换零业务代码改动
- 创建任务不传 `git_branch`（VH 自动扫默认分支）；`display_name` 用 `owner/repo + scan_job 短 id` 规避 VH 侧同名 409
- VH 服务账户须预配默认 LLM 凭证（部署检查清单项，见 §8）

## 5. 扫描队列（DB 支撑 + 进程内循环）

不引入 Redis/BullMQ——`scan_jobs` 表本身就是队列，容器重启不丢：

- **Dispatcher**（service 内 `setInterval` 10s）：取 `state=queued` 最老 N 条，N = `SCAN_CONCURRENCY` − 在途数（默认并发 1~2，HF 资源受限）→ 置 `dispatching` → 调 `createScanTask` → 回填 task_id、置 `scanning`（失败 → `failed`，可 admin 重试）
- **Poller**（30s）：对所有 `scanning` 调 `getTask`：`completed` → 同步 findings（list + 逐条 detail 缓存进 `detail_json`）→ 置 `completed`；`failed/cancelled` → `failed`；其余保持
- **冷却期**：同一 project 距上次 `scan_jobs.created_at` < `SCAN_COOLDOWN_DAYS`（默认 7）拒绝重复提交
- **并发保护**：dispatcher 用 `UPDATE ... SET state='dispatching' WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` 抢任务（原型单实例其实用不上，但这是 SQL 级正确做法，一行事）

## 6. API 契约（类型定义落 shared/src/api/）

**公开（匿名）**
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects?sort=newest|stars&page=` | 项目卡片 + severity 计数 |
| POST | `/api/projects` `{git_url}` | 归一化→GitHub 校验(public/非 fork 或归并上游)→建 project+scan_job；409 重复/冷却中，422 非法/私有 |
| GET | `/api/projects/:owner/:repo` | 公众视图：元数据 + 最近扫描 + 聚合统计 + **已披露** findings |
| GET | `/api/stats/overview` | 平台级聚合（项目数、扫描数、发现数） |

**认证（GitHub OAuth，登录即 owner 验证）**
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/github/login?project=<owner/repo>` | state 携带回跳地址 + 目标项目 |
| GET | `/api/auth/github/callback` | 换 token→`GET /user` 建身份/会话；若 state 带 project 且权限 ≥ maintain → 写 `repo_access_grants`，随后**弃掉 token** |
| POST | `/api/auth/logout` / GET `/api/me` | 吊销会话 / 身份+grants |

**Owner（需 grant，中间件校验 repo_id）**
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:id/findings` | 漏洞列表（含 owner_only） |
| GET | `/api/projects/:id/findings/:key` | 详情（detail_json） |
| POST | `/api/projects/:id/disclose` `{finding_ids[]}` | 批量置 disclosed（FR-5） |

**Admin（env `ADMIN_GITHUB_LOGINS` 白名单）**：`GET /api/admin/queue`、`POST /api/admin/scan-jobs/:id/retry`、`DELETE /api/admin/projects/:id`（置 removed_at）

红线执行点：**findings 路由与 disclose 路由全部过 `requireGrant` 中间件**；公众项目路由在 service 层只做聚合查询，物理上取不到单条 finding。

## 7. 部署形态（HF Docker Spaces）

- **单 Dockerfile 多阶段**：`web build → 静态产物`；runtime = node + service（Hono 托管 API + 静态文件）；EXPOSE 7860（Spaces 默认端口，env 可配）
- **DB：外部 serverless PG（推荐）**：Neon/Supabase 免费档，`DATABASE_URL` 注入。理由：Spaces 重启/重建容器内数据即丢，嵌入式 PG/SQLite 都无法持久；外部 PG 也与 VulnHunter 同构，归并零成本。**原型不接受 SQLite**（避免双方言）
- 迁移：容器启动时自动跑 `migrations/`（幂等）
- 本地开发：`deploy/docker-compose.yml`（service + postgres）一键起
- 若 fish 确认 HF 提供持久卷，可加嵌 PG 变体，但不改默认推荐

## 8. 环境变量清单

| 变量 | 用途 | 备注 |
|---|---|---|
| `DATABASE_URL` | PG 连接串 | Neon/Supabase |
| `VULNHUNTER_BASE_URL` | VH 实例地址 | |
| `VULNHUNTER_AUTH_MODE` | `cookie` / `token` | 过渡期 cookie |
| `VULNHUNTER_USERNAME` / `VULNHUNTER_PASSWORD` | 服务账户（cookie 模式） | token 落地后弃用 |
| `VULNHUNTER_API_TOKEN` | Bearer token（token 模式） | 依赖上游 issue |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth App | |
| `GITHUB_SERVER_TOKEN` | repo 元数据/开放性校验 | 提额度；可省（匿名 60/h 太低，建议配） |
| `SESSION_SECRET` | session id 哈希盐 | |
| `SCAN_CONCURRENCY` / `SCAN_COOLDOWN_DAYS` | 队列参数 | 默认 1 / 7 |
| `ADMIN_GITHUB_LOGINS` | 管理员白名单（逗号分隔） | FR-6 |
| `PUBLIC_BASE_URL` | OAuth 回调拼装 | |

**部署检查清单**：① VH 服务账户已创建且配好默认 LLM 凭证（否则创建任务 400）；② GitHub OAuth App 回调 URL 与 `PUBLIC_BASE_URL` 一致；③ `DATABASE_URL` 可达且迁移已跑。

## 9. 给 Developer 的执行顺序建议

1. monorepo 骨架 + shared 类型 + migrations（§3）
2. `vulnhunter` feature（§4，先 cookie client）+ `scans` 队列循环（§5）—— 用 mock VH 可先行
3. `projects` 提交/列表/统计 + `auth` OAuth + `findings`/`disclosure`（§6）
4. web 前端（等 designer 方案，task-7954ee03）
5. Dockerfile + compose + 部署检查清单（§7/§8）

风险与对策：VH cookie 模式脆弱（自动重登兜底，接口隔离切换）；HF 资源受限（并发默认 1，队列 DB 化可重启恢复）；GitHub 匿名限流（配 `GITHUB_SERVER_TOKEN`）。
