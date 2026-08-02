# 加密管理通道设计（Crypto Admin Channel）

> 任务：task-95ecae32 ｜ 决策来源：fish @ No.276/280/283
> 信任模型：**服务器（HF 部署）不可信**。服务器只持公钥；私钥线下由维护人员持有。平台被攻破时，攻击者拿不到漏洞详情明文、无法伪造披露操作。

---

## 1. 总览

```
VulnHunter ──明文拉取──> OpenVuln service（同步器）
                            │ 公钥加密（envelope）
                            ▼
                       PostgreSQL：enc_payload 密文列
                            │ 导出（密文原样吐出）
                            ▼
维护人员本地 CLI ──私钥解密──> 明文报告 ──手动──> 项目 maintainer
维护人员本地 CLI ──私钥签名──> POST /api/admin/disclose ──验签──> 披露生效
```

关键性质：
- service 进程**没有解密能力**（无私钥、代码内无解密函数）—— 结构性红线，非纪律性
- 披露的公开字段由 CLI 在披露指令中携带（线下解密得来），服务器验签后**代发**，自己从不解密
- 密文完整性由 AEAD（AES-GCM）保证，报告包无需额外签名

## 2. 加密方案：混合加密（envelope encryption）

**选型：RSA-4096 + OAEP-SHA256 包裹每条 finding 的随机 DEK，DEK 用 AES-256-GCM 加密数据。**

理由：
- 漏洞详情（report.yaml 解析 JSON）可达数百 KB，纯 RSA 无法直加密 → 必须混合加密
- `node:crypto` 原生全支持（`generateKeyPairSync`/`publicEncrypt`/`privateDecrypt`/`createCipheriv`），**零外部依赖**，CLI 与 service 同构
- 每条 finding 独立 DEK → 单条泄露不波及；DEK 仅 32B，RSA 包裹一次即可，性能无关（同步路径每条 finding 一次）

**信封格式**（自描述、单文本列存储，`.` 分隔的 base64url 段）：

```
OVENC1.<kid>.<wrapped_dek>.<iv>.<tag>.<ciphertext>
```

- `kid`：公钥指纹（sha256(公钥DER) 前 8 字节 hex）—— 轮换后 CLI 知道用哪把私钥
- `iv` 12B 随机；`tag` 16B GCM 认证标签
- **AAD = finding.id（uuid）**：密文绑定 finding，防跨行剪切替换
- `OVENC1` 版本前缀：未来换算法/格式时平滑升级

**被加密的对象**（一个 JSON 整体）：
```json
{ "title": "...", "primary_file": "...", "detail": { …report.yaml 解析结果… } }
```

**保持明文的列**：`severity`、`cwe`、`finding_key`、`disclosure_state` —— 理由：severity/cwe 聚合本来就是公开统计数据，密文化它们反而让公众统计做不了；DB 泄露这两列无增量损失。

## 3. 密钥管理

| 项 | 方案 |
|---|---|
| 生成 | CLI `admin-cli keygen`：RSA-4096，PKCS8 PEM；私钥可选 passphrase 加密（CLI 交互输入） |
| 公钥注入 | env `ADMIN_PUBLIC_KEY`（base64 编码的 PEM）。**缺失时 service 启动 fail-fast**（没有它无法入库 finding） |
| 私钥保管 | 维护人员本地文件 0600 / 密码管理器；**绝不进服务器、不进仓库、不进 CI** |
| 轮换预案 | ① 生成新对 → ② 更新 env 重启（新 finding 用新钥，`kid` 区分）→ ③ 旧密文：原型阶段接受"旧数据随重扫自然重建"，不做在线重加密（列为后续 runbook；rewrap 只需替换 `wrapped_dek` 段，技术上 CLI 可盲做） |
| 私钥丢失 | 灾难级：所有密文不可恢复 → 文档强调多处离线备份；缓解 = 重扫项目可重建数据 |

## 4. 数据模型变更（migration `002_crypto_channel.sql`）

```sql
ALTER TABLE findings
  DROP COLUMN detail_json,
  DROP COLUMN title,            -- 明文 title 并入 enc_payload
  DROP COLUMN primary_file,     -- 同上
  DROP COLUMN disclosed_by,     -- owner 体系遗物
  ADD COLUMN enc_payload text NOT NULL,        -- OVENC1 信封
  ADD COLUMN disclosed_title text,             -- 披露时 CLI 提供
  ADD COLUMN disclosed_summary text,           -- 披露时 CLI 可选提供（公众可见摘要）
  ADD COLUMN disclosed_detail jsonb;           -- 预留：全文公开（默认 NULL）

CREATE TABLE admin_nonces (
  nonce text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);
```

**重扫保持披露决策**：现有 BUG-1 逻辑（按 `finding_key` 保留 disclosure_state）扩展为同时保留 `disclosed_title/summary/detail` 三列。

## 5. 同步路径改动（加密插入点）

`scans/queue.ts syncFindings()`，在现有的 title/cwe/primaryFile 组装之后、入库之前：

```ts
const encPayload = encryptForAdmin(config.adminPublicKey, finding.id, {
  title, primary_file: primaryFile, detail: detail ?? meta,
});
await findingsStorage.upsertFinding({ ..., severity, cwe, encPayload, /* title/primaryFile 不再明文 */ });
```

- poc_status 白名单过滤、NVD severity 映射（并行任务在做）发生在**加密之前**的明文阶段，不受影响
- seed 脚本同样走 `encryptForAdmin`（演示库密文结构与生产一致；disclosed 样例直接写 `disclosed_*` 列）

## 6. 管理端点集合（ADMIN_TOKEN + 验签双层）

认证改造（随 owner 体系移除）：删 session/injectUser/requireGrant，新增 ——
- `requireAdminToken`：`Authorization: Bearer $ADMIN_TOKEN`，恒定时间比较（`crypto.timingSafeEqual`）
- `requireSignature`（仅 disclose）：见 §7

| 端点 | 认证 | 说明 |
|---|---|---|
| `GET /api/admin/queue` | token | 现状保留 |
| `POST /api/admin/scan-jobs/:id/retry` | token | 现状保留 |
| `DELETE /api/admin/projects/:id` | token | 现状保留（下架） |
| `GET /api/admin/projects/:id/report-package` | token | 导出加密报告包（attachment JSON）：`{project, scan_job, generated_at, items:[{finding_id, finding_key, severity, cwe, disclosure_state, enc_payload}]}`。吐密文无泄露风险，token 足够 |
| `POST /api/admin/projects/:id/disclose` | token **+ 签名** | 见 §7。token 泄露不等于能披露 —— 这是双层意义 |

原 owner 端点（`/api/projects/:id/findings`、`/disclose` by grant）随移除任务删除；公众 disclosed 列表/报告下载改读 `disclosed_*` 列。

## 7. 披露验签协议

**请求**：
```http
POST /api/admin/projects/:id/disclose
Authorization: Bearer <ADMIN_TOKEN>
X-OV-Signature: <base64url 签名>
Content-Type: application/json

{
  "action": "disclose",
  "project_id": "<uuid>",
  "items": [{ "finding_id": "<uuid>", "title": "...", "cwe": "CWE-79", "summary": "可选" }],
  "timestamp": 1754030000,
  "nonce": "<16B random hex>"
}
```

**签名内容**（canonical 构造函数放 `shared/src/crypto-admin.ts`，service 与 CLI 共用同一实现，防漂移）：

```
payload   = "OV-DISCLOSE-v1\n" + sha256hex(canonicalJson(body))   // body 即上述 JSON（不含签名头）
signature = RSA-PSS-SHA256-sign(payload, 私钥)
```

`canonicalJson` = 键名排序、无空白、UTF-8 的确定性序列化（递归 sort keys）。

**服务端验签流程**（顺序即防线）：
1. `requireAdminToken` 通过
2. `timestamp` 在 ±300s 窗口内
3. `nonce` 不在 `admin_nonces` 表（命中 = 重放，409）
4. 重算 `canonicalJson(body)` → 公钥验签（`crypto.verify`，PSS）失败 → 401
5. 校验 `finding_id` 全部属于该项目（防跨项目代签生效）
6. 执行：写 `disclosed_title/summary`、`disclosure_state='disclosed'`、`disclosed_at=now()`
7. `nonce` 落表 + 懒清理（`used_at < now()-1h` 删除）+ 审计日志行（project、count、nonce 前缀）

**为什么 timestamp 在 body 内**：已被 body hash 覆盖，签名天然保护，无需额外字段。

## 8. 维护人员 CLI（`packages/admin-cli`，Node + tsx，零依赖）

```bash
# 1. 生成密钥对（一次性）
admin-cli keygen --out openvuln-admin.pem --passphrase
#    → 打印 ADMIN_PUBLIC_KEY（base64，配进服务器 env）

# 2. 下载加密报告包（curl 即可，CLI 也封装）
admin-cli fetch-package --api https://<host> --token $ADMIN_TOKEN --project <id> --out pkg.json

# 3. 本地解密 → 明文报告（人工审阅后手动发给 maintainer）
admin-cli decrypt pkg.json --key openvuln-admin.pem --out report.md   # 也支持 --format json

# 4. maintainer 确认后，构造签名披露指令
admin-cli disclose --api https://<host> --token $ADMIN_TOKEN --key openvuln-admin.pem \
  --package pkg.json --findings <finding_id,...> [--summary "已在 v2.1 修复"]
#    → 从 pkg 取 title/cwe 组装 items，签名 POST；--summary 作为公众可见摘要
```

实现要点：`node:crypto` + 全局 `fetch`；私钥读取支持加密 PEM（交互问 passphrase）；decrypt 按 `kid` 提示该用哪把钥匙。

## 9. 结构性红线与测试

1. **service 无私钥**：env schema 不含任何私钥变量；红线测试扫描 `packages/service/src` 断言无 `privateDecrypt`/`ADMIN_PRIVATE` 引用（放进现有 redline 测试族）
2. **公众路径物理无明文**：公开查询 SELECT 列白名单（severity/cwe/disclosed_*）；现有红线测试改断言响应无 `enc_payload`、无 `title`（仅 `disclosed_title`）
3. **披露伪造测试**：无签名/坏签名/重放 nonce/过期 timestamp/跨项目 finding_id → 全部 4xx
4. **加解密 roundtrip 单测**：`crypto-admin.ts`（shared）keygen→encrypt→decrypt 闭环 + AAD 错配必失败

## 10. 实施顺序（交 developer）

前置：owner/OAuth 移除任务（task 已派）—— 本设计假设其完成后的路由形态。
1. `shared/src/crypto-admin.ts`：envelope 加解密 + canonical + 签名构造/验证（纯函数，单测先行）
2. migration 002 + storage 层列调整 + seed 走加密
3. `infra/config.ts`：`ADMIN_PUBLIC_KEY`/`ADMIN_TOKEN` 必填；删 `ADMIN_GITHUB_LOGINS`
4. `middleware/auth.ts` 简化：`requireAdminToken` + `requireSignature`
5. `scans/queue.ts` 加密插入 + 重扫保留 disclosed_* 列
6. admin 路由：report-package + disclose（验签）；公众 disclosed 读取改列
7. `packages/admin-cli` 四命令
8. 红线测试更新 + 演示库清库重灌

**env 增量**：`ADMIN_PUBLIC_KEY`（必）、`ADMIN_TOKEN`（必）；移除 `ADMIN_GITHUB_LOGINS`、OAuth 三件套。

## 11. 明确不做（原型）

- 在线密钥轮换/重加密工具（runbook 文档化即可）
- 管理操作审计表（日志行足够）
- 报告包 zip 化（单 JSON 文件即可，维护人员量小）
- 多把管理公钥/分权（单一维护方现状）
