# 鉴权 + 明文 + owner 自助披露 生产验收

> QA：qa ｜ 2026-08-03（含 BUG-AUTH-1 回归）  
> 环境：https://openvuln.clouditera.com（ovsplit · 008）  
> 任务：task-ebbdd324 · task-9807d940  

## 结论

**✅ 自动化验收通过**（真浏览器 OAuth 仍建议 fish 点一遍作产品确认，不挡工程签字）

| 范围 | 状态 |
|---|---|
| 匿名红线 / OAuth 跳转配置 / SPA 入口 | ✅ |
| owner grant 路径 list/detail/disclose/下载 | ✅ |
| 明文 redis 22 + 公众披露结构 | ✅ |
| GLM 续跑 / 无价值 0 findings | ✅ |
| **BUG-AUTH-1 stranger/坏 token → 403** | ✅ 已回归 |
| 单测 | ✅ **54/54** |
| 真 GitHub 授权回跳 | ⛔ 需有号用户（fish）点 4 步 |

---

## BUG-AUTH-1 回归（生产种子会话）

| 请求 | 期望 | 实际 |
|---|---|---|
| stranger `GET .../findings` | 403 | ✅ `ERR_FORBIDDEN` `repo_permission_denied` `github_status:401` |
| stranger detail | 403 | ✅ |
| stranger disclose | 403 | ✅ |
| owner grant 过期 + 假 token 重验 | 403 非 500 | ✅ |
| anon findings | 401 | ✅ |
| owner 有效 grant findings | 200 · 22 | ✅ |
| 日志 | 无 Unhandled 500 | ✅ `GitHub permission denied/invalid token` level 40 |

---

## 既有通过项（摘要）

- OAuth 302：client_id / callback / scopes / state  
- 匿名提交 401；公众 redis 22 无 enc  
- owner disclose → 公众 title + `report` 对象；md/yaml/zip 下载  
- logout 吊销会话  
- GLM-4 scanning；GLM-4.5/5 completed+0  

---

## 签字

- **task-9807d940 BUG-AUTH-1**：**✅**  
- **task-ebbdd324 鉴权工程验收**：**✅**  
- 产品侧真 OAuth 走查：请 fish 按 pm 清单点登录（非工程阻塞）  
