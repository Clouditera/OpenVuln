# 用户端 E2E：功能表 + 测试方法 v1

> QA：qa ｜ 2026-08-09  
> 任务：task-bf10dc47  
> 环境：https://openvuln.vulnhunter.pro（主站）+ HF Space（若测弹窗登录）  
> 管理台（审核配合）：http://192.168.31.77:5173  
> **本版只定表与方法，不执行大规模跑测**  

---

## 0. 测试资源规划

### 0.1 GitHub 账号（本机 `gh` 已登录）

| 代号 | 账号 | 角色分工 |
|---|---|---|
| **A** | `AzzzGoodFish` | 主测：提交方 / owner 路径 / 披露 / Cancel |
| **B** | `Clouditera-lhy` | 对照：跨用户隔离、无权限仓、已有项目（opencode 等）的「第二 maintainer」若适用 |

切换：
```bash
gh auth switch --user AzzzGoodFish
gh auth switch --user Clouditera-lhy
```

### 0.2 建议 fork 的上游（尽量小、public）

| 用途 | 上游 | Fork 归属 | 说明 |
|---|---|---|---|
| 正常提交 + 全流程 | `octocat/Hello-World` | A、B 各一份 | 极小；扫描成本低 |
| 指定 ref（branch/tag） | `octocat/Spoon-Knife` | A | 有 branch 可测 git_ref |
| 非法/边界 | 不 fork | — | 私有仓 URL、乱码 URL、非 github host |
| 无权限 | A 的 fork | B 登录去提交/看 Manage | 跨账号 403 |
| 同版本幂等 | A 的 Hello-World fork | A | 同一 commit 再提交 |

```bash
gh auth switch --user AzzzGoodFish
gh repo fork octocat/Hello-World --clone=false
gh repo fork octocat/Spoon-Knife --clone=false
gh auth switch --user Clouditera-lhy
gh repo fork octocat/Hello-World --clone=false
```

> 执行期注意：fork 后默认分支/HEAD 以 GitHub 为准；记录每次提交时的 `commit_sha` 便于幂等与版本断言。

### 0.3 环境与配合

| 类型 | 说明 |
|---|---|
| 浏览器 | 桌面 Chrome/Edge 常规窗口；可选 InPrivate（cookie/第三方） |
| Owner 会话 | **真实 GitHub OAuth**（fish 或测试账号浏览器登录）；种子 session 仅 API 辅助，不替代 UI 登录验收 |
| Admin 配合 | 审核 approve/reject、必要时 Health 确认 VH 通；**不测管理台本身**（已签） |
| 邮件 | 拒绝邮件、扫描完成通知：能收则验收件箱；不能则验 API/日志「已发送」 |
| 清理 | 管理台硬删测试项目 / 用户 Cancel 后删 job；**禁止动**生产展示项目（GLM-*/CogVideo/opencode）除非 fish 授权 |

### 0.4 用户可见状态口径（断言用）

| 内部 state | 用户可见（徽章/文案） |
|---|---|
| `pending_review` / `queued` /（failed 不外露） | **In review**（审核中） |
| `dispatching` / `scanning` | **Scanning**（进行中，可有 so-far） |
| `completed` | **Scanned** |
| reject | 记录删除 + 邮件；用户侧项目消失/不可见 |
| `cancelled` | 进行中结束；可再提交 |

---

## 1. 功能表总览

| ID | 旅程 | 功能点 | 优先级 |
|---|---|---|---|
| F1 | 匿名浏览 | 首页 / 列表 / 项目详情 / 已披露内容 / 无 Manage | P0 |
| F2 | 登录登出 | 主站 OAuth、return_to、登出、会话过期 | P0 |
| F3 | 提交 | 登录门禁、权限、URL 校验、默认分支、指定 ref、fork 仓 | P0 |
| F4 | 审核中 | In review 展示、步进器、用户 Cancel、admin 拒绝后体验 | P0 |
| F5 | 扫描中→完成 | Scanning / so-far / Scanned / 邮件或站内通知 | P0 |
| F6 | Owner 结果 | Findings 全文、版本切换、仅 current 可披露、下载 | P0 |
| F7 | 权限边界 | 非 owner、跨用户、匿名调 owner API | P0 |
| F8 | 版本与队列规则 | 同 commit 幂等、单进行中、跨版本独立披露 | P0 |
| F9 | 异常与边界 | 非法 URL、私有仓、重提、并发、HF 入口（若测） | P1 |
| F10 | 体验与文案 | 中英混排、对齐、空态、错误可读 | P1 |

---

## 2. 测试方法明细

### F1 — 匿名浏览（未登录）

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F1-01 | 首页加载 | 无痕/退出登录 | 打开 `/` | Hero 统计、项目入口、无崩溃；footer Powered by VulnHunter | — | P0 |
| F1-02 | 项目列表 | 同上 | 浏览列表/分页（若有） | 仅见公开项目卡片；severity 聚合；**无** findings 正文 | — | P0 |
| F1-03 | 已完成项目详情 | 已知 completed 如 `zai-org/GLM-4` | 打开 `/p/zai-org/GLM-4` | 徽章 **Scanned**；聚合 counts；**无** Manage findings；无 Cancel | — | P0 |
| F1-04 | 已披露内容（若有 disclosed） | 有 disclosed 的项目；若生产暂无则跳过或先用 A 造一条再匿名看 | 打开项目 disclosed 区 | 可见完整披露内容（title/描述/路径等，按现行 plaintext 披露）；未披露条目不可见 | — | P0 |
| F1-05 | 报告下载（disclosed） | 同上 | 点下载 md/yaml/zip（若入口在） | 200 且内容与披露一致；未披露不可下 | — | P1 |
| F1-06 | 直接打 owner API | 无 cookie | `GET` findings/scans 等 owner 端点 | **401** login_required | — | P0 |
| F1-07 | About / 404 | — | `/about`、乱路径 | About 可读；未知路径回首页或友好 404 | — | P2 |

**方法**：真浏览器匿名；Network 确认无带 `ov_session`；截图首页+项目页。

---

### F2 — 登录 / 登出

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F2-01 | 主站登录成功 | 账号 A | Sign in → GitHub 授权 → 回站点 | 头像/login 显示 A；cookie 写入 | 测完 Logout | P0 |
| F2-02 | return_to 深链 | 未登录 | 打开需登录页或带 return 的登录 | 登录后回到原项目/submit | — | P0 |
| F2-03 | 登出 | 已登录 | Logout | 回到未登录 UI；owner 入口消失；再访问 findings → 401 | — | P0 |
| F2-04 | 会话过期 | 可选：改短 expires 或清 cookie 半残 | 操作 owner 功能 | 明确要求重新登录，不白屏 | — | P1 |
| F2-05 | HF Space 登录（若 fish 要求） | HF 可访问 | HF 页 Sign in（弹窗/跳转） | 能回到 HF 前端且会话可用；失败则记环境限制 | — | P1 |
| F2-06 | 拒绝 OAuth | 点授权取消 | 取消 GitHub 授权 | 友好错误页，不 500 | — | P1 |

**方法**：真实 OAuth；A/B 各登一次确认身份串不混。  
**账号**：A 主路径；B 做 F2-01 一次证明双号可用。

---

### F3 — 提交项目

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F3-01 | 未登录提交 | 登出 | `/submit` 填 URL 点提交 | 引导登录，不创建项目 | — | P0 |
| F3-02 | 有权限提交（默认分支） | A 登录；A 的 Hello-World fork | 提交 `https://github.com/AzzzGoodFish/Hello-World` | 200；进入 **In review**；进度步进含 In review | admin 后硬删或 reject | P0 |
| F3-03 | 指定 branch/tag/SHA | A 的 Spoon-Knife fork | 打开「Scan a specific version」，填 ref | 入库 `git_ref`+解析后 `commit_sha`；展示锁定版本 | 同上 | P0 |
| F3-04 | 非法 URL | A 登录 | `not-a-url` / `https://gitlab.com/...` | 内联错误，不 500 | — | P0 |
| F3-05 | 空 URL | A | 空提交 | 校验拦截 | — | P0 |
| F3-06 | 私有仓 / 不存在仓 | A | 私有或 404 repo URL | 明确错误（不可扫/找不到） | — | P0 |
| F3-07 | 无仓库权限 | B 登录；提交 **A 的 fork**（B 非 collaborator） | 提交 | **403** repo_permission_denied；文案含 maintainer/admin | — | P0 |
| F3-08 | 重复项目名已存在 | 生产已有 `zai-org/GLM-4` | B 或无权限用户提交同名 | 无权限 403；有权限则走重扫/幂等规则（见 F8） | — | P1 |
| F3-09 | fork 仓作为独立项目 | A 的 fork | 提交 fork URL | **按 fork 自己 full_name 建项**（现策略：fork 独立，不强制归并 upstream） | 清理测试项 | P1 |

**方法**：UI 提交为主；失败用例可同时抓 Network 状态码。  
**Admin**：F3-02/03 创建后需 **不要自动扫**（已在 pending_review）；清理用 reject 或管理台 Delete。

---

### F4 — 审核中与用户 Cancel

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F4-01 | 提交后 In review | F3-02 后 | 看项目页/进度页 | 徽章 In review；文案审核中；**不**自动变 Scanning（≥30s 观察） | — | P0 |
| F4-02 | 进度步进 | 同上 | 看步进器 | `In review → Preparing → Scanning → Results`，当前停在 In review | — | P0 |
| F4-03 | Owner Cancel（pending_review） | A 为 owner，任务审核中 | 进度页 **Cancel this scan** → 确认 | 任务 cancelled；槽释放；可再提交 | — | P0 |
| F4-04 | 匿名无 Cancel | 登出 | 同项目页 | 无 Cancel 按钮 | — | P0 |
| F4-05 | Admin 拒绝 | F3-02 新单；管理台 reject+reason | reject | 项目对用户不可见/404；A 邮箱拒信（或日志 sent） | 已删 | P0 |
| F4-06 | 拒绝后重提 | F4-05 后 | A 再提交同仓 | 可重新进入 pending_review | 再清 | P1 |

**Admin 配合**：F4-05 reject；F5 用 approve。

---

### F5 — 扫描中 → 完成

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F5-01 | Approve 后进入队列/扫描 | 小仓 pending；管理台 Approve | 刷新项目页 | In review(queued)→Scanning；有 VH 任务 | — | P0 |
| F5-02 | Scanning 展示 | 扫描中 | 进度页 | Scanning 徽章；so-far 若有则非负；Cancel 仍可见（owner） | — | P0 |
| F5-03 | Owner Cancel（scanning） | 扫描中 | Cancel 确认 | cancelled；VH 侧取消/释放（允许短暂延迟） | — | P1 |
| F5-04 | 完成 Scanned | 等 tiny 仓完成或 0-finding 完成 | 完成态 | **Scanned**；聚合 counts；owner 见 Findings 入口 | 可选保留作 F6 | P0 |
| F5-05 | 完成通知 | 邮箱已绑定 GitHub | 完成后 | 站内通知和/或邮件（环境允许则打开邮箱） | — | P1 |

**注意**：真扫描耗 VH；优先 Hello-World 级仓库；**并行最多 1～2 条**，避免打满并发。

---

### F6 — Owner Findings / 披露 / 版本 / 下载

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F6-01 | Owner 见全文 | A 对已 completed 且有 findings 的**自有仓**（或 B 对 opencode 若仍为 maintainer） | 登录 → Manage findings | 列表含 severity/title/详情；匿名不可见同内容 | — | P0 |
| F6-02 | 版本切换 | 多版本项目（opencode 或自造两版） | VersionBar 切换历史版 | 历史版 findings 只读；提示仅 current 可披露 | — | P0 |
| F6-03 | 披露单条/多条 | current 版有未披露 | 勾选 → 确认披露 | `disclosed`；匿名刷新可见完整披露内容 | 可用 admin Undisclose 还原 | P0 |
| F6-04 | 历史版不可披露 | 切到非 current | 勾选披露 | 控件 disabled / 失败明确 | — | P0 |
| F6-05 | 披露确认防误点 | — | 打开确认框点取消 | 不披露 | — | P1 |
| F6-06 | 下载 | disclosed 或 owner 包 | 下载入口 | 文件可读、非空 | — | P1 |
| F6-07 | `/my` 列表 | A 提交过 | 打开 `/my` | 仅 A 相关项目；未登录引导登录 | — | P0 |

**方法**：披露是高敏操作——**优先在 A 的测试 fork 结果上披露**，避免污染 GLM 公开展示；若必须用现网项目需 fish 点头。

---

### F7 — 权限边界与隔离

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F7-01 | B 看 A 的项目公众页 | A 项目已存在 | B 登录打开 A 项目 | 仅公众视图；无 Manage（除非 B 也是该仓 admin/maintain） | — | P0 |
| F7-02 | B 调 A 项目 owner API | B session | GET findings/scans、POST disclose/cancel | **403** repo_permission_denied | — | P0 |
| F7-03 | A 看 B 的 `/my` | 两号都有提交 | 各登各的 `/my` | 列表不串号 | — | P0 |
| F7-04 | 登录无权限 vs 未登录 | B 对 A 仓 | UI | 与未登录同为公众视图；显式 owner 操作才 403 | — | P0 |

---

### F8 — 版本绑定与队列规则

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F8-01 | 同 commit 幂等 | A 某仓已 completed 于 sha S | 再提交同一 git_ref/S | **不新建**扫描；返回已有 completed | — | P0 |
| F8-02 | 不同 ref 新版本 | 默认分支已扫 | 提交另一 SHA（若可造） | 新 job pending_review；历史保留 | 管理台 | P0 |
| F8-03 | 单项目单进行中 | 已有 pending_review/queued/scanning | 再提交同项目 | 拒绝或提示已有进行中（409/文案） | Cancel 后重试 | P0 |
| F8-04 | 披露不跨版本继承 | v1 披露后扫 v2 | 看 v2 findings | v2 默认未披露（除非产品另定；现行：跨版本不继承） | — | P1 |

---

### F9 — 更多异常 / 边界

| 用例 ID | 场景 | 步骤/期望 | P |
|---|---|---|---|
| F9-01 | 超长 URL / XSS 字符串 | 提交反射到 UI 应转义，不执行脚本 | P1 |
| F9-02 | 反复连点提交 | 只建一条 pending / 有防重 | P1 |
| F9-03 | 扫描中刷新/回退 | 状态不丢、不白屏 | P1 |
| F9-04 | VH/GitHub 降级 | Health 红时提交或审批后的失败态用户仍见 In review/Waiting，不露内部栈 | P2 |
| F9-05 | 三端登录矩阵 | 主域必测；HF 子域/Hub 弹窗能测则测，不能则标环境阻塞 | P1 |

---

### F10 — 体验与文案（设计师补强区）

| 用例 ID | 场景 | 期望 | P |
|---|---|---|---|
| F10-01 | 仓库名与 branch 对齐 | 标题行垂直居中（已修过，回归） | P1 |
| F10-02 | 状态英文案 | In review / Scanning / Scanned 一致，无 Queued 旧词残留 | P0 |
| F10-03 | 错误文案可读 | 403/401/校验错误为产品句，非裸 JSON | P1 |
| F10-04 | 空 findings | 0 洞 completed 友好空态 | P1 |

---

## 3. 推荐执行顺序（v2 定稿后）

```
Phase 0  资源：双号 fork Hello-World + Spoon-Knife；确认 OAuth 能登 A/B
Phase 1  F1 匿名 + F2 登录（主站）           —— 无 VH 成本
Phase 2  F3 校验类异常 + F7 权限             —— 无/低 VH
Phase 3  F3-02 提交 → F4 审核/Cancel/拒绝   —— admin 配合
Phase 4  F5 一条 tiny 真扫描 → F6 披露（仅测试仓）
Phase 5  F8 幂等/单进行中 + F10 文案回归
Phase 6  F2-05/F9-05 HF（可选）
```

---

## 4. 证据与报告模板（执行时）

每条 P0 至少保留：
- 步骤复述 + 账号
- 截图或 API 状态码
- 失败则 severity + 是否阻断发布

汇总路径建议：`docs/qa/user-e2e-report-v1.md`（执行后另开，不在本文件混写结果）。

---

## 5. 请 pm / designer / developer 补充的检查清单

请在本 v1 上直接评论或改稿，重点挖洞：

**pm（产品）** — 已补（见 §7）
- [x] 公众「Waiting」与「In review」对外口径是否统一？
- [x] fork 独立建项是否仍是产品意图？
- [x] 0-finding / no-scan-value 用户文案是否要单列用例？
- [x] 披露后是否允许 owner 再扫同版本？与幂等如何表述？

**designer（交互）**
- [ ] Cancel / 披露确认框文案与危险色
- [ ] 审核中空等是否要 ETA/说明「邮件通知」
- [ ] `/my` 与项目页入口发现性
- [ ] 移动宽度（若要支持）断局

**developer（实现）**
- [ ] 还有哪些 owner 端点未列（notify 已读、rescan 入口）？
- [ ] 同项目单进行中的准确错误码与前端映射
- [ ] git_ref 解析失败时的前端展示
- [ ] Cookie SameSite / 跨站 HF 已知坑是否要写进 F2 必测

---



---

## 7. pm 产品视角补充（v1.1）

### 7.1 口径裁定（执行时按此断言）

| 议题 | 裁定 |
|---|---|
| 公众 Waiting vs In review | **用户主站统一用 In review**（含 pending_review + queued + failed 不外露）。文档/API 内部可保留 Waiting 映射，但 **UI 验收禁止再出现 Queued/Waiting 旧词**（F10-02 升级为阻断项）。 |
| fork 独立建项 | **是现行产品意图**（fish 已批准取消归并上游）。F3-09 升为 **P0**。 |
| 同版本幂等 vs 披露后重扫 | **同 commit 一律幂等返回已有结果，不提供强扫**。披露过也不例外。若要「再扫」，必须换 ref/新 commit（F8-01 保持 P0；F8-05 下方新增）。 |
| no-scan-value / 0 findings | **必须单列**：`completed + 0 findings` 与「源码不完整类 no-scan-value」对用户都是 **Scanned + 无洞空态**，但文案/徽章不得暴露失败（F6-08、F5-06）。 |

### 7.2 建议增补用例

| 用例 ID | 场景 | 前置 | 步骤 | 期望 | 清理 | P |
|---|---|---|---|---|---|---|
| F1-08 | 审核中项目的公众页 | A 提交后未 approve | 匿名打开该项目 | 可见项目壳/In review（或不在公开展示列表——以现行列表策略为准）；**不可**见 findings 正文；无 Cancel | — | P0 |
| F3-10 | 提交成功落地页 | A 登录 | 提交成功 | 进入项目进度页；kicker/文案含 submitted for review / 审核；**不会**立即 Scanning | — | P0 |
| F3-11 | 默认分支 vs 指定 ref 展示 | F3-02 / F3-03 | 看进度页标题区 | 指定 ref 时展示锁定 branch/tag/sha；默认分支展示 default branch 名 | — | P1 |
| F4-07 | 审核中再次打开站点 | pending_review | 刷新、从 /my 进入 | 状态仍为 In review，不丢单、不重复建单 | — | P0 |
| F5-06 | 0 findings 完成 | 小仓或 mock completed 0 | 完成态 | 徽章 Scanned；友好空态；不出现 failed/错误栈 | — | P0 |
| F5-07 | so-far 单调 | scanning | 观察 2～3 次刷新 | findings_so_far 只增不减（或持平），不为负 | — | P1 |
| F6-08 | 无洞 Owner 视图 | completed 0 findings | Owner Findings | 空列表可读；披露区空；下载行为符合空包/禁用策略（二选一写死期望） | — | P0 |
| F6-09 | 披露后匿名完整性 | F6-03 后 | 匿名+B 账号看同页 | 仅 disclosed 条目全文可见；未披露仍不可见 | Undisclose 或删测项 | P0 |
| F6-10 | 多版本 current 指针 | 两版 completed | 只看默认进入 | 默认 findings = current（最新完成版）；切换历史版后可回 current | — | P0 |
| F7-05 | 权限被撤后的会话 | 理想：A 曾有权后被移出 collaborator（若难造则标可选） | 再 disclose/cancel | 403 或要求重登；不出现半套 UI | — | P2 |
| F8-05 | 披露后同 commit 再提交 | current 已披露部分 | 同 sha 再提交 | 幂等回已有 job；**不会**新建 pending_review；披露状态保持 | — | P0 |
| F8-06 | Cancel 后同 commit 可重提 | pending/queued/scanning 被 Cancel | 再提交同 ref | 允许进入新的 pending_review（与 completed 幂等相反） | reject/删 | P0 |
| F9-06 | 管理台 Reject 原因展示 | reject 带 reason | 查邮件正文 | 含项目名 + reason；无内部 token/堆栈 | — | P1 |
| F9-07 | 双号交叉提交同一上游不同 fork | A/B 各 Hello-World fork | 分别提交 | 两个独立项目；互不影响权限与 /my | 双清 | P1 |

### 7.3 执行策略补充（产品）

1. **真扫描预算**：全套 P0 最多 **1 条** tiny 真扫描进 Scanning/Scanned（F5-04）；其余扫描态尽量用 pending_review + admin 不 approve / Cancel 覆盖，控制 VH 成本。  
2. **披露污染**：F6 披露类 **只允许 A 的测试 fork 产物**；禁止在 GLM-*/CogVideo 上披露 unless fish 当场授权。  
3. **admin 配合剧本**（给执行日）：  
   - 仅 reject：F4-05  
   - 仅 approve 一次 tiny：F5-01→F5-04  
   - Undisclose：仅当 F6-03 用了可逆数据  
4. **账号卫生**：Phase 0 先记录 A/B 的 GitHub login 与邮箱是否对 GH 可见（影响拒信/完成信）；若 B 邮箱为空，邮件用例改验日志。  
5. **失败分级**：登录/提交门禁/权限隔离失败 = 发布阻断；HF 弹窗/InPrivate = 环境项，不挡主站发布。

### 7.4 不在本轮用户端范围（避免散焦）

- 管理台本身（已签）只作 **工具配合**，不写进用户端通过准则  
- audit_focus A/B、VH 指纹 issue、扫描稳定性实验  
- 支付/多租户/私有仓支持（明确不支持即可）

## 8. developer 补充（实现视角）

> 基于当前 main：`projects/service.ts`、`scans/queue.ts`、`auth/*`、`notifications/routes.ts`、web `useAuth`/`VersionBar`/`ProjectPage`。

### 8.1 错误码 ↔ 前端映射（断言用）

| reason / 场景 | HTTP | 前端期望 |
|---|---|---|
| `login_required` | 401 | 引导登录，不白屏 |
| `repo_permission_denied` | 403 | 产品句（maintainer/admin），非裸 JSON |
| `submit_rate_limit` | 409 | 日提交上限（`SUBMIT_DAILY_LIMIT`，默认 10） |
| `scan_in_progress` | 409 | 已有进行中；文案含 Cancel or wait；**body 带 `state`**（含 `pending_review`） |
| `ref_not_found` | 400 | 版本输入框错误（非通用 toast 500） |
| `private_repo` | 400 | 仅 public |
| `invalid_github_url` | 400 | URL 校验 |
| cancel `try_later`（**dispatching**） | 409 | 「正在派发，稍后重试」——**窗口很短** |
| cancel `already_terminal` | 409 | 已结束不可取消 |
| GitHub/VH 上游失败 | 502 | 友好上游错误，非 500 栈 |

### 8.2 建议追加用例

#### F2 登录实现坑

| 用例 ID | 场景 | 步骤/期望 | P |
|---|---|---|---|
| **F2-07** | Cookie `SameSite=None; Secure` | 主站登录后 `/api/auth/me`；跨站场景（HF iframe） | 主站第一方 OK；第三方 cookie 被拦（InPrivate）时符合已知限制 | P0 |
| **F2-08** | HF 弹窗登录 | iframe 内 Sign in → `window.open` → 主域 callback → `postMessage` | opener 收到用户；iframe auth 刷新；关弹窗不卡死 | P0（测 HF 时） |
| **F2-09** | Popup 回调无 opener | 直接打开 popup-callback | 友好提示，无 JS 未捕获异常 | P1 |
| **F2-10** | OAuth state 伪造/过期 | 篡改/过期 `state` | 可读 OAuth 错误页，非 500 | P1 |

#### F3 提交实现细节

| 用例 ID | 场景 | 步骤/期望 | P |
|---|---|---|---|
| **F3-10** | `ref_not_found` | 指定 `no-such-ref-xyz` | **400** + 版本输入错误映射 | P0 |
| **F3-11** | 日提交限额 | 触达 `SUBMIT_DAILY_LIMIT`+1 | **409** `submit_rate_limit` | P1 |
| **F3-12** | 纯 SHA 作 ref | 7+ 或 40 位存在的 commit | `commit_sha` 锁定该 SHA | P1 |
| **F3-13** | `owner/repo` 短形式 | 无 `https://` | 与完整 URL 等价 | P1 |
| **F3-14** | `.git` 后缀 | `.../Hello-World.git` | 规范化成功 | P2 |

#### F4/F5 Cancel 状态机（实现）

| 用例 ID | 场景 | 步骤/期望 | P |
|---|---|---|---|
| **F4-07** | Cancel 在 **dispatching** | approve 后极短窗口 cancel | **409** `try_later`；稍后可 cancel | P1 |
| **F4-08** | Cancel 已 completed | 完成后打 cancel API | **409** `already_terminal` | P1 |
| **F4-09** | pending_review **也占**单进行中 | 已有 pending_review 再 submit | **409** `scan_in_progress`（state=pending_review）——与 queued/scanning 相同 | P0 |

> 实现注：`findInFlight` 含 `pending_review`；`markCancelled` 支持 pending_review/queued/scanning。

#### F6 通知与版本查询（矩阵原偏 UI）

| 用例 ID | 场景 | 步骤/期望 | P |
|---|---|---|---|
| **F6-11** | 通知列表 API/铃铛 | `GET /api/notifications` | shape 为 `notifications`（非 `items`）；未读字段正确 | P0 |
| **F6-12** | 通知已读 | `POST .../read` `{ids}`；`.../read-all` | 200；未读数下降 | P0 |
| **F6-13** | findings `?scan_job_id=` | 多版本拉历史 job | 返回该版本；缺省=current | P0 |
| **F6-14** | report-full 版本参数 | `?scan_job_id=` | 与 findings 版本一致 | P1 |

#### F8 / F9 实现约束

| 用例 ID | 场景 | 步骤/期望 | P |
|---|---|---|---|
| **F8-07** | 并发双 POST submit 同仓 | 几乎同时两请求 | ≤1 条 in-flight；另一 409/幂等；不双 pending | P1 |
| **F9-08** | 用户不可达 admin | 普通 session 调 `/api/admin/*` | **401** | P0 |
| **F9-09** | 用户不可改扫描参数 | 用户侧无 Settings | audit_focus/concurrency 仅 admin | P1 |

### 8.3 端点覆盖清单（防漏）

| 端点 | 用例 |
|---|---|
| `GET /api/auth/me` · login/callback · `POST logout` | F2 |
| `POST /api/projects`（submit） | F3 |
| `GET /api/projects` · `/:owner/:repo` | F1 |
| `GET .../findings[/:key]` · `?scan_job_id=` | F6/F7 |
| `GET .../scans` | F6-02 |
| `POST .../scan-jobs/:jid/cancel` | F4/F5 |
| `POST .../disclose` | F6-03 |
| `GET .../report-full` | F6-06 |
| `GET /api/my/projects` | F6-10 |
| `GET/POST /api/notifications` `/read` `/read-all` | F6-11/12 |
| `GET /api/stats` | F1-01 |
| `GET/POST /api/admin/*` 用户侧 | F9-08 必须 401 |

### 8.4 造数/清理（实现）

1. **pending_review 不自动派发**——「不进 Scanning」观察窗口可靠。  
2. opencode 等 **mock 多版本** 只适合 F6 版本/披露隔离，不当扫描质量验收。  
3. 清理：用户 Cancel → 管理台 **硬删** project（级联）；勿留 soft 残留。  
4. 真扫描：tiny 仓 + 低并发；若改 Settings 测完恢复。  
5. `dispatching` cancel 窗口极短，F4-07 可用 API 连打，不必强依赖 UI。

---

## 6. 修订记录

| 版本 | 说明 |
|---|---|
| v1 | qa 初稿：功能表 + 方法 + 双账号/fork 规划；待 pm/designer/developer 补场景后出 v2 再执行 |
| v1.1 | pm 产品补充：口径裁定 + F1/F3/F4/F5/F6/F7/F8/F9 增补用例与执行策略 |
| v1.2-dev | developer：错误码表、Cookie/HF 弹窗、ref_not_found/限额、Cancel 状态机（含 dispatching/pending_review 占槽）、通知 API、端点覆盖与造数注意 |
