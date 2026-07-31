# OpenVuln 原型 UI 设计方案

> 任务：task-7954ee03 ｜ 设计：designer ｜ 2025-07-30 ｜ **v1.8（fish：翻页迁移 Swiper 14（vertical + mousewheel/keyboard/pagination 模块，transform 硬件加速，弃用手写 scroll-jacking）；EventTicker 去边框改左右透明渐变 mask；Pulse 与项目列表合并为同一页（上趋势固定 + 下列表 swiper-no-mousewheel 内滚）—— deck 定稿两页：欢迎 / 趋势+列表）。v1.7（滚轮驱动翻页 + EventTicker）。v1.6（PPT 式滑动翻页 —— 首页为 scroll-snap 三页 deck：① 欢迎 hero ② Pulse 趋势（浅色化，原深蓝整页突兀废弃）③ 项目列表；右侧圆点导航 + 首页 ChevronDown 提示；新增「New findings 事件卡」（scan_completed "+N" 计数章 + disclosed SeverityChip 行）；/pulse 路由移除重定向首页；Button 高度收敛为 size prop 修复输入框/按钮中线对齐）。此前：v1.5 Clouditera 规范落地**。
> 依据：PRD v1.0（docs/prd-openvuln-mvp.md）、调研文档（docs/research-vulnhunter-api-and-github-owner-auth.md）
> 技术栈：React 18 + Vite + Tailwind CSS 3.4 + react-router 6 + @tanstack/react-query（与 VulnHunter web 包对齐），新增依赖仅 `lucide-react`（图标）
> 界面语言：**英文优先**（面向国际开源社区，待 fish 最终确认）

---

## 1. 设计目标

PRD 把价值压在两头，UI 侧承接的是**展示面的表现力**：

1. **可信**：访客第一眼相信这是严肃的安全披露平台（参考 OSS-Fuzz / GitHub Security Advisory 的信息密度与克制感）
2. **有洞察力**：聚合统计让人直观感受到「这个引擎能挖到真东西」，不是计数器堆砌
3. **品牌转化**：全站一致的「Powered by VulnHunter」露出，把扫描结果变成引擎能力的活招牌
4. **边界清晰**：公众视图与 owner 视图的隔离感要可视化，红线（不泄露单条漏洞信息）体现在数据契约而非仅靠前端隐藏

## 2. 视觉方向

### 2.1 风格关键词

**`Editorial security`** ：文档感、数据密度、克制。像一份排版精良的安全公告，而不是 SaaS 营销页，也不是黑客终端风。**公益气质参照 accesswiki.net（fish 指定）**：暖纸底、衬线展示字体、百科式 section 结构 —— 「温暖的知识平台」与「深色任务控制带」共存。

反模式明确不做：暗色黑客风（品类第一反应）、渐变大字 hero、卡片海、玻璃拟态。（居中 hero 排版骨架由 fish 依 accesswiki 指定，v1.4 起为正式方向，不再列为反模式）

### 2.2 主题决策：亮色

场景句：「安全研究者在明亮的办公室里，27 寸显示器上交叉比对多个项目的漏洞分布，需要长时间阅读描述与代码；maintainer 在手机上快速查看自己项目的扫描结果。」

亮色为主：长时间阅读友好、与参考产品（OSS-Fuzz、GHSA）一致、公众信任感强。Token 结构预留暗色扩展，原型不实现。

### 2.3 色彩

策略：**Restrained + 克制**（fish：字体颜色、突出效果要克制）。v1.5 起全站色彩以 **Clouditera 设计规范**（fish 提供）为准：主色蓝 `#298CFF`，暖纸/衬线/violet 方案废弃。

**主色（Blue）**：B4 `#298CFF` 主色（主按钮/链接/选中），B5 `#1871F5` hover，B6 `#145BE1` 点击，B2 `#D4E8FF` 底色，B3 `#A9D1FF` 边框，B1 `#EEF7FF` 禁用。**蓝色只用于交互**，不做装饰性强调（H1 不设彩色 span、区块标签不用蓝色）。

| Token | Hex | 用途 |
|---|---|---|
| `surface` | `#FFFFFF` (N1) | 页面底色 |
| `surface-header` | `#F8FAFE` (N2) | 标题栏 BG |
| `surface-sunken` | `#F8F8F8` (N3) | 代码块底 |
| `line` | `#E7E8EB` (N5) | 全部 1px 分隔 |
| `ink` | `#0A1730` (B7) | 主文字 |
| `ink-secondary` | `#616D7E` (N9) | 次要文字 |
| `ink-tertiary` | `#BBC3CC` (N7) | 占位、辅助 |

**Severity 语义层 = 规范功能色**（badge = 10% 底 + 深色文字；条 = 本色）：

| Severity | 文字 | Badge 底色 | 条形填充 |
|---|---|---|---|
| High | `#C22828` | `#FEEDED` | `#F24F4F`（高危） |
| Medium | `#C24E0E` | `#FFF1EB` | `#FF733C`（中危） |
| Low | `#8A6D0B` | `#FEF9EA` | `#F7C530`（低危） |
| Info | `#616D7E` | `#F8F9FA` | `#BBC3CC`（中性） |

**其他功能色**：成功 `#3AD186`、进行中 `#28D1FF`（scanning 专用）、**AI 特殊紫 `#9285FF`**（AI-discovered/verified badge 专用，规范 P4）。

**状态色**：success `#15803D`、danger `#B91C1C`、warning `#B45309`。扫描中状态用 accent violet 而非绿色（绿色留给「已完成/已验证」）。

对比度：所有文字组合 ≥ 4.5:1（上表已按此配对）；severity 不作为唯一信息通道（永远伴随文字标签或图标）。

### 2.4 字体

v1.5 起按 Clouditera 规范：**英文 Roboto（400/500/700），中文思源黑体**（系统回退链承载：Source Han Sans SC / PingFang SC / Microsoft YaHei；UI 英文优先）。衬线方案废弃，标题靠字重（500/700）与字号分层，不靠字族对比。

| 层级 | 规格 |
| 层级 | 规格 |
|---|---|
| 首页 H1 | Roboto 700，clamp(2.4rem, 5.5vw, 3.4rem)（规范 34px 首页标题上限扩展） |
| 页面标题 | Roboto 500 24px |
| 区块标题 | Roboto 500 20px |
| 正文/表格 | Roboto 14px / 400（规范：80% 文字 14px） |
| Meta/辅助 | 13px / 400 |
| 标签/badge | 12px / 500–600 |

**Section 头结构**（吸收 accesswiki 的 Explore/Why 模式）：每个内容区块 = 上行 section-label（mono `text-[11px] uppercase tracking-wider text-ink-tertiary`，**中性色不用蓝**，如 `EXPLORE`）+ 下行区块标题（Roboto 500）。

正文行长上限 70ch（漏洞描述等长文 `max-w-prose`）。

### 2.5 栅格、间距、圆角、海拔

- 内容容器 `max-w-6xl`（1152px）居中，左右 24px 安全边距；项目详情等数据页可用满宽
- 间距节奏：区块间 32/48px，卡片内 16/20px，表格行高 44px（密度优先但不拥挤）
- 圆角：面板/卡片 `8px`（`rounded-lg`，暖纸调下稍软），控件/输入框/按钮保持 `6px`（`rounded-md`），badge/chip 全圆角 `rounded-full`
- **边框优先于阴影**：可信度来自 1px `line` 分隔的文档感。阴影仅用于浮层（dropdown、dialog）：`shadow-lg` 一档，不叠加

### 2.6 图标

`lucide-react`，统一 16px（导航/按钮内）与 14px（表格内），strokeWidth 2。severity 用形状+颜色双编码：High `OctagonAlert`、Medium `TriangleAlert`、Low `CircleAlert`、Info `Info`。

### 2.7 动效

150–250ms，`ease-out`。只表达状态：hover 底色、扫描中状态点的呼吸脉冲（`animate-pulse` 级别的克制版）、skeleton 加载、disclose 成功后的行内确认。无页面载入编排、无滚动触发动画。

## 3. 信息架构与路由

| 路由 | 页面 | 可见性 |
|---|---|---|
| `/` | 首页（平台脉搏 + 项目列表） | 公开 |
| `/submit` | 提交项目 | 公开 |
| `/p/:owner/:repo` | 项目详情（Overview tab） | 公开（聚合统计） |
| `/p/:owner/:repo?tab=findings` | 漏洞列表 tab | **仅 owner**（未验证显示引导） |
| `/p/:owner/:repo/findings/:key` | 单条漏洞详情 | 仅 owner（已 disclose 的条目公开） |
| `/auth/callback` | OAuth 结果状态页 | 流程页 |
| `/about` | 平台与引擎介绍 | 公开，P1（可先并入首页页脚链接） |

无注册/登录页：唯一的「登录」动作是项目页上的「Verify as owner」GitHub OAuth。

**数据契约红线（给 developer）**：`/api/public/*` 端点只返回聚合数据（计数、分布），单条漏洞的 title/path/description/code 只允许出现在 `/api/owner/*` 下。前端公众视图不接触敏感字段，不靠「前端不渲染」来保密。

## 4. 全局布局

```
┌──────────────────────────────────────────────────────────────┐
│ OpenVuln▪        Projects            Submit Project  [GitHub]│ ← topbar 56px
├──────────────────────────────────────────────────────────────┤
│                         页面内容                              │
├──────────────────────────────────────────────────────────────┤
│ Powered by VulnHunter · VulnHunter GitHub · Docs · About     │ ← footer
└──────────────────────────────────────────────────────────────┘
```

**Topbar**（`h-14 border-b border-line bg-surface-raised`）：
- 左：wordmark「OpenVuln」Roboto 700 17px **纯 ink 单色**（克制：不设彩色部分）；hover 回首页
- 中：导航两项「Projects」（/）与「Pulse」（/pulse，v1.5 仪表盘独立成页）；选中态 B1 底 + B5 字
- 右：**仅 GitHub 图标按钮**（链接 OpenVuln 自身 repo，env `VITE_GITHUB_REPO_URL` 缺省回退占位地址）。**v1.5 fish 决策：OpenVuln 无注册/登录概念 —— topbar 不放 Submit 按钮（首页 hero 输入框即提交入口）、不放 Sign in；owner 验证入口只在项目页上下文出现（Verify as owner）**

**Footer**（`border-t`，13px secondary 文字）：
- 「Powered by **VulnHunter**」固定左置，链接至 VulnHunter 官网/GitHub（引流闭环）
- 右置：VulnHunter GitHub、Docs、About、（预留）Responsible Disclosure Policy

**品牌露出三处**（不多不少）：footer 全局一处；项目页扫描元信息行「Scanned by VulnHunter AI engine」；已验证漏洞上的「AI-verified」badge。扫描结果页是转化点，文案落在这里。

## 5. 设计 Token（Tailwind 配置）

```js
// tailwind.config.js — theme.extend
colors: {
  surface: { DEFAULT: '#F8F6F1', raised: '#FFFDF8', sunken: '#F0EBE0' },
  line: '#DDD6C6',
  ink: { DEFAULT: '#211E16', secondary: '#5C564A', tertiary: '#857E6E' },
  accent: { 50: '#F5F3FF', 100: '#EDE9FE', 600: '#6D28D9', 700: '#5B21B6' },
  sev: {
    high:   { ink: '#991B1B', bg: '#FAEEEB', bar: '#DC2626' },
    medium: { ink: '#9A3412', bg: '#FBF3E3', bar: '#F97316' },
    low:    { ink: '#854D0E', bg: '#FAF5DA', bar: '#EAB308' },
    info:   { ink: '#3F3F46', bg: '#F1EFEA', bar: '#A1A1AA' },
  },
  // 仪表盘深色带（§7.1.1 专用，不用于其他页面）—— 暖墨黑，与暖纸构成「纸上油墨」
  pulse: {
    bg: '#1B1812', panel: '#25211A', line: '#3A342A',
    ink: '#F5F0E6', secondary: '#B0A894',
  },
  'sev-dark': { high: '#EF4444', medium: '#FB923C', low: '#FACC15', info: '#A1A1AA' },
  'accent-dark': '#C4B5FD',  // 深底上的链接/箭头
  success: '#15803D', danger: '#B91C1C', warning: '#B45309',
},
fontFamily: {
  display: ['"Source Serif 4"', 'Georgia', 'serif'],
  sans: ['"DM Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
},
```

## 6. 核心组件

### 6.1 Button

四档：`primary`（accent-600 填充，白字，每屏最多一个主按钮）、`secondary`（1px line 边框 + ink 文字）、`ghost`（无边框，图标按钮）、`danger`（danger 填充，仅 Disclose 确认等不可逆操作）。统一 `h-9 px-3.5 rounded-md text-sm font-medium`，focus-visible 一律 `ring-2 ring-accent-600 ring-offset-2`。

### 6.2 SeverityChip

形状+颜色双编码，永不裸色：

```tsx
<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5
                 text-xs font-medium bg-sev-high-bg text-sev-high-ink">
  <OctagonAlert size={12} strokeWidth={2} /> High
</span>
```

### 6.3 SeverityBar（核心视觉资产）

堆叠分布条，首页行内与项目页共用，是「洞察力」的主载体：

```tsx
// 比例堆叠条 + 图例计数；0 计数分段不渲染
<div className="flex h-1.5 w-40 overflow-hidden rounded-full bg-surface-sunken">
  {segs.map(s => (
    <div key={s.level} className="h-full" style={{
      width: `${s.pct}%`, backgroundColor: `var(--sev-bar-${s.level})` }} />
  ))}
</div>
// 图例: ● 3  ● 12  ● 40  ● 8  (12px mono, 各段色点 + 计数)
```

### 6.4 StatusBadge

| 状态 | 视觉 |
|---|---|
| Queued | 灰底 + `Clock` 图标 +「Queued #3 in line」 |
| Scanning | accent-50 底 + accent-600 文字 + 呼吸圆点 +「Scanning · 12m elapsed」 |
| Completed | 绿字 + `CheckCircle2` +「Scanned 2d ago」 |
| Failed | danger 文字 + `XCircle` +「Scan failed」 |

### 6.5 AI-verified Badge

`Sparkles` 图标 +「AI-verified」+ accent-600 描边样式。出现在已验证漏洞与项目统计行，是引擎能力的直接证据点。

### 6.6 Table

行高 44px，`border-b border-line`，表头 12px uppercase secondary，hover 行 `bg-accent-50/40`，无竖线、无斑马纹（文档感靠留白与分隔线）。加载用 skeleton 行（灰条呼吸），禁用居中 spinner。

### 6.7 Dialog（唯一模态场景）

仅用于 **Disclose 确认**（不可逆操作，符合模态的正当用途）。其余场景一律内联/页面级状态。

### 6.8 EmptyState

插画免用。图标 32px tertiary + 一句说明 + 一个动作按钮。文案教学化，见各页 copy。

## 7. 页面详设

### 7.1 首页 `/`

```
┌──────────────────────────────────────────────────────────────┐
│ OpenVuln▪        Projects      Submit Project  [GH] Sign in  │
├──────────────────────────────────────────────────────────────┤
│        Continuous AI vulnerability discovery    （居中 serif │
│                  for open source.                 H1，accent │
│                                                span 强调短语）│
│   OpenVuln is a public security service. Submit any public   │ ← sub text-base
│   GitHub project: the VulnHunter AI engine scans ...         │   secondary 居中
│                                                              │
│      ┌────────────────────────────────┐ ┌──────────┐         │ ← repo 输入框
│      │ https://github.com/owner/repo  │ │  Submit  │         │   h-12 居中
│      └────────────────────────────────┘ └──────────┘         │
│      We scan the default branch and publish statistics.      │ ← helper/内联错误
│                                                              │
│         312             1,847            86%          43     │ ← stats row
│    PROJECTS SCANNED   FINDINGS      POC-VERIFIED    CWES     │   serif 数字居中
├──────────────────────────────────────────────────────────────┤
│■■ The Pulse 深色带（纯数据带，见 §7.1.1）■■■■■■■■■■■■■■■■■│
├──────────────────────────────────────────────────────────────┤
│  EXPLORE                                                     │ ← section-label
│  Representative projects                     Sort: Stars ▾   │ ← serif 标题
│  [ Search projects... ]   Status ▾                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ⬤ facebook/react                            ● Completed│  │
│  │   A JavaScript library for building user interfaces    │  │
│  │   ● TypeScript · ★ 228k · scanned 2d ago               │  │
│  │   ▰▰▰▰▰▱▱▱▱▱  ● 3 High  ● 12 Medium  ● 40 Low  ● 8 Info │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ ...（行高 88px，整行即点击目标，行间 1px 线）           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                    ← 1 2 3 ... 14 →          │
├──────────────────────────────────────────────────────────────┤
│ Powered by VulnHunter · GitHub · Docs · About                │
└──────────────────────────────────────────────────────────────┘
```

**结构要点**：
- **Hero 居中三层（v1.4 fish 指定，accesswiki 排版骨架）**：① Roboto 700 H1 `clamp(2.4rem, 5.5vw, 3.4rem)`，**纯 ink 无彩色 span（v1.5 克制）**② subline `text-base` secondary `max-w-2xl` 居中，一句说清理念 ③ **repo 输入框**（首页即提交入口，与 /submit 页共用 `RepoSubmitForm` 组件）：`h-12 rounded-lg` mono 输入 + primary 按钮 `h-12`，下方 helper 一行，校验错误内联（文案同 §7.2 错误表）；④ **stats row**：4 项居中 `gap-12 flex-wrap`，serif 700 数字（1.8rem，tabular-nums，count-up 600ms 一次性）+ 12px uppercase secondary 标签
- **v1.6 PPT 式翻页**：首页为 `snap-y snap-mandatory` 三页 deck（容器 `h-[calc(100vh-3.5rem)]`）：① 欢迎 hero ② Pulse 趋势（**浅色** `bg-surface-header`，v1.5 深蓝整页被 fish 判为突兀，废弃；藏青 #1B2033 暂存 token 备用）③ 项目列表。右侧圆点导航（IntersectionObserver 追踪激活页），首页底部 ChevronDown 滚动提示，页尾内嵌第三页末尾（全局 footer 首页隐藏）
- **代表项目列表**：section-label `EXPLORE` + serif 标题 `Representative projects`；**默认排序 Stars 降序（fish 指定）**，备选 Recently scanned / Most findings；行内新增 **owner 头像**（32px `rounded-full`，`https://github.com/{owner}.png?size=64`，加载失败回退字母块 `bg-accent-50 text-accent-700` 首字母）；其余行结构不变（名称/描述/meta/SeverityBar/状态 badge）
- 筛选、搜索防抖、分页 20/页、skeleton 行均不变；scanning 行 SeverityBar 区域仍替换为 skeleton

**空状态（平台无任何项目）**：`ShieldSearch` 图标 +「No projects yet.」+「Submit the first open-source project to be scanned by VulnHunter.」+ primary CTA。

**Copy deck**：
- H1：`Continuous AI vulnerability discovery for open source.`（纯 ink，v1.5 起无 accent span）
- 副句：`OpenVuln is a public security service. Submit any public GitHub project: the VulnHunter AI engine scans the default branch, verifies findings with automated PoC, and discloses them to verified maintainers first.`
- 输入框占位：`https://github.com/owner/repo`；helper：`We scan the default branch and publish aggregate statistics. Detailed findings stay maintainer-only.`
- stats 标签：`PROJECTS SCANNED` / `FINDINGS CONFIRMED` / `POC-VERIFIED` / `CWE CATEGORIES`
- 列表区：label `EXPLORE`，标题 `Representative projects`
- 搜索占位：`Search projects...`

### 7.1.1 平台仪表盘「The Pulse」→ 独立路由 `/pulse`（v1.5：全页深色面，藏青 `#1B2033` = 规范 N10；链接/箭头用 `#28D1FF`；其余结构与下述一致）

目标：平台实时态势的可视化证据带（v1.4 起「OpenVuln 是什么」由上方浅色 hero 承担，本带只留数据，不再重复）。**全宽深色任务控制带**嵌在浅色文档页中，靠功能对比（实时数据 vs 文档列表）和数据可视化密度制造冲击，不用渐变字/玻璃拟态。

```
┌────────────────────────────────────────────────────────────────────┐
│■■ 深色带全宽（bg-pulse-bg + 点阵纹理，py-8） ■■■■■■■■■■■■■■■■■■■│
│                                                                    │
│  PLATFORM PULSE  ·  LIVE                                           │ ← eyebrow mono 12px
│                                                                    │
│  ┌──────────────────────────────────┐ ┌──────────────────────────┐ │
│  │ FINDINGS · LAST 30 DAYS    1,847 │ │ LIVE NOW                 │ │
│  │          ╭─╮                     │ │ ● 3 scanning · 7 queued  │ │
│  │      ╭───╯  ╰──╮   堆叠面积图   │ │ ◉ facebook/react   12m   │ │
│  │   ╭──╯         ╰──╮             │ │ ◉ gin-gonic/gin     4m   │ │
│  │ ──╯──────────────╯──            │ │ ◉ fastapi           1m   │ │
│  │ ●High 312 ●Med 586 ●Low 743 ●Info 206 │ └──────────────────────────┘ │
│  └──────────────────────────────────┘                                │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ TOP CWE                          （桌面 2 列×4 行）          │    │
│  │ CWE-79  XSS            ▰▰▰▰▰▰ 214   CWE-89  SQLi   ▰▰▰▰ 156 │    │
│  │ CWE-22  Path Traversal ▰▰▰  118     ...                      │    │
│  └────────────────────────────────────────────────────────────┘    │
│  RECENT ▸ 2m ago · scan completed · facebook/react · +3 high  ·    │ ← mono 12px 单行
│           26m ago · project submitted · gin-gonic/gin  ·  1h ago ...│
├────────────────────────────────────────────────────────────────────┤
│ 浅色区：EXPLORE + 代表项目列表（§7.1）                               │
└────────────────────────────────────────────────────────────────────┘
```

**视觉规格**：
- 带底色 `pulse.bg #1B1812`（暖墨黑），面板 `pulse.panel #25211A` + 1px `pulse.line #3A342A`，面板圆角 `rounded-lg`（8px）；文字 `pulse.ink #F5F0E6`（暖白）/ `pulse.secondary #B0A894`
- 点阵纹理（CSS 纯实现，无图片）：`background-image: radial-gradient(circle, rgb(245 240 230 / 0.05) 1px, transparent 1px); background-size: 24px 24px`
- 面板是非对称数据区（7+5 / 12 栅格），不是等大卡片网格；顶部明暗切边直切，不做渐变过渡
- 深底 severity 色用 `sev-dark` 组（更亮）：high `#EF4444` / medium `#FB923C` / low `#FACC15` / info `#A1A1AA`；CWE 横条用 `accent-400 #A78BFA`（与 severity 区分）

**两个可视化**（平台总量统计 projects/findings/PoC/CWEs 自 v1.4 上移至首页 hero stats row，serif 数字，带内不再重复）：
1. **Findings 趋势（主视觉）**：30 天堆叠面积图，纯手写 SVG（不引图表库），viewBox `0 0 560 180`。4 层面积按 high→medium→low→info 自顶向下堆叠，填充 55% 透明 + 描边 1.5px 不透明；high 层描边带微光 `filter: drop-shadow(0 0 6px rgb(239 68 68 / 0.3))`。3 条横向网格线（白 6%），X 轴每 7 天一个 mono 10px 日期刻度，无 Y 轴数字。图例在图下方：色点 + 标签 + 该档总数（mono）。`role="img"` + `aria-label` + sr-only 数据摘要
2. **TOP CWE**：8 行横条（桌面 grid-cols-2），`CWE-79` mono + 名称截断 + 归一条 + 计数 mono，链 MITRE

**LIVE NOW 面板**：
- 头部：`● 3 scanning · 7 queued`（圆点 `emerald-400 #34D399` + 呼吸；深底上 success `#15803D` 过暗，v1.3 走查确认的刻意偏差）
- 列表至多 3 条：脉冲圆点（双层：6px 实心 + 扩散环，自定义 keyframes 1.6s）+ 项目名 + 已耗时 mono；queued 只显示计数不列名
- 无扫描时显示 `Idle · queue empty`，保持面板不塌

**动效**（全部一次性/状态性，尊重 prefers-reduced-motion）：
- 面积图挂载时描边 draw-in（stroke-dasharray 动画 900ms ease-out）+ 填充 400ms 淡入
- hero stats 数字 count-up 600ms（rAF 小 hook，reduced-motion 直接终值；v1.4 自 ENGINE 移至 hero）
- LIVE 脉冲环无限循环（reduced-motion 下静态圆点）
- 无滚动触发动画、无载入编排

**响应式**：
- <1024px：趋势图满宽，LIVE 其下，CWE 单列 8 行
- <640px：RECENT 行横向滚动不折行；hero stats row 折为 2×2

**空态**（全新部署无数据）：面积图显示零线 + 居中 `Awaiting first scans`（secondary），其余面板显示 0/Idle，整体仍然成立

**数据契约**：全部来自 `/api/stats/overview`（公众聚合），建议响应含 `trend: [{date, high, medium, low, info}×30]`、`totals`、`pocRate`、`cweTop8`、`live: {scanning: [{name, elapsedSec}], queuedCount}`、`recent: [{ts, type, text}]`。developer 可自行裁剪，mock 阶段用确定性伪随机生成 30 天趋势

**Copy**：
- eyebrow：`PLATFORM PULSE`；H1：`Continuous AI vulnerability discovery for open source.`
- sub：`Submit any public GitHub project. The VulnHunter engine scans the default branch, verifies findings with automated PoC, and discloses them to verified maintainers first.`
- 步骤行：`submit a repo → AI scans & verifies → maintainers disclose`

**参考实现**（堆叠面积路径生成，~25 行）：

```tsx
type Pt = { date: string; high: number; medium: number; low: number; info: number };
function stackedAreas(data: Pt[], w = 560, h = 180) {
  const keys = ['high', 'medium', 'low', 'info'] as const;
  const max = Math.max(...data.map(d => d.high + d.medium + d.low + d.info), 1);
  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => h - (v / max) * (h - 16);
  let acc = data.map(() => 0);
  return keys.map(k => {
    const top = data.map((d, i) => [x(i), y(acc[i] += d[k])] as const);
    const base = data.map((d, i) => [x(i), y(acc[i] - d[k])] as const).reverse();
    const line = top.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const area = `${line}${base.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}Z`;
    return { key: k, area, line };
  });
}
// 渲染：先 <path d={area} fill={sevDark[key]} fillOpacity={0.55} />
// 再 <path d={line} fill="none" stroke={sevDark[key]} strokeWidth={1.5} />
```

### 7.2 提交页 `/submit`

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Submit a project                                            │
│  Paste a public GitHub repository URL. We scan the default   │
│  branch and publish aggregate statistics.                    │
│                                                              │
│  ┌────────────────────────────────────┐ ┌────────┐           │
│  │ https://github.com/owner/repo      │ │ Submit │           │
│  └────────────────────────────────────┘ └────────┘           │
│  ⓘ This repository is private or does not exist.             │ ← 内联错误
│                                                              │
│  What happens next                                           │
│  1  We verify the repository is public and not a fork        │
│  2  It enters the scan queue                                 │
│  3  VulnHunter scans the default branch                      │
│  4  Aggregate statistics go public; details stay owner-only  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**结构要点**：
- 本页表单与首页 hero 输入框为同一组件 `RepoSubmitForm`（v1.4）：校验逻辑、错误文案、提交成功跳转全部共享，本页保留独立路由供分享/深链
- 独立页面而非 modal：可分享链接、校验状态有完整展示空间。单字段表单，`h-11` 大输入框（mono 字体提示 URL 属性），primary 按钮同行
- 校验反馈全部**内联**（`text-danger text-sm` + `CircleAlert` 图标，输入框边框转 danger），逐条覆盖 PRD 验收标准
- 「What happens next」用编号列表（mono 序号），不是图标卡片网格：建立流程信任，也自然植入 VulnHunter 名字
- 提交成功 → 直接跳项目页（状态 queued），页面顶部一次性 banner：「Added to the scan queue.」

**错误文案（精确到条）**：

| 场景 | 文案 |
|---|---|
| 格式错误 | `That doesn't look like a GitHub repository URL. Expected: https://github.com/owner/repo` |
| 私有/不存在 | `This repository is private or does not exist. OpenVuln scans public projects only.` |
| 是 fork | `Forks are attributed to their upstream repository. View {upstream} instead.`（附链接） |
| 已存在 | `This project is already on OpenVuln. View project →` |
| 冷却期 | `This project was scanned recently. You can resubmit after {date}.` |

### 7.3 项目页 · 公众视图 `/p/:owner/:repo`

```
┌──────────────────────────────────────────────────────────────┐
│ ← Projects                                                   │
│                                                              │
│  facebook / react          ↗ GitHub        [ Verify as owner ]│ ← secondary 按钮
│  A JavaScript library for building user interfaces           │
│  ● TypeScript · ★ 228k · Added Jul 1, 2025                   │
│                                                              │
│  Overview │ Findings 🔒                                       │ ← tab；🔒 提示锁定
├──────────────────────────────────────────────────────────────┤
│  ● Scan completed · Jul 29, 2025 · commit a1b2c3d ↗          │
│  Scanned by VulnHunter AI engine · default branch (main)     │ ← 品牌露点 ②
├──────────────────────────────────────────────────────────────┤
│  Findings overview                                           │
│                                                              │
│  63 confirmed findings · 52 AI-verified by automated PoC ✦   │ ← 洞察，非计数器
│  ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  （全宽 SeverityBar，h-2）               │
│  ● 3 High   ● 12 Medium   ● 40 Low   ● 8 Info                │
│                                                              │
│  Top CWE categories                    （横向条列表，Top 5）  │
│  CWE-79  Cross-site Scripting        ▰▰▰▰▰▰▰▱ 18             │
│  CWE-89  SQL Injection               ▰▰▰▰▱▱▱▱ 11             │
│  CWE-22  Path Traversal              ▰▰▰▱▱▱▱▱  8             │
│  ...                                  View all 14 →           │ ← 展开内联，不跳转
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 🔒 Detailed findings are visible to verified project   │  │
│  │ maintainers only.                        [Verify as owner]│ │
│  └────────────────────────────────────────────────────────┘  │ ← 锁定说明卡
├──────────────────────────────────────────────────────────────┤
│  Scan history                                                │
│  Jul 29 · a1b2c3d · Completed · 63 findings (+5)             │ ← 单行时间线
├──────────────────────────────────────────────────────────────┤
│  Disclosed findings（仅当 owner 披露过时出现，样式同 7.4 列表 │
│  但只读、无复选框，行尾带「Disclosed」badge）                 │
└──────────────────────────────────────────────────────────────┘
```

**结构要点**：
- 头部四行：面包屑、全名（`text-xl` 600，owner 名 secondary + repo 名 ink）+ GitHub 外链 + Verify as owner 按钮、描述、meta 行
- **扫描状态带**是页面第一信息：状态 badge + 日期 + mono 短 SHA（链接到 GitHub commit）+ 「Scanned by VulnHunter AI engine」（品牌露点②，链接到引擎介绍）
- **洞察区三段**：① 一句话结论（总数 + AI-verified 数，`✦ AI-verified` 徽章露出引擎能力）② 全宽 SeverityBar + 四档图例 ③ CWE Top 5 横向条（bar 长度按最大值归一，右侧 mono 计数，CWE 编号链 MITRE）
- **锁定说明卡**（`bg-surface-raised border`）明确传达访问模型，CTA 引导 owner 验证；这是权限分层的可视化表达
- Scan history 单行时间线（最新在上），含 delta（如 `(+5)` 绿 / `(-3)` 灰），展示持续扫描价值
- 0 漏洞项目不是没有内容，见下方 copy；queued/scanning 状态用对应 StatusBadge + skeleton 替代统计区

**Copy deck**：
- 锁定卡：`Detailed findings, including file paths and code snippets, are visible to verified project maintainers only.`
- 0 漏洞：`No findings were confirmed in this scan. A clean scan does not prove a project is free of vulnerabilities.`
- 扫描失败（公众）：`The latest scan did not complete. Our team has been notified.`（重试入口权限 PRD 未定，UI 暂不渲染重试按钮）

### 7.4 项目页 · owner 视图（Findings tab）

验证通过后 Findings tab 解锁（🔒 消失），结构：

```
┌──────────────────────────────────────────────────────────────┐
│  Overview │ Findings (63)                                     │
├──────────────────────────────────────────────────────────────┤
│  ☑ 2 selected              [ Disclose publicly ]  Clear      │ ← 选中时出现的批量操作条
├──────────────────────────────────────────────────────────────┤
│  ☐  Sev       Title                        CWE     Location        Status      │
│  ☐  ●High  Reflected XSS in SSR renderer   CWE-79  src/ssr.ts:142  ✦ Verified  │
│  ☑  ●Med   SQL injection in query builder  CWE-89  src/db/q.ts:88  ✦ Verified  │ ← 选中行 accent-50 底
│  ☐  ●Low   Open redirect in auth callback  CWE-601 src/auth.ts:55  Unverified  │
│  ☐  ●Info  ...                                               Disclosed ✓        │
└──────────────────────────────────────────────────────────────┘
```

**结构要点**：
- 表格列：checkbox / SeverityChip / 标题（截断 1 行）/ CWE（链 MITRE）/ 路径:行号（mono 13px，截断左侧保留文件名）/ 状态（`✦ AI-verified` / `Unverified` / `Disclosed ✓`）
- 勾选后出现批量操作条（sticky 于表格顶部），「Disclose publicly」为 danger 按钮（不可逆操作）
- 点击「Disclose publicly」→ **确认 dialog**（唯一模态）：

```
┌────────────────────────────────────────────────┐
│ Disclose 2 findings publicly?                  │
│                                                │
│ Titles, descriptions, file paths, and code     │
│ snippets of the selected findings will become  │
│ visible to everyone. This cannot be undone.    │
│                                                │
│              [ Cancel ]  [ Disclose ]          │
└────────────────────────────────────────────────┘
```

- 确认后行内状态变「Disclosed ✓」，这些条目同时对公众可见（7.3 的 Disclosed findings 区），统计口径不变
- 行点击 → 漏洞详情页（7.5）；checkbox 点击不触发行跳转（`stopPropagation`）
- 筛选：severity 多选 + 状态（Verified / Unverified / Disclosed）；排序默认 severity 降序

### 7.5 漏洞详情页（owner）`/p/:owner/:repo/findings/:key`

```
┌──────────────────────────────────────────────────────────────┐
│ ← facebook/react · Findings                                  │
│                                                              │
│  Reflected XSS in SSR renderer                               │
│  ●High  CWE-79 ↗  ✦ AI-verified by PoC  ·  Disclosed ✓       │
│  src/server/ssr.ts:142 ↗ （链 GitHub 对应行）                 │
├──────────────────────────────────────────────────────────────┤
│  Description（markdown 渲染，max-w-prose）                    │
│  The SSR renderer interpolates user-controlled input into... │
├──────────────────────────────────────────────────────────────┤
│  Code snippet                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 140  const html = template                              │  │
│  │ 141    .replace("{{title}}", escape(doc.title))         │  │
│  │ 142 →  .replace("{{meta}}", req.query.meta)  // sink    │  │ ← 命中行高亮
│  │ 143  res.send(html)                                     │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  Disclosure                                                  │
│  ○ Private (maintainers only)   ● Publicly disclosed Jul 30  │ ← 状态行 + Disclose 按钮
├──────────────────────────────────────────────────────────────┤
│                                      ← Prev finding · Next → │
└──────────────────────────────────────────────────────────────┘
```

**结构要点**：
- 标题区堆叠：标题（`text-xl`）→ badge 行（SeverityChip + CWE 外链 + AI-verified + Disclosed 状态）→ 位置行（mono，链 GitHub 行锚点）
- 代码块：`bg-surface-sunken`，行号 mono tertiary，命中行 `bg-sev-high-bg` 整行高亮 + 行号旁 `→`（不用左侧色条）
- Description 用 react-markdown + remark-gfm（依赖已在栈内）
- Disclosure 区块：未披露时显示「Private」状态 + danger「Disclose publicly」按钮（同样走确认 dialog）；已披露显示日期，不可逆
- Prev/Next 底部导航便于逐条审阅（按列表排序顺序）

### 7.6 OAuth 结果页 `/auth/callback`

三种终态，统一居中窄栏（`max-w-md`）+ 状态图标 + 一句结论 + 一个动作：

| 状态 | 图标/色 | 标题 | 正文 | 动作 |
|---|---|---|---|---|
| 验证中 | spinner（流程态允许） | `Verifying with GitHub...` | — | — |
| 成功 | `CheckCircle2` 绿 | `You're verified as a maintainer of {repo}.` | — | 自动 1.5s 跳回项目页 Findings tab |
| 非 owner（write 及以下） | `ShieldX` danger | `Verification failed.` | `You have {role} access. Owner verification currently requires an admin or maintainer role on {repo}.` | `[Back to project]` |
| 组织 OAuth 限制 | `Building2` warning | `Your organization restricts OAuth apps.` | `Ask an organization admin to approve OpenVuln in the organization's GitHub settings, then try again. How to approve →` | `[Try again] [Back]` |
| 用户取消 | `Info` 灰 | `Authorization canceled.` | `No data was shared with OpenVuln.` | `[Back to project]` |

组织限制是调研确认的主要摩擦点，文案给出可执行的下一步而非死胡同。

## 8. 无障碍与响应式基线

- **键盘**：全部交互元素可 Tab 到达；表格行 `Enter` 打开、`Space` 勾选；dialog 焦点圈禁 + `Esc` 关闭
- **focus**：统一 `focus-visible:ring-2 ring-accent-600 ring-offset-2`，不删默认轮廓
- **非颜色编码**：severity = 图标 + 文字 + 颜色；扫描状态 = 图标 + 文字；SeverityBar 必配图例计数
- **语义**：表格用 `<table>`，状态用 `role="status"`，跳转自动 `aria-live` 不打扰
- **动效**：`prefers-reduced-motion` 下关闭呼吸脉冲
- **断点**：`<768px` 项目行折叠为两段（名称+状态 / bar+meta 换行）；Findings 表隐藏 Location 列（详情页可见）；topbar 导航收入「···」菜单（项少，不做汉堡抽屉）

## 9. 交接与待确认

**给 developer 的实现约定**：
1. 路由表见 §3；组件目录建议 `src/components/{SeverityBar,SeverityChip,StatusBadge,StatPulse,ProjectRow,FindingsTable,CodeBlock,EmptyState,ConfirmDialog}.tsx`
2. 公众/owner 数据契约分离（§3 红线），react-query 按 `['public', repoId]` / `['owner', repoId]` 分命名空间缓存
3. 相对时间用 `Intl.RelativeTimeFormat` 手写 10 行工具函数即可，不引入 dayjs
4. 字体自托管（HF Spaces 无外网字体依赖）：`@fontsource/source-serif-4`（400/600/700）+ `@fontsource/dm-sans`（400/500/700），**移除** `@fontsource/inter`
5. 新增依赖：`lucide-react`、`@fontsource/source-serif-4`、`@fontsource/dm-sans`

**待 fish 确认**：
1. 界面语言英文优先（本方案默认，可随时切双语，copy 已集中管理）
2. 「VulnHunter」品牌露出的链接目标（官网？GitHub repo？）
3. PRD 遗留项对 UI 的影响：重试入口权限（§7.3）、冷却期时长（§7.2 文案）、披露是否可撤销（§7.4 按不可逆设计）
