# 披露保真验收报告（task-7377d525）

> QA：qa ｜ 2026-08-02  
> 环境：allinone `http://127.0.0.1:7860` · **OISF/suricata**（49 findings rebind）  
> 含 fish No.564：单条下载改为原始 `report.yaml` 附件

## 结论

**✅ 通过**

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 全量披露的 `report.yaml` 与密文包解密原文 **逐字节一致** | ✅ 4/4（sha256 一致） |
| 2 | **单条默认下载 = raw yaml 附件**（非 zip） | ✅ `Content-Type: application/yaml` · `filename="{key}.report.yaml"` |
| 3 | 项目级 `?format=zip` 仍为 zip，内含各 `findings/<key>/report.yaml` | ✅ 4 yaml，均 byte-equal |
| 4 | 单条可选 `?format=zip` 仍可用 | ✅ |
| 5 | 公众 JSON **无** report_yaml / 路径 / metadata 正文 | ✅ |
| 6 | 未披露 key 下载 | ✅ **404** |
| 7 | 摘要-only 旧披露 | ✅ **404** `no_fidelity_payload`（需重新 disclose） |
| 8 | 签名篡改 report_yaml / 坏签 / 无签 | ✅ **401** `bad_signature` |
| 9 | 摘要-only disclose 兼容（HTTP 200） | ✅ 已测 |
| 10 | 单元测试 | ✅ **33/33** |

---

## 单条 raw yaml（fish No.564）

| finding_key | HTTP | CT | filename | bytes | =package |
|---|---|---|---|---:|---|
| BUG-R10-C1-A1-H1 | 200 | application/yaml | `BUG-R10-C1-A1-H1.report.yaml` | 16930 | ✅ |
| BUG-R10-C1-A1-H3 | 200 | application/yaml | `…H3.report.yaml` | 13890 | ✅ |
| BUG-R10-C1-A2-H1 | 200 | application/yaml | `…A2-H1.report.yaml` | 20184 | ✅ |
| BUG-R10-C1-A3-H1 | 200 | application/yaml | `…A3-H1.report.yaml` | 13886 | ✅ |
| BUG-R10-C1-A7-H1（仅摘要披露） | 404 | — | `no_fidelity_payload` | — | 预期 |

正文均以 `metadata:` 开头。

---

## 项目 zip

- `GET /api/projects/:id/report?format=zip` → `application/zip`
- 结构：`index.*` + `findings/<key>/report.yaml` + summary
- 有 fidelity 的披露条 yaml 与 package **byte-equal**

---

## 红线

- 项目公众 JSON：无 `report_yaml` / `primary_file` / `metadata:` / `enc_payload`
- 未披露：`GET .../report/:key` → 404
- 篡改签名指令中的 yaml → 401（不入库）

---

## poc/exp

本批 findings 源为 lodash pending，**artifacts=0**；zip/yaml 路径不因此失败。有产物时由 disclose `files[]` 进入项目 zip 的 poc/exp 目录（实现已有，本数据无文件可对拍）。

---

## 观察

| ID | 说明 |
|---|---|
| OBS-FID-1 | 历史摘要-only 披露无 yaml 下载；**重新 CLI disclose** 后即有全文 |
| OBS-FID-2 | 验收中容器曾短暂重启，`/data` 卷数据保留 |

---

## 签字

**task-7377d525：✅ QA 通过**（含单条 raw yaml 口径）
