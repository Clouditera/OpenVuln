# OpenVuln PRD

> 版本：v2.0（取代 v1.0）｜ 2025-08-02
> 决策来源：fish @ room OpenVuln（No.3–No.439）；文档反映**当前已实现并验收**的产品状态

## 1. 背景与定位

OpenVuln 是公益性开源项目漏洞披露平台（类比 OSS-Fuzz）。任何用户可提交开源项目，平台调用 VulnHunter 的 AI 扫描能力进行漏洞挖掘。漏洞详情**永不直接公开**：平台将详情**非对称加密存档**，由 OpenVuln 维护人员线下解密、私密送达项目维护者，经维护者确认后再由维护人员签名披露。

- **公众（匿名，无注册无登录）**：浏览项目、聚合统计、已披露漏洞摘要
- **平台维护人员**：通过本地 admin-cli（私钥）完成解密、送达、披露等全部管理操作

**战略目标**：借 OpenVuln 扩大 VulnHunter 引擎影响力。价值压在两头：VulnHunter 对接稳定性 + 前端数据展示表现力。品牌露出：footer「Powered by VulnHunter」、项目页「Scanned by VulnHunter AI engine」。

**展示诚实原则**：没有真实数据源就不展示（曾下架编造的 PoC 率、合成趋势图）；措辞克制（"Findings found"而非"confirmed"，最终认定权在项目维护者）。

## 2. 核心流程

1. 任意用户提交 GitHub URL → 校验（格式/public/非 fork 归并/未提交过）→ 入队
2. 队列按 **stars 降序 → 提交顺序** 派发；同时最多 **4** 个任务在 VH 执行（运行时可调）
3. 派发时绑定默认分支最新 commit；**现阶段一个项目只扫描一次**（冷却期 env 拉大实现，留扩展位）
4. 扫描中每 30s 轮询状态与发现计数；VH 正常 completed 后才同步结果
5. 同步时**过滤 + 加密**：只收 `item_type=finding`（risk 不收），title/路径/详情混合加密（OVENC1）入库；severity/CWE 明文用于统计
6. 维护人员本地 CLI 下载密文包 → 私钥解密 → 手动联系项目 maintainer 送达报告
7. maintainer 处理并二次确认后，维护人员**私钥签名披露指令**，服务器验签后公开该漏洞摘要

## 3. 公众视图（状态与数据口径）

**项目状态二值化**：公众只见 `completed` / `waiting`（queued/scanning/failed 统一归 waiting，失败不外露；内部/admin 保留细粒度状态机）。

**可见数据**：
- 项目元数据（名称/描述/语言/star/头像，GitHub API 快照）
- 扫描时间、commit SHA（链 GitHub）、默认分支
- severity 分布（**NVD 四档 critical/high/medium/low**，从 cvss_score 重映射；info 档不展示）
- CWE Top 分类（链 MITRE）
- 平台统计三项：**Projects scanned / Findings found / Findings disclosed**
- 事件信息流：New project / +N findings（扫描完成）/ Disclosed·severity（披露）
- 已披露漏洞：severity、title、CWE、披露日期（**不含路径/代码/描述**）+ 报告下载（Markdown/JSON/zip，单条+打包）

**红线**：公众 API 物理上不含单条漏洞详情与密文（enc_payload 字段都不出现）；service 进程无私钥、无解密函数（红线测试断言）。

## 4. 功能需求

### FR-1 项目提交（P0）
GitHub URL 提交；校验格式/public/非 fork/未提交过；五类内联错误文案；合法提交即入队并跳转项目页（waiting）。

### FR-2 扫描队列与执行（P0）
- 队列 = scan_jobs 表（重启不丢）；优先级 stars↓ → 提交先后
- 并发默认 4，`PUT /api/admin/scan-config` 运行时调整
- 创建任务参数（env 可配，fish No.362 定稿）：`scan_timeout=24h` + `timeout_mode=custom`、`max_items_per_recon=10`、`agent_max_parallel=5`、`audit_focus="全面扫描，确保高覆盖率和高 poc/exp 执行率"`、`enable_dynamic_verify=true`、`enable_dynamic_exploit=true`
- 稳定性：VH failed 宽限 3 次轮询才标死；dispatch 失败重试 3 次；VH 不可达指数退避（30s→5min）；admin `resync` 手动恢复通道
- 公众统计只认 `projects.current_scan_job_id`（最近 completed 扫描），重扫不翻倍；completed 同步事务化

### FR-3 漏洞获取与存档（P0）
- 过滤：`item_type=finding` 即收（poc_status 含 pending；risk 类型不收）
- severity：保留 VH 原始值 + cvss_score/vector；公众展示按 NVD 映射四档
- 加密：混合加密（RSA-4096-OAEP 包 AES-256-GCM，逐 finding 独立 DEK，OVENC1 信封，AAD 绑 finding.id）；severity/cwe 明文
- 重扫保留披露决策（按 finding_key 映射）

### FR-4 漏洞披露（运营驱动，P0）
- 管理通道：`ADMIN_TOKEN` Bearer 认证
- 报告包导出：`GET /api/admin/projects/:id/report-package`（密文，服务器自身不可读）
- 披露：`POST /api/admin/projects/:id/disclose`，需 **token + RSA-PSS 私钥签名**（±300s 窗口 + nonce 防重放 + finding 属本项目校验）；披露字段由签名指令带入，服务器从不解密
- 披露公开范围：severity/title/cwe/披露日期（无路径/代码）
- 不可逆；maintainer 联系与二次确认均为维护人员线下手动处理
- admin-cli：`keygen / fetch-package / decrypt / disclose`

### FR-5 平台管理（P1）
队列查看、失败重试、项目下架（removed_at）、并发调整、resync；均 ADMIN_TOKEN 保护。

## 5. 技术约束与部署

- 技术栈：Hono + React/Vite + PostgreSQL + pnpm monorepo（向 VulnHunter dev-guide 靠拢）
- **部署**：HF Static Space（前端）+ HF Docker Space（后端，单 Dockerfile）+ 外部 serverless PG（Neon/Supabase）+ 远端 VulnHunter（API Token）
- CORS 白名单（env）；私钥永不在任何部署环境
- VulnHunter 对接：Bearer API Token（issue #69 已落地）；无 webhook，30s 轮询

## 6. 待办与未来项

| # | 事项 | 状态 |
|---|---|---|
| 1 | HF 上线（fish 运维清单已交付） | 进行中 |
| 2 | 动态验证（PoC/EXP）实际生效验证 | 实测中（express 动态扫描） |
| 3 | poc/exp 产物收割入库（task-ab7b60af） | 进行中 |
| 4 | 重扫/版本更新策略（绑定 commit + 180 天锁定 + owner 归档） | fish 未定稿，现行为一项目一扫 |
| 5 | maintainer 无响应的处理（90 天保密期？） | 暂不考虑 |
| 6 | 「PoC-verified」公众展示（待动态验证数据真实存在后） | 未来 |
| 7 | owner 误报标记 | P2 |
| 8 | star/元数据定期刷新 | P2 |
| 9 | 界面语言（当前英文） | 未定 |
