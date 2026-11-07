# DSH 服务管理页

> 在 DeepSeek Harness 里，一个页面管完 MCP 服务器和 SKILL：查看、安装、启停、删除，浏览技能，用你自己的模型把英文摘要翻成中文，顺便看看谁被用得多。

![页面走查](docs/screenshots/tour.gif)

DSH 官方没有 MCP 管理界面——想加一台服务器只能手改 YAML，想确认它连上没有只能回会话里试。这个插件补上这块，并且**不碰你的 DSH 配置文件**：它通过官方 Include 机制加载自己独占的一个文件。

## 它做什么

侧边栏多一个入口，点开是一个整页，三个标签页：

| 标签 | 能做什么 |
|---|---|
| **MCP 服务器** | 列表 + 增删改 + 启停开关；展开看每个工具的中文摘要，点开是带参数说明的抽屉 |
| **技能** | 列出所有 SKILL，摘要可翻译（模型可选）、可切回原文、可删除 |
| **调用统计** | 每个 MCP 工具和技能被调用了多少次，累计从安装当天起算 |

## 安装

**前提**：DeepSeek Harness `>= 0.2.0-rc.1 < 0.3.0`，且 `pnpm` 在 `PATH` 上。

打开 **设置 → 插件**，把下面任意一个填进安装框：

```
github:Baisbt/Baisbt-dsh-service-manager
```

或者：

```
https://github.com/Baisbt/Baisbt-dsh-service-manager
```

装完刷新页面，侧边栏会出现「服务管理」。

> 也可以用 npm 包名安装，等发布到 npm 之后可用。

> ⚠️ 从别的来源重装同一个包之前（比如先装过本地目录），请先清掉 `node_modules/dsh-service-manager` 残留，否则会报 `ERR_PNPM_EPERM`。原因和修法见下方[常见问题](#常见问题)。

## 截图

### MCP 服务器

![MCP 列表](docs/screenshots/01-mcp.png)

行尾常驻三个操作：编辑、删除、启停开关。配置写入只发生在本插件独占的文件里。

### 展开看工具

![工具列表](docs/screenshots/02-mcp-tools.png)

每个工具一行摘要，超出折成省略号，鼠标悬停看英文原文。摘要同样可以翻译。

### 工具详情

![工具抽屉](docs/screenshots/03-tool-drawer.png)

抽屉分两层：上面是中文摘要和译文来源（模型译 / 机翻），下面是参数表，参数说明也翻译过，参数名保持英文——那是调用时要写的标识符。

### 技能

![技能列表](docs/screenshots/04-skills.png)

工具条上的 `译文 / 原文` 一键切换全部卡片。每张卡右下角的 ↻ 单独重翻，工具栏的「重新翻译全部」批量重翻。

### 调用统计

![调用统计](docs/screenshots/05-stats.png)

## 技能摘要翻译

- **用你自己的模型**：下拉框列出 DSH 里配置的所有 provider × model，默认取「默认模型」，选择会记住
- **落盘缓存**：译文存在 `~/.dsh/profiles/<profile>/.dsh-service-manager/translations.json`，第二次打开是零请求
- **只影响显示**：`SKILL.md` 一个字节都不改，注入给模型的仍然是英文原文
- **失败可见**：模型翻不动时退回机翻，卡片上明确标出「机翻」，不会假装成功

## 让 Agent 自己装 MCP

插件同时注册了一个 Agent 工具 `mcp_service`，所以在会话里直接说「帮我把 filesystem 这个 MCP 装上」就行，不用切页面。

| 动作 | 说明 | 需要审批 |
|---|---|---|
| `list` | 列出服务器、传输方式、状态、工具数 | 否 |
| `install` | 新增或更新一台服务器 | **是** |
| `remove` | 删除 | **是** |
| `enable` / `disable` | 启停 | 否 |

审批走 DSH 官方的一次性授权接口：拒绝、取消、或无可用应答方时**一律不改配置**，失败闭合。参数不合法会在弹窗之前就报错，不拿无效请求打扰你。

## 安全边界

- 只写自己的文件：`<profile>/mcp-servers.yml`（生成）+ `<profile>/.dsh-service-manager/servers.json`（数据源）
- **不修改** `cordis.patch.yml`、`cordis.yml`、`.credentials.yaml`
- 密钥建议写成 `${ENV_NAME}`，加载时从环境变量读取，配置文件里不留明文
- Host 代码在 DSH 进程内运行，不受工作区沙箱限制——安装前请确认来源

## 工作原理

```
cordis.patch.yml (插件自带)
  └─ service-manager            ← 本插件 Host 半区（路由 + Agent 工具 + 翻译）
  └─ service-manager-mcp
       cordis:include → ./mcp-servers.yml    ← 本插件生成、独占的 MCP 行
```

页面通过 `ctx.connection.fetch.register` 提供的 `/api/service-manager/*` 路由读写数据；改完文件后触发 include 子树刷新，MCP 服务器在后台重连，前端轮询重连状态而不是干等。

## 兼容性

- DSH `>= 0.2.0-rc.1 < 0.3.0`
- 明暗主题都走 DSH 的设计 token，自动跟随
- 桌面端（Windows / macOS / Linux）均可用：「打开配置目录」按平台走 `explorer.exe` / `open` / `xdg-open`

## 卸载

在 **设置 → 插件** 里卸载即可。有两件事值得先知道：

- **不删你的数据**：`<profile>/mcp-servers.yml` 和 `<profile>/.dsh-service-manager/`（服务器列表、翻译缓存、调用统计）都会留在原地。想彻底清干净，手动删掉这两个。
- **MCP 服务器会跟着消失**：它们由本插件自带的 `cordis:include` 行加载，插件没了这行也就没了。重新装回来即可，配置和数据都还在。

## 常见问题

### 安装报 `ERR_PNPM_EPERM: operation not permitted, rename ...`

换安装来源时最容易遇到——比如先装本地目录、再装 GitHub 版：

```
[ERR_PNPM_EPERM] [importPackage ...\node_modules\dsh-service-manager]
EPERM: operation not permitted, rename '...dsh-service-manager_tmp_1234_2' -> '...\dsh-service-manager'
```

**原因**：DSH 的卸载只改 `package.json`，**不会删除 `node_modules` 里已装好的目录**。pnpm 安装时要先把包解到临时目录，再 rename 成正式目录名，而这个位置上已经存在一个目录——Windows 不允许 rename 覆盖非空目录，于是报 EPERM。

所以这个错**跟插件是否在运行、重启多少次都无关**，重启是没用的。

**修法**：先删掉残留目录，再重新安装。

```cmd
:: 如果是 Junction（本地 link 安装留下的）——只删链接，源码不受影响
cmd /c rmdir "<profile>\node_modules\dsh-service-manager"

:: 如果是真实目录——执行前务必确认路径，这条会真的删文件
cmd /c rmdir /s /q "<profile>\node_modules\dsh-service-manager"
```

Windows 上 `<profile>` 一般是 `%USERPROFILE%\.dsh\profiles\desktop`。

> 判断是哪一种：`dir "<profile>\node_modules" | findstr dsh-service-manager`，带 `<JUNCTION>` 标记的是链接。

### 装完侧边栏没出现

刷新页面（`Ctrl+R`）。Host 半区装完立即生效，前端 bundle 需要重新加载一次。

### GitHub 安装卡很久

日志里出现 `HEAD https://github.com/... ETIMEDOUT` 是网络抖动，pnpm 会自动重试。实测首次安装约 1～2 分钟，慢是正常的。

### 翻译一直停在「翻译中」

单条请求超时 45 秒，整批总预算 75 秒。先确认 **设置 → 模型** 里的默认模型可用，再点卡片右下角的 ↻ 重试；也可以在上方下拉框换一个模型。

## 开发

仓库里没有构建步骤——`index.js` 和 `client.js` 都是直接运行的 ESM。

```bash
# 离线渲染冒烟：用最小 React 替身把三页和抽屉都渲染一遍
node test/render-smoke.mjs
```

截图不是手截的，是用真实组件 + 真实 CSS + 真实设计 token 在无头浏览器里渲染的，示例数据在 `docs/preview/fixtures.json`：

```bash
node docs/preview/serve.mjs   # 打开 docs/preview/index.html 预览
```

## License

[MIT](LICENSE)
