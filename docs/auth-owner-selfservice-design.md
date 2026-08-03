# 设计：GitHub 鉴权 + Owner 自助披露 + 废加密改造

> 任务：task-f76db119（激活 task-7fed0abf 备忘）｜ 决策来源：fish No.845/847/849
> 新定位：**仓库所有者自助平台** —— 仅 GitHub 仓库 maintainer/admin 可提交、看全文、披露；未鉴权用户只见摘要
> 新安全模型：**废弃 OVENC1 加密**，后端自控即安全，保护手段 = 访问控制

---

## 0. 一页纸结论

| 维度 | 旧模型（当前线上） | 新模型 |
|---|---|---|
| 提交 | 任何人 | GitHub 登录 + 该仓库 admin/maintain |
| 查看 | 公众只见聚合统计 | 不变（未登录=摘要）；owner 登录=全文 |
| 披露 | 运营私钥签名 | owner 一键自助（服务端翻转标记） |
| 存储 | 详情 OVENC1 密文 | **明文**，靠鉴权拦截 |
| admin-cli | 解密/签名披露 | 退役（仅留 legacy 解密救数据用） |
| GitHub token | 不落库 | **随 session 存服务端**（提交/查看时要调 GitHub 验权限） |

关键实现判断：
- **存量加密数据不用解密迁移** —— redis/GLM 等 VH 侧任务还在，改完后用现成 resync 端点重同步即自动转明文；仅对 VH 任务已删的孤儿数据才动用私钥救援
- **owner 查看绑定 GitHub 实时权限，不绑定"谁提交的"** —— 任何 maintainer/admin 登录都能看自己仓库的结果，与提交者身份无关
- 7/30 调研（docs/research-vulnhunter-api-and-github-owner-auth.md）的 OAuth 机制结论全部沿用，本文只列差异与落地

## 1. 数据模型（migration `008_auth_plaintext.sql`）

```sql
-- ① 找回身份/会话/授权三张表（002 删过，这次带 token）
CREATE TABLE github_identities (
  user_id bigint PRIMARY KEY,
  login text NOT NULL, avatar_url text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY,                       -- cookie 带随机 id，库存 sha256 哈希
  id_hash text UNIQUE NOT NULL,
  github_user_id bigint NOT NULL REFERENCES github_identities,
  github_token text NOT NULL,                -- 用户 OAuth token（验权限用；见 §2 安全说明）
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE repo_access_grants (            -- 权限缓存，TTL 24h
  id uuid PRIMARY KEY,
  github_user_id bigint NOT NULL REFERENCES github_identities,
  github_repo_id bigint NOT NULL,
  role text NOT NULL,                        -- admin | maintain
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (github_user_id, github_repo_id)
);

-- ② findings 回明文（列名恢复，与 VH 语义一致）
ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS primary_file text,
  ADD COLUMN IF NOT EXISTS detail_json jsonb;
-- enc_payload / disclosed_* 暂保留（存量迁移期双轨，完成后 009 清理）

-- ③ finding_artifacts 回明文
ALTER TABLE finding_artifacts ADD COLUMN IF NOT EXISTS content_text text;

-- ④ 提交溯源与限流
ALTER TABLE projects ADD COLUMN IF NOT EXISTS submitted_by bigint NULL;  -- github_user_id，仅审计/限流
```

## 2. Auth 子系统

**OAuth App**（需 fish 在 GitHub 创建）：callback `https://openvuln.clouditera.com/api/auth/github/callback`；scopes `read:user, read:org, public_repo`。

```
GET /api/auth/github/login?return_to=/p/owner/repo
  → 302 github.com/login/oauth/authorize（state=签名 return_to，防开放重定向）
GET /api/auth/github/callback?code&state
  → 换 token → GET /user → upsert github_identities
  → 建 session（id_hash / token / 7 天滑动）→ Set-Cookie: ov_session（HttpOnly+Secure+SameSite=Lax）
  → 302 return_to
POST /api/auth/logout → 删 session 行（服务端吊销）
GET /api/me → { authenticated, user: {login, avatar} }（前端据此渲染登录态）
```

**token 保管**（与旧"不落库"原则的差异，需 fish 知悉）：查看/提交时需用用户 token 实时调 GitHub 验权限，故 token 随 session 存库。缓解：session 过期/登出即删行；token 仅服务端使用从不下发前端；DB 备份同样受控。这与 fish「后端自控即安全」的决策一致。

**权限判定函数**（`features/auth/permission.ts`，单一事实源）：
```
requireRepoAccess(user, repoId):
  1. 查 repo_access_grants 新鲜缓存（<24h）→ 命中即过
 2. 否则用 session 里的 user token 调：
    GET /repos/{owner}/{repo}/collaborators/{user}/permission
    role ∈ {admin, maintain} → 写缓存、放行
    否则 403（write/read/none 一律拒，与 fish"仅 maintainer/admin"对齐）
```
- fork 归并上游（现有 resolveRootRepo 复用）；repo 改名无碍（绑数字 repo_id）
- 组织 OAuth 限制/SAML：403 响应带引导文案（调研文档 §2.3）

## 3. 三个动作的鉴权

**提交（POST /api/projects）**：requireAuth → parse repo → GitHub 校验 public + requireRepoAccess → 落 `submitted_by` → 入队。
- 新增**每用户提交限流**：10 次/天（env `SUBMIT_DAILY_LIMIT`），防持权限者刷队列
- 项目已存在：任何**有权限**的用户可触发重扫（冷却照旧）；无权限 403

**查看**：
- 未登录：现状不变（列表/统计/disclosed 公开内容）—— 红线不变
- 登录 + requireRepoAccess 通过：新增 owner 视图端点（见 §4）
- 登录但无权限：与未登录同视图（403 仅在显式请求 owner 端点时返回）

**披露**：
- `POST /api/projects/:id/disclose {finding_ids[]}`：requireAuth + requireRepoAccess → 翻转 disclosure_state
- **撤回建议（PM 要求给结论）**：披露单向不可逆（公开即被爬，撤回是假象）。误披露由运营 admin 端点 `POST /api/admin/findings/:id/undisclose` 兜底（token 即可）。owner UI 只给确认对话框，不给撤回钮
- **披露内容升级（plaintext 红利）**：disclosed 的 finding 公众可见**完整内容**（title/desc/path/code/report md）—— 对齐 GitHub Security Advisory 体验；不再是摘要级

## 4. API 契约变更

**新增（owner 视图，全部 requireAuth+grant）**
| 端点 | 说明 |
|---|---|
| `GET /api/projects/:id/findings` | 该项目全部 findings 列表（含未披露），完整字段 |
| `GET /api/projects/:id/findings/:key` | 单条全文（detail_json + report md + artifacts） |
| `POST /api/projects/:id/disclose` | 自助披露（§3） |
| `GET /api/projects/:id/report-full?format=` | owner 下载全量报告（含未披露）——"获取结果"的核心交付 |

**修改**
- `POST /api/projects`：加 requireAuth + 权限 + 限流
- `GET /api/projects/:owner/:repo`（公众）：disclosed findings 现含完整内容（§3）
- 公众报告下载（`/report`）：disclosed 的完整渲染，md/yaml/zip 逻辑不变（数据源从 disclosed_* 列换成明文列）

**退役**
- `POST /api/admin/projects/:id/disclose`（验签版）→ 替换为 token-only `POST /api/admin/findings/:id/undisclose`（运营兜底）
- `GET /api/admin/report-package`（密文导出）→ 随加密退役
- 验签/nonce 机制、shared/crypto 的 disclose 部分 → 删
- queue/retry/finalize/resync/scan-config 等运维端点**保留**（token 认证不变）

## 5. 废加密改造与存量迁移

**同步管线**（queue.ts）：删 encryptForAdmin 调用 → 直接写 `title/primary_file/detail_json` 明文列；artifacts 同样明文 `content_text`。

**存量数据（redis 22 + GLM-4 扫描中等）两档处理**：
1. **主路径：重同步**（首选）—— VH 侧任务还在的（redis 等），上线后直接调现有 `POST /api/admin/scan-jobs/:id/resync`：重新拉取 → 明文入库 → 同事务翻 current_scan_job_id。**零解密、零私钥参与**。披露状态按 finding_key 保留（现有机制）
2. **救援路径：孤儿数据**（VH 任务已删的）—— admin-cli 保留 `decrypt` 命令：本地解密报告包 → 生成明文 JSON → 新 admin 端点 `POST /api/admin/projects/:id/import-plaintext`（token）写回。**仅迁移期使用**

**迁移完成后**（migration `009_crypto_retire.sql`）：DROP `enc_payload`、`admin_nonces`；config 删 `ADMIN_PUBLIC_KEY`；shared/crypto 仅保留 legacy 解密（标注 @deprecated，救数据用）或整体归档删除。

## 6. UI 改动点（交 designer）

1. **Header**：未登录「Sign in with GitHub」；已登录头像 + Logout
2. **提交页**：未登录→引导登录；无权限→明确错误（"仅仓库 maintainer/admin 可提交"）
3. **项目页**：owner 视角多一个 **Findings 详情区**（完整列表 + 每条全文 + 勾选披露 + 确认对话框 + 全量报告下载按钮）；公众/无权限视角完全不变
4. **disclosed 内容区**：升级为完整报告展示（描述/路径/代码/md 渲染）
5. **文案**：About 页补「仅仓库所有者可提交/查看」说明

## 7. 安全基线（新红线测试）

- 未登录/无权限访问 owner 端点 → 401/403（逐端点）
- 有权限用户 A 的项目，用户 B 无权限访问 → 403
- grant 缓存过期后自动重验；GitHub 侧撤权 → 24h 内生效（文档注明）
- token 不出现在任何 API 响应/日志（pino redact 加 github_token）
- session cookie 属性断言（HttpOnly/Secure/SameSite）

## 8. 实施顺序（交 developer）

| 步 | 内容 | 依赖 |
|---|---|---|
| 1 | migration 008 + auth feature（OAuth/session/permission）+ /api/me | fish 先建 OAuth App |
| 2 | 提交鉴权 + 限流 + submitted_by | 1 |
| 3 | 同步管线去加密（明文入库）+ owner 视图端点 + 自助披露 | 1 |
| 4 | 存量 resync 迁移（redis 等）+ 孤儿救援通道验证 | 3 |
| 5 | UI（designer 并行，1 完成后即可开工） | 1 |
| 6 | 退役清理（009 + admin-cli 精简 + 验签删除） | 4 |
| 7 | 红线测试更新 + 全量回归 | 全部 |

## 9. 需 fish 确认的开放点

1. **GitHub OAuth App**：建在哪个账号/组织下（建议 zai-org 或 Clouditera），callback 域名就是 openvuln.clouditera.com
2. **write 权限协作者**：严格拒绝（当前设计）。要放宽到 write 可看但不可披露吗？（建议先严后宽）
3. **披露后公众可见完整内容**（描述/路径/代码）：这符合 GSA 惯例，但比当前"摘要级披露"暴露面大 —— 确认一下这是你想要的
4. **HF Static Space 上前端**调后端登录：OAuth 回调在同源后端，跨域静态站登录跳转链稍绕（HF 页 → 后端登录 → GitHub → 回后端 → 302 回 HF 页）—— 支持，但 HF 版要测试一轮
