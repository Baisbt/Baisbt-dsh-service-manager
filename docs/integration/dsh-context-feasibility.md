# 与 dsh-context 联动的可行性

> 状态：**可行性结论 + 证据**。本文只谈"能不能、怎么接、接不上会怎样"，不实现代码。
> 对象：本仓库 `dsh-service-manager@0.12.0` 与第三方插件 `dsh-context@0.82.1`（作者 bowenliang123，Apache-2.0）。
> 调研环境：本机 DSH `0.2.2-rc.1`，profile `desktop` 同时安装了 `dsh-context`、`dsh-service-manager`、`dsh-drawai`。
> 结论日期：2026-11-09。

---

## 0. 一句话结论

**可行，而且是"单向读取"就能成立的联动。**

本项目只消费 dsh-context **已经对外产出**的三类东西——会话投影值、它自己注册的精确路由、它注册的面板 id——不需要 dsh-context 改一行代码，也不需要它知道本项目的存在。未安装 dsh-context 时，三个读取通道都表现为"读不到"，本项目的 MCP / 技能两个页面必须保持与今天完全一致，只是新增的读数不出现。

---

## 1. 三条硬性前提与落地方式

| 前提 | 落地方式 | 成立依据 |
|---|---|---|
| ① 单向：本项目接 dsh-context，不要求它接本项目 | 只读它的投影 / 只调它已注册的路由 / 只按 id 打开它的面板；**不 import 它的包、不改它的文件、不要求它加接口** | 见 §4 三通道 |
| ② 只装本项目时不能坏 | 不写进 `dependencies` / `peerDependencies`；宿主不把它的服务写进 `export const inject`；客户端不 `require("dsh-context")`；探测失败一律走"未安装"分支 | 见 §6 降级设计 |
| ③ 先懂本项目，再挑 dsh-context 里能接的东西 | 本项目 = 管理面（装/改/停/删 MCP 与技能）；dsh-context = 观测面（上下文构成、成本、演进） | 见 §2、§7 |

第 ③ 条的目标原文说"这部分需要在后续对话再确定，目前尚未可知"，所以 §7 只给**候选清单 + 取数与验收**，不替用户拍板。

---

## 2. 本项目是什么（决定"能接什么"的边界）

`dsh-service-manager` 是一个 DSH 插件，两半区：

- **Host 半区**（`index.js`，1743 行，无构建）：`export const inject = ["connection", "loader", "tools"]`，注册 12 条 `POST /api/service-manager/*` 精确路由、一个 `mcp_service` agent 工具；读写自己独占的 `mcp-servers.yml` 与 `.dsh-service-manager/*.json`。
- **Client 半区**（`client.tsx` → `client.js`）：`window.__ModuleLoader__.load({ id: "dsh-service-manager", ... })`，客户端 `inject: ["slots", "locale", "layout"]`，注册 `sidebar.panellist` 入口 + `main` keyed 面板（`key: "service-manager"`）。

它的数据面（决定了联动时"哪一侧能拿到数据"）：

| 数据 | 来源 | 现有能力 |
|---|---|---|
| MCP 服务器列表 / 状态 / 工具 | 自己的 `servers.json` + `ctx.tools.schemas()`（`readToolIndex`，正则以 `mcp__<server>__<tool>` 分组） | 增删改查、启停、工具抽屉 |
| 技能列表 | `scanSkills()`：扫 `~/.agents/skills`、`~/.dsh/skills`，读 `SKILL.md` frontmatter | 浏览、翻译、删除 |

**关键结论**：本项目已经有"工具名 → 服务器名"的映射（`readToolIndex`），只是没有"工具名 → token 数"。而 dsh-context 恰好提供后者——这是最短的一条缝。

---

## 3. dsh-context 是什么（本机实测 0.82.1；npm 最新 0.83.0）

- 能力：上下文洞察页（跨会话 KPI / 趋势 / 技能加载 / 工具调用 / 命令执行 / 会话卡片）、会话内 Context 标签、Fleet 标签、右侧栏 Context 面板、`/context` 命令、偏好设置卡片。
- 形态：Host 半区 `lib/index.js`（112 KB，tsdown 打包）+ Client 半区 `lib/client.js`（825 KB）。
- Host 半区 `export const inject = ["sessionProjections"]`，在 `apply` 里：
  - 注册三个**会话投影**：`contextTimeline`（`stateVersion: 38`）、`contextHeaders`（1）、`contextActivity`（6）；
  - 注册 9 条精确路由：`POST /api/dsh-context/{snapshot, detail, fleet, skills, attachment, recom, backfill, balance, commands}`；
  - 读 DSH 核心服务：`connection`、`sessions`、`sessionQuery`、`sessionPersistence`、`sessionProjections`、`sessionProjectionCache`、`storageDomain`、`skills`、`agentPresets`、`agents`、`attachments`、`systemPrompt`。
- Client 半区 `factory` 返回 `{ name: "dsh-context", inject: ["slots", "locale"], apply }`——**只做槽位注册，不导出可复用组件**。
- 兼容性：需要 DSH `>= 0.2.0-rc.2`；DSH 更旧时它仍注册三个**占位投影**，值是 `{ ok: true, unsupported: { current, minimum } }`（这点决定了降级要分"没装"和"装了但不支持"两态）。

### 3.1 版本漂移实测：0.82.1（本机）→ 0.83.0（npm 最新）

本机装的是 `0.82.1`，npm 上已经是 `0.83.0`。把新版本 tarball 拉下来逐项比对（见 §附录）：

| 面 | 0.82.1 | 0.83.0 | 对我们影响 |
|---|---|---|---|
| 投影 key | `contextTimeline` / `contextHeaders` / `contextActivity` | 同左，**没变** | 按 key 读取的代码不受影响 |
| `contextHeaders` `stateVersion` | 1 | 1 | **我们主要依赖的 key 没变** |
| `contextActivity` `stateVersion` | 6 | 6 | 同上 |
| `contextTimeline` `stateVersion` | 38 | **41** | 我们**不用**它；但它变了说明形状会动 |
| 路由数 | 9 | **13**（新增 `version` / `overview` / `heads` / `facts`） | 我们用的 `snapshot`、`skills` 仍在 |
| 客户端面板 id | `dsh-context` | 同左 | 深链不变 |

结论：

1. **推荐依赖的两面（`contextHeaders`、`contextActivity` + `/snapshot`）在这次升级里一个字没变**，而变的是我们不用的 `contextTimeline`——这反向支持"只碰这两面"的选择。
2. 0.83.0 新增的 **`/api/dsh-context/version`** 是更好的探测入口：返回 `{ ok, value: { ready, failed, checkedAt, current, latest? } }`，不用折叠任何投影。旧版没有它 → 探测退回 `/snapshot`（见 §6.2）。
3. 适配基线建议写成 **0.82.x – 0.83.x（截至 2026-11-09）**，升级到 0.84 之前重跑一次 §5.6 的比对。

---

## 4. 它对外露出的面（本项目的三个读取通道）

| # | 面 | 具体形态 | 缺装时的表现 |
|---|---|---|---|
| **A** | DSH 核心的**会话投影** | `ctx.sessionProjections.snapshot(session, new Set(["contextHeaders"]))` 或 `ctx.sessionProjectionCache.cachedSnapshot(header, keys)`（宿主侧）。三个 key 都在注册表里，但它的 `/snapshot` 路由只挑 `contextTimeline` + `contextActivity` 两个 | `values` 里没有这几个 key → `undefined` |
| **B** | 它自己的**精确路由** | `POST /api/dsh-context/snapshot`（全部会话的 `contextTimeline`+`contextActivity`）、`/detail`（单会话、可 `head:true` 只取头）、`/skills`、`/fleet` | 未认证一律 401（实测，**连不存在的路径也 401**）；已认证但未认领 → 404（DSH 文档） |
| **C** | **面板 id 深链** | `ctx.layout.selectPanel("dsh-context")` 打开它的洞察页；`main` 面板 key 与 `sidebar.panellist` id 都是 `dsh-context` | `selectPanel` 检查实时 `main` 注册表，**缺失的 key 抛错并保留当前面板**（可 try/catch） |

补充事实（影响取舍）：

- **B 只能在页面里调**。路由挂在浏览器认证之后：无凭证直接 POST 得到 **401**（本次实测）。Host 侧不能"顺手 fetch 一下"。
- **`/snapshot` 只回 `contextTimeline` + `contextActivity`**（它源码里的 `Ua` 集合就这两个 key）。**`contextHeaders`（逐工具 tokens）不在任何 HTTP 路由的返回里**——只能从投影注册表读：宿主侧 `sessionProjections`，或会话视图槽位 props 里的 `useProjection`（dsh-context 客户端自己就是这么读的；但服务管理页是 `main` 面板，拿不到这份 props）。
- **A 是宿主侧通道**，用的是 DSH 官方服务，不依赖 dsh-context 的路由；但值形状是 dsh-context 定义的（且各 key 有 `stateVersion`），要按 schema 防御式读取。
- **C 是纯 UI 联动**，只借一个 id 字符串，代价最小、语义最弱。
- 客户端 `dsh.client.inject` 是**软依赖**：加载器 `arriveGraphRow` 里对 `row.inject` 的每一项做 `graphRows.get(pkg)`，**取不到就跳过**，不报错。所以"把它列进 client inject"不会让缺装用户崩，但也拿不到任何东西（它不导出组件）。

### 三通道对比

| | A 宿主投影 | B 页面路由 | C 面板深链 |
|---|---|---|---|
| 改动落在 | `index.js`（宿主） | `client.tsx`（页面） | `client.tsx`（页面） |
| 缺装是否天然降级 | 是（key 缺席） | 是（404） | 是（抛错，需兜住） |
| 依赖的稳定性 | DSH 服务 API 稳定，**值形状**是第三方的 | 第三方的**私有路由**（作者未当公开 API 发布） | 一个面板 id 字符串 |
| 数据新鲜度 | 需要自己挑 `sessions`/缓存 | 它自己算好并缓存 | 无数据 |
| 额外成本 | 宿主要处理 live/持久两种会话 | 一次 POST，可用时再发 | 一行调用 |
| 建议 | 候选 1（MCP tokens）必须走它 → 二期 | 候选 2（技能使用）一期首选 | 候选 3，可与 2 同批 |

**推荐**：按"要哪个数"落通道——

- 候选 2（技能使用）+ 候选 3（深链）：**B + C，全在客户端，宿主零改动**，可以一期做；
- 候选 1（MCP 每轮 tokens）：数据在 `contextHeaders` 里，HTTP 拿不到，得走 **A**（宿主新增一条只读路由），属于二期。

### 4.1 实现契约（已对本机 0.2.2-rc.1 的包与源码核对）

**宿主侧（候选 1 用）**

```js
const sessions = ctx.get("sessions");                 // SessionStore：get(id) / list()
const projections = ctx.get("sessionProjections");    // snapshot(session, keys)
const cache = ctx.get("sessionProjectionCache");      // cachedSnapshot(meta, keys) —— 零 I/O
const query = ctx.get("sessionQuery");                // listSessions() → meta[]

for (const meta of (await query?.listSessions?.()) ?? []) {
  const id = meta?.header?.id;                        // listSessions 的条目自带 .header
  if (!id) continue;
  const live = sessions?.get?.(id);
  const keys = new Set(["contextHeaders"]);
  const values = live
    ? projections?.snapshot?.(live, keys)?.values
    : cache?.cachedSnapshot?.(meta.header, keys)?.values;   // 传「会话头」，不传 id
  const header = values?.contextHeaders?.headers?.at(-1);
  // header.tools: [{ name, tokens, plugin? }]
}
```

- 服务可用性：`dsh-session-projection`、`dsh-session-projection-cache`、`dsh-session-query`、`dsh-session-query-sqlite` 都在官方 `@deepseek-ai/dsh-desktop-runtime` 的 dependencies 里（0.2.2-rc.1 实测清单），标准组合一定有；仍用 `ctx.get()` 取，取不到就不出这一列。
- **`cachedSnapshot` 收的是「会话头」**（`meta.header`，带 `formatVersion/createdAt/cwd/isSeeded`），不是 id、也不是 `listSessions()` 的列表项本身——实现时踩过这个点，已按 `meta.header` 传。
- 值形状：`{ headers: Array<{ seq, time, systemTokens?, tools: Array<{ name, tokens, plugin? }> }> }`，最多 **50** 条（它的 `apply` 里 `slice(-50)`）。
- 缓存行带 `ver`：dsh-context 升级导致 `stateVersion` 变化时旧行被**丢弃而不迁移**——升级后冷会话可能暂时读不到，显示 `—`，等它重新折叠后恢复。
- 数值是 DSH 的密度启发式估算，不是账单上的精确 token；UI 必须写"估算"。

**页面侧（候选 2 用）**

```text
POST /api/dsh-context/snapshot
body: { ids?: string[], revision?: string }   // 省略 ids = 全部会话
→ { ok: true, value: { [sessionId]: { contextTimeline?, contextActivity? } }, revision }
```

- 只回这两个 key（0.83.0 的 handler 里仍只塞 `contextTimeline` / `contextActivity`）。
- `contextActivity.days["YYYY-MM-DD"].skills` 形如 `{ [skillName]: { n, last } }`。
- **0.83.0 起**可以带上次返回的 `revision`：命中就回 `{ ok: true, value: {}, revision, unchanged: true }`，省一次全量折叠；0.82.x 会忽略这个字段。
- 两个读取面都会在内存里折叠，别在页面里轮询。

---

## 5. 实测证据

以下都是本机真实数据，不是文档推演。

### 5.1 投影缓存里确实有三个 key（在用的，不是空注册）

最近一次写入的会话投影缓存行（`~/.dsh/storages/session_projcache/sessions/session-1e48b33a-….json`，2026-11-09 18:51）：

```
version: 7
contextTimeline : ver=38  seq=432   valKeys=surface, sums, toolsTokens, requests, events, …（共 34 个）
contextHeaders  : ver=1   seq=432   valKeys=headers
contextActivity : ver=6   seq=432   valKeys=days, model, provider, lastTurn, stepStart, toolStarts
```

（同一行里还有 `tokenUsage`、`contextPressure`、`contextBreakdown` 等 DSH 自带投影——说明这是**公共**缓存，不是 dsh-context 的私有文件。）

### 5.2 MCP 服务器的上下文开销是"可算的"

同一行的 `contextHeaders.headers[-1]`（最近一次请求头）共 **78 个工具定义**，其中 5 个是 MCP 工具：

| 工具 | tokens |
|---|---|
| `mcp__tavily__tavily_search` | 1209 |
| `mcp__tavily__tavily_crawl` | 571 |
| `mcp__tavily__tavily_extract` | 367 |
| `mcp__tavily__tavily_map` | 365 |
| `mcp__tavily__tavily_research` | 289 |
| **合计** | **2,801**（占全部工具定义 19,717 的 **14.2%**） |

注意两点：

1. **join 键天然对齐**：dsh-context 记的 tool 名就是 `mcp__<server>__<tool>`，正是本项目 `readToolIndex` 用的同一个正则；不需要它提供"服务器归属"字段。
2. **不要混用来源**：`contextTimeline.toolsTokens = 19,399` 与上表 19,717 差 318——前者是"当前上下文",后者是"最近一次请求头"，两个口径。文档/UI 里要说清是哪一个。

### 5.3 技能使用数据也存在

- `contextActivity.days["2026-11-09"].skills = { "diagnose-windows-sandbox-acl": { n: 1, last: … } }`
- `contextTimeline.surface` 里有 2 个 `cat: "skill"` 节点，tokens 分别是 1,723 / 1,690。

也就是说"某个技能被加载过几次、最近什么时候、注入了多少 token"这三件事，dsh-context 都已经算好了。

### 5.4 路由的认证边界（决定了架构）

| 请求（无凭证） | 结果 |
|---|---|
| `POST /api/dsh-context/snapshot` | 401 |
| `POST /api/definitely-not-a-route-xyz`（不存在的路径） | **401**（不是 404） |
| `GET /api/service-manager/version` | 401 |
| `GET /healthz`（非 `/api` 路径） | 404 |

401 发生在路由分发之前（DSH 文档：Host 可信但未认证的请求返回 401）。两个推论：

1. **跨插件读数据必须从页面发起**（页面带同源 cookie），不能让宿主自己去 fetch。
2. 端口扫描式的探测区分不了"路由在不在"，但**页面内**可以：已认证后未认领的请求才返回 404。所以探测代码把"任何非 200"都当不可用（401 与 404 不区分）——这样即使 cookie 过期也不会误报"已安装"。

### 5.5 口径验证脚本（离线，可重跑）

`docs/integration/spike-server-cost.mjs` 把 §4.1 的接法在离线状态跑了一遍（直接读投影缓存文件，**只用于验证口径，不进运行时**）：

```text
$ node docs/integration/spike-server-cost.mjs
会话：session-1e48b33a-88d0-4114-a7b6-f72f77950009
请求头：seq=597  time=2026-11-09T10:57:25.776Z
工具定义：78 个，合计 19717 tokens

服务器          工具   tokens   占比    配置
-------------------------------------------------
tavily           5     2801   14.2%  已启用
```

脚本只读 `serverName` 与工具 `name`，不打印 URL / env / headers（那些字段可能含密钥）；`--session <id>` 指定会话，`--json` 给机器可读输出。

### 5.6 证据成熟度（哪些已证、哪些还欠）

| 结论 | 证据来源 | 成熟度 |
|---|---|---|
| dsh-context 在本机是活的，三个投影在写 | 投影缓存行（`ver=38/1/6`） | 实测 |
| MCP 工具 tokens 可算，口径与文档一致 | `spike-server-cost.mjs` 输出 2,801 / 19,717 | 实测 |
| 技能使用计数（`{n,last}`）存在 | `contextActivity.days` | 实测 |
| 未认证访问任何 `/api/*` 都是 401（含不存在路径） | 4 条探测 | 实测 |
| 页面内"未认领 → 404" | DSH 官方 README（client-connection） | 文档 |
| `selectPanel` 缺失 key 抛错、服务名是 `layout` | layout 源码 `LayoutController` | 源码 |
| `/snapshot` 只回 `contextTimeline` + `contextActivity` | dsh-context 源码 `Ua` 集合 | 源码 |
| `sessionProjections` / `sessionProjectionCache` / `sessionQuery` 在标准组合里 | `dsh-desktop-runtime` 依赖清单 | 实测（清单） |
| 只装本项目时页面无变化 | 设计推演（新代码还没写） | **待实现验证** |
| 0.82.1 → 0.83.0 的接口漂移 | 从 npm 拉 tarball 逐项比对（§3.1） | 实测 |
| DSH 核心**没有**逐工具 token（只有 `toolsTokens` 合计） | `dsh-token-meter` 文档 + `contextBreakdown` 实测值 | 实测（否定结论） |
| 页面内 `/api/dsh-context/*` 的真实响应体 | 需要登录态，本机没有浏览器自动化 | **未证明**（形状取自源码） |
| 未装 dsh-context 时的 404 行为 | 需要一个只装本项目的 profile | **未证明** |

---

## 6. 缺装时的降级设计（硬规则）

### 6.1 不许做的事

1. 不把 `dsh-context` 写进 `package.json` 的 `dependencies` / `peerDependencies` / `optionalDependencies`。
2. 不把 `dsh-context` 提供的**服务**写进宿主 `export const inject = [...]`（那是硬依赖，缺了插件直接不激活）。
3. 不 `require("dsh-context")` / `import("dsh-context")`，不引用它的任何组件或符号。
4. 不读 `~/.dsh/storages/session_projcache/**`（那是 DSH 的存储格式，`version: 7`，不是稳定接口）。
5. 不让新增读数进入 MCP / 技能两页的**关键路径**（加载失败不能变成整页错误）。

### 6.2 探测（一次，页面生命周期内缓存）

```ts
type Probe = "absent" | "unsupported" | "ok";
let contextProbe: Probe | "pending" | null = null;

const post = (path: string) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    credentials: "same-origin",
  });

async function probeContext(): Promise<Probe> {
  // 1) 0.83+ 有 /version：最便宜，不折叠任何投影
  try {
    const res = await post("/api/dsh-context/version");
    if (res.ok) {
      const payload = await res.json();
      if (payload?.ok === true) {
        contextVersion = String(payload.value?.current ?? "");   // 可记下来做兼容判断
        return (contextProbe = "ok");
      }
    }
    // 404/401/其它 → 可能装着 0.82.x，继续往下试
  } catch {
    /* 网络异常：继续按"没有"处理 */
  }

  // 2) 0.82.x：退回 /snapshot；只看有没有数据 + 是不是占位值
  try {
    const res = await post("/api/dsh-context/snapshot");   // 不传 ids = 全部会话
    if (!res.ok) return (contextProbe = "absent");         // 401/404/500 一律不可用
    const payload = await res.json();
    if (payload?.ok !== true) return (contextProbe = "absent");
    const unsupported = Object.values(payload.value ?? {}).some(
      (v: any) => v?.contextTimeline?.unsupported,          // 旧 DSH 上它给占位值
    );
    return (contextProbe = unsupported ? "unsupported" : "ok");
  } catch {
    return (contextProbe = "absent");
  }
}
```

### 6.3 UI 三态（不要出现"0 tokens"这种假事实）

| 状态 | MCP 行 | 技能卡 | 全局 |
|---|---|---|---|
| `absent` | 不渲染"上下文开销"这一列；只在页面底部或帮助里留一句"安装 dsh-context 可查看每个服务器的上下文开销"（可关掉，不要醒目） | 不渲染使用次数 | 与今天完全一致，无报错、无骨架屏残留 |
| `unsupported` | 显示 `—`，title：「dsh-context 需要 DSH ≥ 0.2.0-rc.2」 | 同左 | 一句一次性提示，不重复弹 |
| `ok` | 数字 + 单位 + 口径 tooltip（"最近一次请求的工具定义估算"） | "近 7 天 3 次 · 最近 2 小时前" | — |

### 6.4 深链（C 通道）的写法

已核对的源码行为（`@deepseek-ai/dsh-client-ui-layout` 的 `LayoutController`）：

- 服务名是 `layout`（`ctx.reflect.provide("layout", …)`），方法 `selectPanel(panelId)`；
- 它会先查实时注册表 `ctx.slots.entries("main").some(e => e.options.key === id)`，**不在就 throw** `layout.selectPanel: main panel "…" is not registered`，且不改当前选中态；
- 所以**先查再点**比 try/catch 更干净：

```ts
const hasContextPanel = () =>
  // layout 自己就是这么查的（同一个 slots 服务）；若该 API 日后收敛，退回 try/catch 依然可用
  ctx.slots.entries("main").some((entry: any) => entry?.options?.key === "dsh-context");

const openContextInsights = () => {
  if (!hasContextPanel()) return;          // 未安装 / 用户关了入口 → 按钮不渲染
  try {
    ctx.layout.selectPanel("dsh-context"); // 竞态下仍可能刚被注销，兜一层
  } catch {
    /* 静默回退，不要 toast，更不要提示"去装 dsh-context" */
  }
};
```

注意"装了"≠"入口还在"：dsh-context 的偏好里有 `insightsEntry: show | hide`（默认 show）和 `defaultPlacement`，用户关掉洞察页入口后它根本不会注册 `main` 面板——所以拿不到面板不等于没装，一律当"不可用"处理。

---

## 7. 可联动内容候选（交后续对话确认）

按"价值 ÷ 成本"排序。每条都标注了取数通道与降级方式。

### 7.0 先划清"它已经有什么"——否则候选只是复制

读它的客户端包确认（`tool.plugin` 文案 + `Fr()` 把 `mcp__<server>__<tool>` 映射成 `mcp:<server>`）：

| 信息 | dsh-context 已有 | 本项目要补的 |
|---|---|---|
| 逐工具 token 开销 | ✅ 有：会话上下文浏览器里一个工具一行 | —（不重复造） |
| MCP 服务器归因 | ✅ 已有：每个工具带 `mcp:<server>` 标签 | 把标签**按服务器加总**成一行数字 |
| 技能加载次数 / 最近使用 | ✅ 有：洞察页「技能加载」卡片 | 挪到**技能卡**上，在"删之前"看得见 |
| 工具调用次数、命令执行 | ✅ 有：洞察页两张卡片 | —（不重复） |
| 入口位置 | 在它自己的侧栏面板 | 在 MCP / 技能两个**管理动作旁边**，并可一键跳过去 |

**结论：本项目不造新数据，做的是「聚合 + 放置 + 跳转」。** 想纯看数据，装 dsh-context 就够了；本项目的增量价值只在"管理时顺手看见"。这条判断应该先于任何实现决定。

### 7.1 没有 dsh-context 时，候选 1 能不能自己算？

"每轮工具定义 tokens"这组数，DSH 核心**没有**现成等价物（已核对的三个候选来源）：

| 核心来源 | 有什么 | 为什么不够 |
|---|---|---|
| `ctx.tokenMeter.measure(session, requestHeader?)` | `totalTokens` / `surfaceTokens` / `nodes[]`（surface 节点） | 没有逐工具拆分；`nodes` 是对话节点，不是工具定义 |
| `contextBreakdown` 投影（核心） | `systemTokens` / `toolsTokens` / `messageTokens` | 只有**合计**（本机实测：`toolsTokens: 19399`），没有按工具/按服务器 |
| `sessionStats` 投影（核心） | 轮次、步骤、工具耗时 | 与 token 无关 |

所以只有三条路：

| 方案 | 代价 | 数字一致性 | 建议 |
|---|---|---|---|
| A. 没装就**不显示**这一列 | 0 | — | ✅ 推荐（符合"不强制安装"） |
| B. 自己折叠 `request/header` 事件 + 自己实现 token 启发式 | 100+ 行、要读会话日志、跟着 DSH 事件格式走 | 与 dsh-context 的读数可能有偏差 | ❌ 不做（双实现、双口径） |
| C. 用 `ctx.tokenMeter.measure(session, 只含该服务器工具的 header)` 做差 | 依赖"过滤后的 header 仍能计价"这一未验证假设 | 未知 | ❌ 不做（假设未验证） |

**结论**：候选 1 是"装了 dsh-context 才有"的增强，正好符合目标第 2 条——不装就少一列，其它一切照旧。

### 候选 1：MCP 行显示「每轮固定 tokens」（二期，价值最高）

- **用户问题**：这台 MCP 值不值得开？它每轮白占多少上下文？
- **价值**：管理页第一次能回答"开着的代价"。实测里 tavily 一台就占工具定义的 14.2%，这个数字直接影响启停决策。
- **取数**：宿主新增一条只读路由（如 `POST /api/service-manager/context-cost`），内部按 §4.1 的契约读 `contextHeaders` → 取最新 header 的 `tools[]` → 按 `mcp__<server>__*` 聚合成 server → tokens。join 用本项目已有的 `readToolIndex` 正则。**不碰 dsh-context 的代码与路由**。
- **降级**：`absent` 时整列不出现（不是显示 0），理由与替代方案见 §7.1。
- **验收**：同一会话下，行内 tokens 之和 = 该 header 里 MCP 工具 tokens 之和；与 dsh-context 面板"工具定义"读数同口径；缺装 profile 下页面无差异。

### 候选 2：技能卡显示「近 N 天使用了 N 次 / 最近使用」

- **用户问题**：这个技能还有用吗？删掉会不会影响我？
- **价值**：现有技能页只能"看描述、删文件"，加上使用频次，"删"才有依据。
- **取数**：`contextActivity.days[*].skills` 的 `{ n, last }`，按技能名 join `scanSkills()` 的 `name`。走 `POST /api/dsh-context/snapshot`（不带 `ids` = 全部会话）；本机 121 个会话，所以**打开技能页才发一次、结果缓存到页面刷新**，不要随每次渲染请求；0.83+ 还能带回 `revision`，下次带上即可拿 `unchanged`。
- **降级**：`absent` 时不显示；技能列表本身不受影响。
- **验收**：计数与 dsh-context 洞察页"技能加载"卡片一致（±1 天窗口内）。

### 候选 3：跳转到 dsh-context 的洞察页

- **价值**：管理面看到"贵/异常"，一键到观测面看明细，不用自己去侧栏找。
- **取数**：`ctx.layout.selectPanel("dsh-context")`。
- **降级**：`absent` 时不渲染入口。
- **验收**：点一下能切到它的洞察页；未装时两个页面都照常。

### 候选 4（当前不建议）：安装前预估「装上后会增加多少 tokens」

- dsh-context 只统计**已经进入请求**的工具定义；一个还没装的服务器，任何投影里都没有它。
- 本项目能算的是"工具 JSON schema 的 token 估算"，但那要自己实现 DSH 的密度启发式，且与真实请求口径不一致（README 明说数值是估算）。
- 结论：**记入待议**，除非用户明确要"预估"，否则不做。

### 候选 5（可选）：技能列表改用它的 `/api/dsh-context/skills`

- 它的 route 会按 **session 的 cwd + agent preset scope** 解析技能注册表，理论上比固定扫两个目录更准确。
- 代价：把"技能来源"的权威性从本项目转交给另一个插件；它缺装时行为要回退到今天的扫描逻辑（双实现、双口径）。
- 结论：**不建议**作为联动内容，除非用户就是要"和模型看到的完全一致"。

---

## 8. 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| 版本漂移已发生 | 本机 0.82.1，npm 最新 0.83.0：`contextTimeline` 的 `stateVersion` 38→41，路由 9→13 | 只用 `contextHeaders` / `contextActivity` / `/snapshot`（本轮比对全部未变）；基线写 0.82.x–0.83.x，升级前重跑 §3.1 的比对 |
| 第三方私有接口 | 作者没有把路由/投影当公开 API 发布（README 只写 UI）；0.82.x 之后可能改名、改形状 | 只用少量字段（B 的两个 key、A 的 `contextHeaders`）+ 防御式读取 + 探测失败即隐身；把接口约定写进本文档，升级时对照 |
| 版本双门槛 | 本项目支持 DSH ≥ 0.2.0-rc.1，dsh-context 要 ≥ 0.2.0-rc.2 且装旧版本时给占位值 | 用 `unsupported` 字段区分三态，不把"key 在"当"能用" |
| 认证边界 | 路由要浏览器 cookie，宿主侧 fetch 一律 401（实测） | 数据读取只在页面发起；宿主不引入"后台轮询另一个插件"的设计 |
| 性能 | `/snapshot` 会遍历所有会话算投影；本机 121 条会话缓存行、单行最大约 1.05 MB | 进页面才探测；结果在页面内缓存；不做轮询；只取需要的字段 |
| 口径混用 | `contextTimeline.toolsTokens` ≠ 最近 header 的工具 tokens（19,399 vs 19,717） | UI 上固定一个口径并写进 tooltip；不跨来源相加 |
| 隐私 | 投影里含文件路径、命令、提示词片段 | 只读聚合数字（tokens / 次数 / 时间），不落盘、不展示文本内容 |
| 用户关掉入口 | dsh-context 的 `insightsEntry: hide` 会让它不注册 `main` 面板，深链必然失败 | 深链失败静默隐藏入口；不当成"未安装"去提示安装 |
| 审阅负担 | 与一个 825 KB 客户端、112 KB 宿主的第三方插件耦合 | 只走「HTTP 路由 + DSH 投影服务 + 面板 id」，不 import、不复制它的代码 |

---

## 9. 结论与下一步

**可行性结论：成立。** 不需要 dsh-context 配合，也不改变本项目在"只装自己"时的任何行为。

**已按建议顺序落地（0.13.0，见 §10）**：候选 2 + 3（纯客户端）与候选 1（宿主只读路由 + 成本列）都已实现并跑过离线断言。

**实施触点**（真动代码时落在这几处，避免散开）：

| 文件 | 改动 | 状态 |
|---|---|---|
| `client.tsx` | `contextBridge`：探测 / 读技能用量 / 读成本 / 深链 + 相对时间 | ✅ |
| `client.tsx` → Skills 卡片 | 卡片底部一行「近 7 天 N 次 · 最近 …」 | ✅ |
| `client.tsx` → MCP 工具栏 | 「查看上下文明细」入口（`ctx.slots.entries("main")` 有 `dsh-context` 才渲染） | ✅ |
| `client.tsx` → MCP 表头/行 | 「每轮 tokens」列 + 窄容器隐藏 | ✅ |
| `index.js` | 路由 `POST /api/service-manager/context-cost` + `readContextCost()` | ✅ |
| `test/render-smoke.mjs` / `test/host-smoke.mjs` | absent / ok 两套断言 | ✅ |
| `package.json` | **未加依赖**、**未改 `dsh.client.inject`** | ✅ 保持 |

---

## 10. 已实现（0.13.0）

三件事都做完了，且都按 §6 的降级规则实现。

### 10.1 用户能看到什么

| 位置 | 装了 dsh-context | 没装 / 版本太旧 |
|---|---|---|
| MCP 表格 | 多一列「每轮 tokens」：`2,801`；窄容器自动隐藏该列 | 表格列数与以前一模一样 |
| MCP 工具栏 | 多一个「查看上下文明细」按钮，跳到它的洞察页 | 按钮不渲染 |
| 技能卡 | 卡片底部一行「近 7 天 3 次 · 最近 2 小时前」 | 不渲染这一行 |

### 10.2 实现要点（与 §4 的契约一一对应）

- **宿主**：`index.js` 的 `readContextCost(ctx)` 读 `sessionProjections.snapshot`（活会话）/ `sessionProjectionCache.cachedSnapshot`（冷会话），取最新 `contextHeaders` 的 `tools[]`，按 `mcp__<server>__*` 聚合；路由 `POST /api/service-manager/context-cost` 返回 `ok: true` + `available: true/false`。`readContextUsage` 从 `contextActivity.days[*].skills` 折叠近 7 天。**冷会话扫描必须先 `await sessionQuery.listSessions()`，并且取头部前 N 条**（见 §10.5）。
- **客户端**：页面**不再请求 dsh-context 的任何路由**；成本与技能用量都来自宿主的两条只读路由（`context-cost` / `context-usage`）。深链先问 `ctx.layout.hasMainPanel("dsh-context")`（和 `selectPanel` 内部是同一个注册表），旧版本退回 `ctx.slots.entries("main")`。
- **为什么不用它的 HTTP**：它 0.82.1 的 `/snapshot` 会为**所有**会话折叠 `contextTimeline`，本机 121 条会话时又慢又重；`contextActivity` 只是一张按天小账本，宿主读它几乎零成本。
- **不改契约**：`package.json` 没有新增依赖，`dsh.client.inject` 没动，也没有任何 `require("dsh-context")`。

### 10.3 验收

离线（本机已跑通）：

```sh
node scripts/build.mjs
node test/render-smoke.mjs   # 新增 8 个用例：成本列有/无、深链有/无、技能频次有/无、抽屉里的频次有/无
node test/host-smoke.mjs     # 66 项：含「没有 dsh-context 时 available:false」与假投影聚合 9 项
```

真机数据抽查（直接读本机投影缓存里的 `contextActivity`，与 `/snapshot` 返回同源）：近 7 天技能加载为 `impeccable 10`、`diagnose-windows-sandbox-acl 3`、`official-plugins 3`、`create-rule 1`——装了 dsh-context 的机器上，卡片上就会是这些数字。

想先看长相、不装插件：`node docs/preview/serve.mjs`，打开 `http://127.0.0.1:4173/docs/preview/`——示例数据里已经"装了" dsh-context，新列、按钮、技能频次都能看到。

真机（需要做一次）：

1. 把本仓库更新到插件目录（或在插件页里重装 / 更新），**重启 DSH**（Host 半区变了）；
2. 刷新页面：MCP 页应出现「每轮 tokens」列与「查看上下文明细」按钮，技能卡有使用频次；
3. 把 dsh-context 卸掉再刷新：三处都消失、页面无报错——这就是 §6 的验收条件。

### 10.4 与可行性阶段的偏差

- 深链原计划用 try/catch；实现改成**先查注册表再点**（§6.4 已更新），更干净。0.13.1 起判定优先用 `ctx.layout.hasMainPanel`，`ctx.slots.entries` 仅作兜底。
- 宿主路由**不返回 404**：没数据时返回 `ok: true, available: false`。404 的语义是"路由不存在"，而这里路由一直在，只是没数据。
- **技能用量不走它的 HTTP**：0.82.1 的 `/snapshot` 给所有会话折叠时间线，会话一多就慢；改成宿主读 `contextActivity` 投影（0.13.1）。功能不变，页面少一个失败点。
- 没有实现候选 4（安装前预估：核心无逐工具数据）与候选 5（改用它的技能接口：权威性转移）——理由见 §7。

### 10.5 踩坑记录：`listSessions()` 是 async，而且最新在前（0.13.2 修）

现场症状很难对号入座：**MCP 页的「每轮 tokens」列正常，技能卡上的使用频次一行都没有**。原因在宿主的 `collectProjectionValues`：

| 坑 | 事实（DSH `app.asar` 源码） | 后果 |
|---|---|---|
| 同步取 Promise | `SessionQueryEngine.listSessions(signal)` 与 `SessionCorpus.listSessions` 都是 `async` | `const metas = query.listSessions()` 拿到 Promise，`Array.isArray(metas)` 恒假 → **冷会话那半段是死代码** |
| 顺序 | `SessionCorpus.listSessions` 末尾 `return [...records.values()].sort(compareSessions)`，而 `compareSessions` 是 `b.createdAt - a.createdAt` = **最新在前** | 原来的 `slice(-coldLimit)` 取到最老的 N 条，最近几天被整体跳过 |

为什么"只有成本列坏不掉"：活会话（当前打开的那条）本身就带 `contextHeaders`，成本列靠它就够了；而 `contextActivity` 里的技能记录分布在**历史会话**里，恰好在坏掉的那半段。

修法与回归：

- `collectProjectionValues` 改 async、`await listSessions()`、取 `slice(0, coldLimit)`；两条路由 `await readContextCost / readContextUsage`。
- `test/host-smoke.mjs` 的假 `listSessions` 改成 `async`（照抄真服务形状），并新增两条用例：**「活会话没有技能记录时，仍从冷会话检查点聚合」**与**「70 条语料里只有最新那条有数据」**——这两条在旧实现下必然失败。
- 兜底思路不变：仍旧只在有数据时渲染，没有数据时整行不存在（§6.3）。

---

## 附录：证据位置与复现命令

| 证据 | 路径 / 命令 |
|---|---|
| dsh-context 安装位置与版本 | `~/.dsh/profiles/desktop/node_modules/dsh-context/package.json`（`0.82.1`） |
| 它注册的投影与路由 | `~/.dsh/profiles/desktop/node_modules/dsh-context/lib/index.js`（`register({key:'contextHeaders'…})`、`/api/dsh-context/snapshot`） |
| 它的面板注册 | `…/lib/client.js` 末尾：`slots.register({ name: 'main', key: 'dsh-context' … })`、`sidebar.panellist` id `dsh-context` |
| 投影注册表契约（官方） | DSH 包 `@deepseek-ai/dsh-session-projection` 的 `README.zh.md`（"可选贡献方可以在 `ctx.inject(['sessionProjections'], …)` 下注册。载体使用 `ctx.get('sessionProjections')`，注册表缺席时省略自己的块或帧"） |
| `main` 面板与 `selectPanel` 语义（官方） | `@deepseek-ai/dsh-client-ui-layout` 的 `README.zh.md`（"缺失的 key 会抛错并保留当前面板"） |
| 客户端 `inject` 是软依赖 | `@deepseek-ai/dsh-client-modules` 的 `lib/client.js`（`arriveGraphRow`：`graphRows.get(pkg)` 取不到即跳过） |
| `selectPanel` 源码 | `@deepseek-ai/dsh-client-ui-layout/lib/client.js`：`ctx.reflect.provide("layout", …)`、`hasMainPanel = ctx.slots.entries("main").some(e => e.options.key === id)`、不命中时 throw |
| 未认证 401 | `POST http://127.0.0.1:4554/api/dsh-context/snapshot` → 401；`POST /api/definitely-not-a-route-xyz` → **也是 401** |
| 投影缓存实例 | `~/.dsh/storages/session_projcache/sessions/<sessionId>.json`（`record.rows.contextTimeline / contextHeaders / contextActivity`） |
| 口径验证脚本 | `node docs/integration/spike-server-cost.mjs`（§5.5，离线复算 MCP tokens） |
| 版本漂移比对 | 下载 `https://registry.npmjs.org/dsh-context/-/dsh-context-0.83.0.tgz` 解包，比对 `lib/index.js` 里的 `stateVersion`、`/api/dsh-context/*` 字面量与 `key:\`context*\`` |
| 核心有无逐工具 token | `@deepseek-ai/dsh-token-meter` 的 `README.zh.md`（`measure()` 只回 `totalTokens`/`surfaceTokens`/`nodes[]`）；缓存里 `contextBreakdown.breakdown.toolsTokens` 为单个合计 |

复现 §5 数字（PowerShell）：

```powershell
$f = (Get-ChildItem "$env:USERPROFILE\.dsh\storages\session_projcache\sessions" -File |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$j = Get-Content $f -Raw | ConvertFrom-Json
$h = $j.record.rows.contextHeaders.val.headers[-1]
$h.tools | Where-Object { $_.name -like 'mcp__*' } |
  Select-Object name, tokens
($h.tools | Where-Object { $_.name -like 'mcp__*' } | Measure-Object tokens -Sum).Sum
$j.record.rows.contextActivity.val.days.PSObject.Properties |
  ForEach-Object { "$($_.Name): " + (($_.Value.skills.PSObject.Properties |
  ForEach-Object { "$($_.Name)=$($_.Value.n)" }) -join ', ') }
```

> 本文不包含任何密钥。`mcp-servers.yml` 中的示例服务器 URL 已隐去参数。
