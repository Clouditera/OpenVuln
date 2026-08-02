# OpenVuln 整体架构（At a Glance）

> 2026-08-02 ｜ 与 fish 架构讨论的底图 ｜ 详细设计见：architecture-prototype.md / crypto-admin-channel.md / architecture-review.md

## 1. 系统上下文（谁和谁说话）

```mermaid
flowchart LR
    subgraph Users["用户侧"]
        U[访客浏览器<br/>匿名·只看统计]
    end

    subgraph HF["Hugging Face"]
        SPA[Static Space<br/>React 前端<br/>纯静态外壳]
    end

    subgraph Ours["OpenVuln 后端（单容器）"]
        API[Hono API 服务<br/>+ 队列调度器<br/>+ 轮询同步器]
    end

    DB[(PostgreSQL<br/>serverless / Neon)]
    GH[GitHub API<br/>repo 元数据 · zipball]
    VH[VulnHunter 引擎<br/>阿里云 · API Token]

    subgraph Ops["运营侧（fish 团队）"]
        CLI[admin-cli<br/>本地工具]
        KEY{{私钥<br/>永不离开本地}}
        MT[项目 maintainer<br/>邮件往来]
    end

    U -->|HTTPS 打开页面| SPA
    SPA -->|REST API<br/>CORS 白名单| API
    API --> DB
    API -->|校验/下载源码| GH
    API -->|创建任务/轮询/拉结果| VH
    CLI -->|ADMIN_TOKEN<br/>+ RSA 签名| API
    KEY -.->|只在线下给 CLI 用| CLI
    CLI -->|解密后报告<br/>人工送达| MT
```

**一句话**：页面是静态的，数据全是 API 现取的；扫描重活在远端 VH；漏洞详情用公钥加密存库，服务器自己也解不开；披露权在 fish 手里的私钥上。

## 2. 后端内部（单进程里的四个角色）

```mermaid
flowchart TB
    subgraph Proc["OpenVuln service（Node 单进程）"]
        direction TB
        R[公开路由<br/>projects / stats / report<br/>· 只出聚合数据]
        A[管理路由<br/>/api/admin/*<br/>· Bearer token · 披露加验签]
        D[Dispatcher 派发器<br/>每 10s]
        P[Poller 轮询器<br/>每 30s · 失败退避到 5min]
        VHC[VulnHunterClient<br/>token 模式]
        C[加密模块<br/>只有公钥·无解密函数]
    end

    D -->|SKIP LOCKED 领取<br/>stars 降序| DB2[(scan_jobs 队列)]
    D -->|① 解析 HEAD commit<br/>② 下载 zipball<br/>③ 上传建任务| VHC
    P -->|进行中：只数个数<br/>完成：事务同步| VHC
    VHC --> VH2[VulnHunter]
    P --> C
    C -->|OVENC1 密文| DB2
    R --> DB2
    A --> DB2
```

**关键机制**：
- **队列就在 PG 里**（scan_jobs 表），重启不丢；最多 4 个并发（可动态调）
- **下载自控**：不再让 VH 去 clone（阿里云访问 GitHub 不稳），我们下载 zipball 上传，commit 精确绑定
- **可见性指针**：`projects.current_scan_job_id` —— 公众永远只看最近一次**完成**的扫描；重扫期间旧结果持续可见，完成瞬间原子切换
- **同步事务化**：拉详情（慢）在事务外；删旧→插入→翻指针→标完成在一个事务里 —— 崩溃=回滚=数据和披露决策都安全

## 3. 漏洞数据的旅程（含信任边界）

```mermaid
sequenceDiagram
    participant U as 用户
    participant OV as OpenVuln
    participant VH as VulnHunter
    participant F as fish（admin-cli）
    participant M as Maintainer

    U->>OV: 提交 GitHub 仓库 URL
    OV->>OV: 校验 public · 入队（waiting）
    OV->>VH: 派发（zipball 上传 · 24h 上限 · 动态验证开）
    VH-->>OV: 扫描中（只同步计数）
    VH-->>OV: completed
    OV->>OV: 拉 findings → 公钥加密 → 事务入库
    Note over OV: 公众可见：项目+统计+commit<br/>红线：详情物理不可得

    F->>OV: 下载加密报告包（token）
    F->>F: 私钥解密（线下）
    F->>M: 人工送达报告 + poc
    M-->>F: 修复完毕 · 同意披露
    F->>OV: 签名披露指令（token + RSA-PSS）
    OV->>OV: 验签 → 写入公开字段
    U->>OV: 任何人可见已披露漏洞
```

**三道信任边界**：
1. **公众 ↔ 平台**：公开查询在 SQL 层只 SELECT 聚合列，单条详情物理上取不到（不是"小心不返回"，是"查不到"）
2. **平台 ↔ 漏洞详情**：密文 OVENC1（每条 finding 独立 AES 密钥，RSA 公钥包裹）；服务器被攻破 = 拿到一堆解不开的密文
3. **披露操作 ↔ 伪造**：披露必须附私钥签名；admin token 泄露 ≠ 能披露

## 4. 部署拓扑（目标态）

```mermaid
flowchart LR
    subgraph HF2["Hugging Face"]
        FE[Static Space<br/>前端]
        BE[Docker Space<br/>后端 + 内嵌调度]
    end
    PG[(Neon PG<br/>免费档)]
    VH3[VulnHunter<br/>阿里云]
    GH3[GitHub]

    FE -->|VITE_API_BASE_URL 构建注入| BE
    BE --> PG
    BE --> VH3
    BE --> GH3
```

- 部署所需 secrets（HF 后台配）：`DATABASE_URL` / `VULNHUNTER_*` / `ADMIN_TOKEN` / `ADMIN_PUBLIC_KEY` / `CORS_ALLOWED_ORIGINS`
- **私钥不是 secret，根本不进任何部署** —— 只在 fish 本地
- 后端挂了：队列在 PG，重启自动续跑；VH 挂了：退避轮询，公众页不受影响

## 5. 已知的取舍（诚实清单）

| 取舍 | 理由 | 未来的门 |
|---|---|---|
| 单进程轮询 | 原型规模足够 | SKIP LOCKED 已备好，多实例零改动 |
| info 级不入库统计 | 公众口径四档 NVD | 数据仍在密文里 |
| 产物（poc/exp）文本入库 | 原型不引对象存储 | 量大后迁 S3 兼容存储 |
| 密钥轮换靠重扫重建 | 原型不做在线重加密 | runbook 已留方案 |
| VH failed 宽限 3 轮后标死 | 配合人工恢复运营模型 | 可加自动重试上限 |
