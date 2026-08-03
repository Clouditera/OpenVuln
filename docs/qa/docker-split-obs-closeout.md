# Docker 拆分 OBS 关项（VulnAgent 旁路 :23101）

> QA：qa ｜ 2026-08-03  
> 主机：VulnAgent（SSH）· `ovsplit-*` @ **127.0.0.1:23101**  
> 生产：`openvuln-api` @ **23100** 未动  

## 结论

| OBS | 结论 |
|---|---|
| **OBS-SPL-1** 容器 GitHub TLS | ✅ **关闭** — `ovsplit-api` 内 `fetch api.github.com` **200**；`codeload` Hello-World zip **200** |
| **OBS-SPL-2** 披露下载经 web→api | ✅ **关闭（格式能力）** — `?format=yaml` → raw `metadata:` yaml；`?format=zip` → 合法 zip；经 nginx 反代 |
| 数据 | ✅ redis **22** · c3/h4/m14/l1 |
| 拓扑 | ✅ 仅 3 容器、无 MinIO；prod 23100 健康 |

**旁路「随时可切」维持。**

---

## OBS-SPL-2 明细（redis 已披露 1 条）

| 请求 | HTTP | Content-Type | 备注 |
|---|---|---|---|
| `GET .../report/{key}`（默认） | 200 | `text/markdown` · `*.report.md` | 当前 **API 默认 md** |
| `GET .../report/{key}?format=yaml` | 200 | `application/yaml` · `*.report.yaml` · 以 `metadata:` 开头 | ✅ 原文 |
| `GET .../report/{key}?format=zip` | 200 | `application/zip` | ✅ |
| 项目 `?format=zip` | 200 | zip | ✅ |

### OBS-SPL-5 撤回（产品定稿，非缺陷）

developer 澄清：默认单条下载 = **完整 markdown**（由 report.yaml 渲染）是 **fish No.589 明确要求**，不是旁路/拆分问题。

| 格式 | 获取方式 | 23101 实测 |
|---|---|---|
| 默认 `.report.md` | FE 链接无 query | ✅ 200 markdown |
| 原文 yaml | `?format=yaml` | ✅ `metadata:` |
| zip | `?format=zip` | ✅ PK zip |

QA 此前按 No.564「直接 report.yaml」留下的 OBS-SPL-5 **作废**，不挡切换。

---

## 签字

- OBS-SPL-1 / OBS-SPL-2：**✅ 关项**  
- OBS-SPL-5：**撤回**（md 默认 = 产品定稿）  
- **旁路随时可切**，等 fish「切」  
