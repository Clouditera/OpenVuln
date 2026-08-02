# 前端展示数据审计（data audit）

> 2025-07-31 ｜ pm ｜ 起因：fish 要求梳理每个展示数据的价值、意义与数据源头
> 方法：逐页面盘点展示字段 → 对照后端 API 实现与数据来源 → 价值判断 → 处置建议

## 结论速览

| 级别 | 数据点 | 问题 |
|---|---|---|
| 🔴 伪造 | **PoC-verified %**（hero 统计第 3 项） | 后端用 disclosed 比率 +0.55 再 clamp 到 62%~95% 编造（stats/routes.ts poc_rate，注释自承"so the pulse looks healthy"） |
| 🟠 半真半假 | **30 天趋势图** | 有真实数据的天用真值，**没有数据的天用正弦波+噪声合成**（buildTrend 注释"synthetic wave so chart looks alive"） |
| 🟡 无信息量 | **AI-discovered badge**（项目页每条漏洞） | 全站漏洞都是 AI 发现的，badge 恒为真，等于没说 |
| 🟢 真实 | 其余全部（见下表） | — |

## 逐字段审计

### 首页 · Hero 区
| 展示数据 | 数据源 | 真实性 | 价值判断 | 处置 |
|---|---|---|---|---|
| Projects scanned | projects 表计数 | ✅ 真实 | 平台规模核心指标 | 保留 |
| Findings confirmed | findings 表计数 | ✅ 真实 | 引擎产出核心指标 | 保留 |
| **PoC-verified %** | **无源，后端编造** | 🔴 | 概念本身高价值（引擎差异化能力证据），但数字是假的 | **下架该统计，待接真实源后恢复**（见「PoC 真实化路径」） |
| CWE categories | findings 聚合 distinct cwe | ✅ 真实 | 覆盖面指标 | 保留 |

### 首页 · 事件信息流（EventTicker）
| 展示数据 | 数据源 | 真实性 | 价值判断 | 处置 |
|---|---|---|---|---|
| New project | projects.created_at | ✅ 真实 | 活跃感 | 保留 |
| +N findings | scan_jobs+findings 关联 | ✅ 真实 | 引擎产出节奏 | 保留 |
| Disclosed · severity | findings.disclosed_at | ✅ 真实 | 披露动态（owner 信任建立） | 保留 |

### 首页 · 项目列表
| 展示数据 | 数据源 | 真实性 | 价值判断 | 处置 |
|---|---|---|---|---|
| 名称/描述/语言/star | GitHub API（提交时快照） | ✅ 真实（会过期） | 项目识别 | 保留；star 过期可接受，后续加定期刷新 |
| owner 头像 | github.com/{owner}.png | ✅ 真实 | 识别 | 保留 |
| 扫描状态/时间 | scan_jobs | ✅ 真实 | 核心状态 | 保留 |
| SeverityBar + 四档计数 | findings 聚合 | ✅ 真实 | 核心风险概览 | 保留 |

### 项目页 · Overview
| 展示数据 | 数据源 | 真实性 | 价值判断 | 处置 |
|---|---|---|---|---|
| 扫描状态带 + commit SHA | scan_jobs.commit_sha | ✅ 真实 | 可追溯性 | 保留 |
| "Scanned by VulnHunter AI engine" | 静态文案 | — | 品牌露出 | 保留 |
| severity 分布条 | findings 聚合 | ✅ 真实 | 核心 | 保留 |
| Top CWE categories | findings 聚合 + 内置 CWE 名称表 | ✅ 真实（名称为静态映射，可接受） | 漏洞画像 | 保留 |
| **AI-discovered badge** | 无区分度 | 🟡 | 恒真 = 无信息量 | **删除**；恢复时换「PoC-verified」（有真实 poc 产物才显示） |
| Disclosed findings 列表 | findings(disclosed) | ✅ 真实 | 核心功能 | 保留 |
| Scan history + delta | 未实现 | — | 一项目一扫策略下无意义 | **从设计稿移除** |

### 演示种子数据说明
当前 40 个 mock 项目的 star/描述/findings 是种子编造的 —— 这是**演示数据**而非产品逻辑问题，接真实 VH 后重灌即可。但真实提交的链路（GitHub API 拉真实元数据）已验证是通的。

## PoC-verified 真实化路径（高价值，建议做）

VH 侧 poc/exp 产物本就存在（调研已确认 artifacts API 可拉）。真实化 = 已有任务的产物收割（task-ab7b60af）落地后：
1. `finding_artifacts` 表有 poc 类文件 ⇒ 该 finding 标记 `poc_verified`
2. 统计接口 poc_rate 改为真实比率（无数据时前端**不显示**该项，不编兜底数字）
3. 漏洞行恢复 badge，文案「PoC-verified」（仅真实有的才显示）

## 处置任务清单

| # | 事项 | 负责 | 优先级 |
|---|---|---|---|
| 1 | 后端 poc_rate 停止编造：无真实源时接口不返回该字段 | developer | P0 |
| 2 | 趋势图去掉合成波：无数据的天显示 0（诚实但"难看"是早期真实状态） | developer | P0 |
| 3 | 前端：poc_rate 缺失时 HeroStats 只显示 3 项；删 AI-discovered badge | designer | P0 |
| 4 | 设计稿移除 Scan history（与一项目一扫策略冲突） | designer | P1 |
| 5 | PoC-verified 真实化（依赖 task-ab7b60af 产物收割） | developer | P1 |
