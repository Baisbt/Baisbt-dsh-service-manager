# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

平台强制，不是自由选择：这是一个 DeepSeek Harness（DSH）插件。

- Host 半区：手写 ESM `index.js`，由宿主直接加载，无编译步骤、不引入打包器。
- Client 半区：TypeScript + JSX 的 `client.tsx`，用 `tsc` 编译成单文件 `client.js`（无打包器、无第二个运行时），通过宿主的 `window.__ModuleLoader__.load({id, factory})` 外壳注册；React 从宿主的冻结模块表取，绝不打包。
- 禁用：任何 UI 组件库、外部图标/字体 CDN。颜色只取宿主 `--dsw-alias-*` 设计 token。

## Users

DSH 用户。近期唯一使用者是作者本人，但**目标是分发给其他 DSH 用户安装**，因此界面文案必须自解释，不能依赖作者的口头说明。

他们正在做的事：给 DSH 接入外部 MCP 服务器、整理本地 SKILL 文件，然后回到会话里用它们。当前没有任何可视化入口——MCP 只能手改 YAML，SKILL 只能在目录里翻。

## Product Purpose

让 DSH 用户在一个页面里看清"我有哪些 MCP 服务器和技能、它们是什么状态"，并且不离开 DSH 就能安装、编辑、启停、删除 MCP 服务器。

成功的标准：用户能在这一个页面里完成"从零接一台 MCP 服务器，并确认它能用"，全程不需要打开文本编辑器。

## Positioning

DSH 官方不提供任何 MCP 管理界面——580 个随包产物里，MCP 命名的包只有 2 个，设置页与官方 bundle 名单里 MCP 命中为 0。本产品是第一个把"MCP 服务器"当一等公民管理的页面，并且**不修改用户的 DSH 配置文件**：它通过官方 Include 机制加载自己独占的文件。

## Operating Context

- 宿主是 DSH 桌面应用（Electron）；页面嵌在右侧主工作区里，左侧会话栏会占掉一部分宽度。
- 典型工作流：在会话里跟 AI 干活 → 发现缺能力 → 打开服务管理页 → 装/改/停 → 返回会话继续。
- 服务器只有一个来源：本页创建。插件只读写自己通过 `cordis:include` 独占的 `mcp-servers.yml`；其他插件插入的、用户手写进 `cordis.yml` 的服务器**不会出现在本页**，也不会被本页改动。

## Capabilities and Constraints

已确认：

- 两个视图：MCP 服务器（增删改查 + 启停）、技能（浏览、翻译摘要、删除）。
- 入口在侧边栏，点击后主工作区整页切换，可一键返回会话。
- 本页之外配置的 MCP 服务器：不在本页展示，本页也不提供任何修改它们的入口。
- 技能没有官方开关，所以「删除」实现为把 `SKILL.md` 改名为 `SKILL.md.disabled-<时间戳>`，改回原名即可恢复；不提供新建与编辑。
- 安装/删除 MCP 需要用户审批；启停不需要。
- 版本自述：`GET /api/service-manager/version` 返回「磁盘 / 进程 / 页面」三个读数，页面据此自己判断要不要重启或刷新。Host 进程只在启动时加载一次 `index.js`，所以这是唯一可靠的判据。
- 可选联动（0.13.0，需要在**另一个插件** dsh-context 装着时才出现）：MCP 表格多一列「每轮 tokens」、工具栏多一个「查看上下文明细」深链、技能卡多一行「近 7 天使用频次」。
  - 数据只读：宿主读 DSH 的会话投影 `contextHeaders`（它由 dsh-context 注册），页面读它的 `/api/dsh-context/*` 路由或直接点它的面板；**不 import、不配置、不要求安装**。
  - 约束：不写进 `dependencies`、不改 `dsh.client.inject`；它缺席时这三处一律不渲染，绝不显示 0 或提示安装。

技术约束（硬）：

- 不能用 UI 组件库，控件自己画。
- 颜色只能取 `--dsw-alias-*` token，必须同时适配明暗主题。
- 图标内联 SVG + `currentColor`，不能引外部 CDN。
- 容器宽度 ≠ 窗口宽度，必须按容器自适应，不能用 `100vw`。
- 不能 iframe，不能读其他插件的 DOM。

未决：

- 是否支持从其他工具（Claude Desktop / Cursor）导入 `mcpServers` 配置——技术上会丢语义（sse / oauth / inputs 无落点），暂不做。

## Brand Commitments

沿用 DSH 的界面语言与视觉基调，不建立独立品牌。这个页面必须看起来像 DSH 自己的一部分，而不是一个外挂工具。

## Evidence on Hand

- 本机现有 **0 台 MCP 服务器**、10 个可见技能（用户级目录 12 个，其中 2 个被作者设为不可被模型自动调用）。第一版上线时 MCP 列表是空的——**空态必须认真设计**。
- 平台 API 与视觉约束的调研结论见 `mcp-research/findings/`（8 份）与 `mcp-research/服务管理页-前端设计需求.md`。

## Product Principles

1. **一屏看清状态**：打开就要知道"哪台能用、哪台坏了"，不需要点进去找。
2. **不碰用户的东西**：外部配置只读；写入只发生在自己独占的文件里。
3. **说人话**：错误信息必须给出下一步，不暴露 SDK 术语。
4. **工具型密度**：信息优先于留白，向 DSH 自带的「插件」页看齐。
5. **失败必须可见**：后台加载失败在 DSH 里是静默的，界面必须主动暴露。

## Accessibility & Inclusion

- 状态不能只靠颜色区分（色盲友好）：必须同时有图标或文字。
- 键盘可达：所有操作可用 Tab + Enter 完成；弹层有焦点管理。
- 明暗两套主题都必须通过 token 自动适配，不写死颜色。
