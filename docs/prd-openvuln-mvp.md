# OpenVuln MVP PRD

> 状态：v1.0 — 待 fish 评审
> 决策来源：fish @ room OpenVuln No.3 / No.5 / No.11 / No.13 / No.14；调研：task-d905e3b6

## 1. 背景与定位

OpenVuln 是公益性开源项目漏洞披露平台（类比 OSS-Fuzz / OpenWiki）。任何用户可提交开源项目，平台调用 VulnHunter 的 AI 扫描能力进行漏洞挖掘，并将结果以分级可见的方式披露：

- **普通用户（匿名）**：浏览项目与统计信息
- **项目 owner（GitHub OAuth 验证）**：查看该项目漏洞详情

平台将在 Hugging Face 开源，并通过 HF Docker Spaces 部署（资源受限，架构需轻量）。

**战略目标**：借 OpenVuln 扩大核心引擎 VulnHunter 的影响力。业务流程简单，价值压在两头 —— VulnHunter 对接的稳定性 + 前端数据展示的表现力。具体含义：
- 全站统一「Powered by VulnHunter」品牌露出，扫描结果体现 AI 引擎能力
- 聚合统计要有洞察力（严重度分布、CWE 趋势、代表性项目），让访客直观感受引擎价值
- 保留向 VulnHunter 产品/文档/GitHub 的引流入口

## 2. 目标与非目标

### 目标（MVP）
- 用户提交 Git URL → 校验开放性 → 排队 → 扫描默认分支 → 结果入库披露
- 漏洞详情严格隔离，仅 owner 可见
- 面向公众的高质量 UI

### 非目标（MVP 不做）
- 用户注册/账号体系（仅 GitHub OAuth 登录用于 owner 验证）
- 非默认分支扫描、上传源码包
- GitLab/Gitee 等其他平台 owner 认证
- POC/EXP 展示

## 3. 用户场景

### 场景 A：匿名用户浏览
安全研究者小王打开 OpenVuln，首页看到已收录的开源项目列表及各自扫描状态、漏洞统计（按严重度聚合的数量）。他点击某项目，看到该项目概况页：扫描时间、commit、漏洞计数分布、CWE 类别分布。看不到任何单条漏洞的具体信息。

### 场景 B：用户提交项目
小王在提交页粘贴一个 GitHub 仓库 URL。平台校验：URL 格式合法 → 仓库存在且为 public → 未被提交过（或距上次扫描超过冷却期，TBD）。校验通过则进入待扫描队列，小王看到排队状态。校验失败给出具体原因。

### 场景 C：owner 查看详情
项目 maintainer 小李听说自己的项目在 OpenVuln 上有漏洞。他打开项目页，点击「Verify as owner」，跳转 GitHub OAuth 授权，平台验证其对该 repo 的权限（TBD：调研结论），通过后在该项目上获得 owner 视图：漏洞列表（标题、严重度、位置、描述、代码片段）。其他项目对他仍只显示统计信息。

### 场景 D：扫描完成与失败
扫描完成后项目页状态更新，统计信息公开可见。扫描失败（clone 失败、VulnHunter 异常）显示失败状态与可重试入口（谁可触发重试，TBD）。

## 4. 功能需求

### FR-1 项目提交
| 项 | 内容 |
|---|---|
| 入口 | 首页「Submit Project」 |
| 输入 | Git URL 文本框（仅支持 GitHub https URL，格式校验） |
| 校验 | ① 格式合法 ② 仓库存在且 public ③ 未被提交过（现阶段一个项目仅扫描一次） |
| 反馈 | 通过 → 跳转项目详情页（状态 queued）；失败 → 内联错误信息说明原因 |
| 优先级 | P0 |

验收标准：
- 提交非法 URL / 私有仓库 / 不存在仓库 / 重复提交，均有明确错误提示
- 合法提交后 5s 内出现在项目列表，状态为 queued
- 空输入、带 trailing slash、`.git` 后缀等变体均能正确处理（归一化）

### FR-2 扫描队列与执行
| 项 | 内容 |
|---|---|
| 行为 | 队列按提交顺序消费，经 `VulnHunterClient` 调用 VulnHunter 创建扫描任务（不传 branch，自动扫默认分支） |
| 状态机 | OpenVuln 侧：queued → scanning → completed / failed；VulnHunter 侧状态（preparing/running）映射为 scanning |
| 集成方式 | 见第 7 章集成架构 |
| 优先级 | P0 |

验收标准：
- 状态变化实时/准实时反映在项目页
- VulnHunter 侧任务失败能正确映射为 failed，且不泄露内部错误细节给公众
- 并发上限可配置（HF 资源受限）

### FR-3 项目列表与统计（公开）
| 项 | 内容 |
|---|---|
| 首页 | 项目卡片列表：名称、描述、语言、star 数（GitHub API）、扫描状态、漏洞计数（按严重度） |
| 项目页 | 扫描时间、扫描 commit SHA、漏洞计数分布（high/medium/low/info，对齐 VulnHunter severity 定义，无 critical）、CWE 类别分布 |
| 红线 | 不向匿名用户暴露任何单条漏洞的标题、文件路径、描述、代码 |
| 优先级 | P0 |

### FR-4 Owner 认证与详情视图
| 项 | 内容 |
|---|---|
| 登录 | GitHub OAuth App（scopes: `read:user, read:org, public_repo`），无注册流程 |
| 验证 | 回调后经 repo permissions API 校验，阈值 admin/maintain；授权结论落库（user_id ↔ repo_id ↔ role），用户 GitHub token 不落库 |
| 详情内容 | 漏洞列表：标题、严重度、CWE、文件路径+行号、描述、相关代码片段 |
| 会话 | 服务端 session（HttpOnly cookie，7 天滑动，可吊销）；登出后回到匿名视图 |
| 优先级 | P0 |

验收标准：
- 无权限用户（含登录但非 owner）访问详情接口返回 403
- write 权限协作者 MVP 阶段不通过验证（从严），UI 给出明确说明
- 组织项目 admin/maintain 成员均可验证通过；遇组织 OAuth 限制时 UI 引导组织管理员批准
- fork 项目归并到上游根仓库验证，fork 本身不可注册为项目
- 项目身份绑定数字 repo_id，改名/转移不影响授权

### FR-5 漏洞披露（owner 主导）
| 项 | 内容 |
|---|---|
| 默认状态 | 漏洞详情仅 owner 可见，公众仅见统计 |
| 主动披露 | owner 可选择性披露某一批漏洞：勾选若干条 → 「Disclose」→ 这些漏洞详情转为公众可见 |
| 被动披露 | 90 天保密期到期后自动公开（原型阶段仅预留状态字段，不做自动任务） |
| 优先级 | P1（原型先做主动披露的简化版） |

验收标准：
- 仅该项目的已验证 owner 可执行披露操作
- 已披露漏洞在项目页对匿名用户可见，且统计口径一致
- 披露操作不可逆（或撤销需二次确认，TBD）

### FR-6 平台管理（内部）
| 项 | 内容 |
|---|---|
| 能力 | 管理员（env 白名单）可查看队列、重试失败任务、下架项目（应对投诉/误收录） |
| 权限 | 管理员无需 owner grant 即可查看 findings 详情（内部运营需要：投诉核查、下架决策），此权限不对外暴露 |
| 形式 | 简单管理页或 CLI，TBD |
| 优先级 | P1 |

## 5. 技术约束

- 复用 VulnHunter 技术栈：Hono + React/Vite + PostgreSQL + pnpm monorepo
- 部署目标：HF Docker Spaces（单容器、资源有限）—— OpenVuln 自身尽量轻；扫描在远端 VulnHunter 实例执行；DB/存储方案 TBD（待 fish 确认 HF 可用资源）
- 未来可能归并到 VulnHunter 仓库，代码结构向其 dev-guide 规范靠拢

## 6. 集成架构（依据 task-d905e3b6 调研）

### VulnHunter 对接
- OpenVuln 后端封装 `VulnHunterClient`：`createTask(gitUrl) / getTask(id) / listFindings(id) / getFinding(id, key)`，凭证走环境变量
- **阻塞项**：VulnHunter 现有 API 仅支持 session cookie 认证，需其新增 Bearer API Token（issue 需求描述见调研文档 1.3 节，fish 负责提交）
- 过渡期：服务账户密码模拟登录持有 cookie 兜底，`VulnHunterClient` 封装为接口以便无缝切换
- 任务完成无 webhook，OpenVuln 侧 30~60s 轮询任务状态
- OpenVuln 侧服务账户需预配置默认 LLM 凭证，否则任务创建返回 400
- 队列与限流在 OpenVuln 侧，按 VulnHunter 容量匀速投递

### GitHub 对接
- 项目开放性校验、star 数、repo 元数据：GitHub REST API（可用匿名/服务端 token）
- Owner 验证：OAuth App + repo permissions API（详见 FR-4）

## 7. 待确认项（Open Questions）

| # | 问题 | 状态 |
|---|---|---|
| 1 | "无需注册" + GitHub OAuth 登录的理解是否正确 | ✅ fish 已确认（No.11），补充：owner 可选择性披露漏洞 |
| 2 | 公开统计的粒度（不含单条漏洞任何信息） | ✅ fish 已确认（No.11） |
| 3 | 重复扫描/版本更新策略 | ✅ 现阶段：一个项目只扫一次（env 冷却期拉大实现，保留扩展位）；未来方案（fish No.203，待最终确认）：派发时绑定默认分支最新 commit，180 天内不可再创建任务，除非 owner 执行归档操作 |
| 4 | HF Spaces 可用资源（外部 DB？持久卷？） | 待 fish 确认 |
| 5 | VulnHunter API 集成方式 | ✅ 已定（第 7 章），阻塞项为 API Token issue |
| 6 | GitHub owner 验证细节 | ✅ 已定（FR-4，admin/maintain 阈值） |
| 7 | 首版语言（英文/中英） | TBD |
| 8 | 失败任务重试入口的权限 | TBD |
