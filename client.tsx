/**
 * 服务管理页 · Client 半区
 *
 * 源码是 client.tsx（TypeScript + JSX），本文件由 `pnpm build` 生成，不要手改。
 * 产物的运行形态没有变：仍然是一个调用 window.__ModuleLoader__.load({ id, factory }) 的普通脚本，
 * factory 用宿主给的 require 从静态模块表里取 react，不打包 React，也不产生 ESM 语法。
 *
 * 设计立场（与前一版一致）：
 *  - 这个页面是 DSH 的一部分，不是外挂工具：只用宿主的设计 token，明暗自动跟随
 *  - 状态不只靠颜色：圆点 + 文字，色盲友好
 *  - 焦点、动效、三态（加载 / 空 / 错误）各有一套统一策略，见 CSS 段
 */

/* ------------------------------------------------------- 类型（编译期擦除） */

type CSSProperties = import("react").CSSProperties;
type ReactNode = import("react").ReactNode;
type MouseEventOf<T extends Element> = import("react").MouseEvent<T>;
type KeyboardEventOf<T extends Element> = import("react").KeyboardEvent<T>;
type Translate = (key: string) => string;

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ToolInfo {
  name: string;
  description: string;
  params: ToolParam[];
}

interface ServerView {
  id: string;
  serverName: string;
  transport: string;
  endpoint: string;
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  toolCount: number | null;
  tools: ToolInfo[];
  status: string;
  managed: boolean;
  note?: string;
}

interface SkillInfo {
  name: string;
  description: string;
  scope: string;
  modelInvocable: boolean;
  path: string;
}

/** 一条译文：text 是目标语言的正文，engine 记录来源（model / machine / source / none）。 */
interface TranslationEntry {
  text?: string | null;
  engine?: string;
  model?: string | null;
  at?: string | null;
  cached?: boolean;
}

interface ModelRef {
  provider: string;
  model: string;
}

interface ProviderEntry {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

interface ModelCatalog {
  providers: ProviderEntry[];
  failures?: { id: string; message: string }[];
  selected?: ModelRef | null;
  saved?: ModelRef | null;
  recommended?: ModelRef | null;
}

interface VersionInfo {
  ok?: boolean;
  stale?: boolean;
  unknown?: boolean;
  missing?: boolean;
  running?: { version?: string | null; startedAt?: string | null; pid?: number; node?: string | null } | null;
  disk?: { version?: string; mtime?: string } | null;
  build?: { version?: string; commit?: string; built?: string } | null;
  dir?: string;
  profileDir?: string;
}

/**
 * 与 dsh-context 的联动是**可选**的：它不在（或版本太旧）时本页一切照旧，
 * 只是这几块读数不出现。probe 把「没装」和「装了但用不了」分开，UI 才不会说错话。
 */
type ContextProbe = "unknown" | "absent" | "unsupported" | "ok";

interface ContextCostServer {
  serverName: string;
  tools: number;
  tokens: number;
  share: number;
}

interface ContextCost {
  available: boolean;
  headerSeq?: number | null;
  headerTime?: number | null;
  toolCount?: number;
  totalToolTokens?: number;
  servers?: ContextCostServer[];
}

interface SkillUsage {
  n: number;
  last: number;
}

interface ContextState {
  probe: ContextProbe;
  cost?: ContextCost | null;
  usage?: Record<string, SkillUsage>;
}

interface AppState {
  loading: boolean;
  error: string;
  servers: ServerView[] | null;
  skills: SkillInfo[] | null;
  version: VersionInfo | null;
  context?: ContextState;
}

/** 位（slot）注册后宿主给回来的插件上下文，只用到几个方法，其余放宽成 any。 */
type PluginCtx = any;

(window as any).__ModuleLoader__.load({
  id: "dsh-service-manager",
  factory(require: (id: string) => any) {
    const React = require("react") as typeof import("react");
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    /**
     * tooltip 要 portal 到 body：行里有 overflow:hidden，气泡留在行内会被裁掉。
     * 宿主的静态模块表里有 react-dom；Node 里的渲染测试没有，拿不到就降级成不显示。
     */
    let createPortal: typeof import("react-dom").createPortal | null = null;
    try {
      const reactDom = require("react-dom") as any;
      const portal = reactDom?.createPortal ?? reactDom?.default?.createPortal;
      if (typeof portal === "function") createPortal = portal;
    } catch {
      createPortal = null;
    }

    const NS = "service-manager";
    const PANEL_ID = "service-manager";

    /**
     * 由 scripts/stamp.mjs 写入。用来判断「页面里这份 JS 是不是旧构建」——
     * 版本号本身以 Host 读到的 package.json 为准，这里只提供 commit 供比对。
     * 构建戳打在源码上，编译时原样落到 client.js。
     */
    const BUILD = { version: "0.13.2", commit: "429380e", built: "2026-11-10T01:50:21.557Z" };

    /* ---------------------------------------------------------------- 文案 */

        const PRESETS = [
      {
        id: "tavily",
        labelKey: "presetTavily",
        values: {
          serverName: "tavily",
          transport: "streamable-http",
          url: "https://mcp.tavily.com/mcp/?tavilyApiKey=${TAVILY_API_KEY}",
          headers: [],
          note: "Tavily 搜索与网页提取",
        },
      },
      {
        id: "github",
        labelKey: "presetGithub",
        values: {
          serverName: "github",
          transport: "stdio",
          command: "npx",
          args: "-y\n@modelcontextprotocol/server-github",
          cwd: "",
          env: [{ k: "GITHUB_PERSONAL_ACCESS_TOKEN", v: "${GITHUB_TOKEN}" }],
          note: "GitHub issue / PR 操作",
        },
      },
      {
        id: "filesystem",
        labelKey: "presetFilesystem",
        values: {
          serverName: "files",
          transport: "stdio",
          command: "npx",
          args: "-y\n@modelcontextprotocol/server-filesystem\nD:\\",
          cwd: "D:\\",
          note: "把本机目录暴露给模型",
        },
      },
      {
        id: "fetch",
        labelKey: "presetFetch",
        values: {
          serverName: "fetch",
          transport: "stdio",
          command: "uvx",
          args: "mcp-server-fetch",
          cwd: "",
          note: "抓取网页正文",
        },
      },
    ];

        const MESSAGES = {
      zh: {
        nav: "服务管理",
        back: "返回会话",
        title: "服务管理",
        sub: "MCP 服务器与技能的统一入口。改动会直接写进配置，下次对话即可使用。",
        refresh: "刷新",
        tabs: { mcp: "MCP 服务器", skill: "技能" },
        search: "搜索服务器…",
        add: "新增服务器",
        colName: "名称",
        colEndpoint: "传输 / 端点",
        colStatus: "状态",
        colTools: "工具",
        colActions: "操作",
        statusConnected: "已连接",
        statusConfigured: "已加载",
        statusDisabled: "已停用",
        statusFailed: "连接失败",
        emptyTitle: "还没有 MCP 服务器",
        emptyBody: "MCP 服务器让 AI 能调用外部工具。加上一台，它提供的工具会立刻出现在对话框里。",
        emptyAdd: "新增第一台",
        emptyOpen: "打开配置文件",
        loading: "正在读取…",
        errorTitle: "读取失败",
        retry: "重试",
        verStaleTitle: "插件已更新，重启 DSH 后生效",
        verStaleBody: "当前页面来自磁盘上的新版本，但 Host 进程还在跑旧版本。重启一次 DSH 即可。",
        verMissingTitle: "Host 比页面旧，缺少版本接口",
        verMissingBody: "磁盘上的页面已带版本接口，正在跑的 Host 还没有（早于 0.8.0）。重启一次 DSH 即可。",
        verPageTitle: "页面里是旧版界面",
        verPageBody: "刷新页面即可载入新版本；刷新后仍提示说明构建戳没更新。",
        verUnknown: "读不到磁盘上的 package.json，无法判断是否需要重启。",
        verDisk: "磁盘",
        verRunning: "进程",
        verStarted: "启动于",
        verDismiss: "忽略",
        showInFiles: "在文件管理器中显示",
        edit: "编辑",
        remove: "删除",
        enable: "启用",
        disable: "停用",
        removeConfirm: "删除后这台服务器会从配置里移除，模型将无法再调用它的工具。",
        cancel: "取消",
        close: "关闭",
        confirmRemove: "确认删除",
        save: "保存",
        saving: "保存中…",
        formTitleNew: "新增 MCP 服务器",
        formTitleEdit: "编辑 MCP 服务器",
        fieldName: "服务器名",
        fieldNameHint: "模型看到的工具名前缀，例如 github 会得到 mcp__github__create_issue",
        fieldTransport: "传输方式",
        fieldCommand: "启动命令",
        fieldArgs: "参数",
        fieldArgsHint: "每行一个",
        fieldCwd: "工作目录",
        fieldCwdHint: "必填。留空服务器会启动失败。",
        fieldUrl: "服务地址",
        fieldEnv: "环境变量",
        fieldEnvHint: "值里写 ${NAME} 表示从环境变量读取，不会把明文写进配置文件。",
        fieldHeaders: "请求头",
        fieldHeadersHint: "值里写 ${NAME} 表示从环境变量读取，例如 Authorization: Bearer ${TAVILY_API_KEY}。",
        addPair: "添加一项",
        removePair: "移除",
        keyLabel: "键",
        valueLabel: "值",
        presetLabel: "从模板开始",
        presetNone: "不使用模板",
        presetTavily: "Tavily 搜索",
        presetGithub: "GitHub",
        presetFilesystem: "本地文件系统",
        presetFetch: "网页抓取（uvx）",
        envRefHint: "提示：任何字段里写 ${VAR} 都会在加载时从环境变量取，配置文件里不留明文。改完需要重启 DSH。",
        more: "更多",
        fieldNote: "备注",
        fieldNoteHint: "只显示在这里，不会给模型看",
        skillTitle: "技能",
        searchSkill: "搜索技能…",
        summaryLabel: "摘要",
        translating: "摘要翻译中…",
        translateModel: "翻译模型",
        translateModelHint: "技能摘要用这个模型翻译。只影响这里的显示，SKILL.md 本身不会改，注入给模型的仍是英文原文。",
        noModel: "没有可用模型",
        required: "必填",
        paramsLabel: "参数",
        toolNoDesc: "没有描述",
        toolPending: "服务器还没连上，工具列表会在连接后出现。",
        toolDisabled: "已停用，不加载工具。",
        reconnecting: "正在重连 MCP 服务器…",
        toolTransFailed: "部分工具摘要没翻译成功",
        retranslate: "重新翻译",
        retranslateAll: "重新翻译全部",
        translateRetry: "重试",
        viewMode: "显示语言",
        showTranslated: "译文",
        showOriginal: "原文",
        transModel: "模型译",
        transMachine: "机翻",
        transNone: "未译出",
        transBusy: "翻译中",
        noticeWaiting: "{n} 条摘要正在翻译…",
        noticeMachine: "{n} 条用了机翻，质量不如模型",
        noticeNone: "{n} 条没译出来",
        sourceLabel: "原文",
        searchNoResult: "没有匹配的技能",
        removeSkillConfirm: "技能文件会被改名（改成 SKILL.md.disabled-时间戳），DSH 将不再加载它。想恢复时把名字改回来即可。",
        skillEmpty: "没有找到技能",
        skillEmptyBody: "技能放在 ~/.agents/skills 或 ~/.dsh/skills 下，每个技能是一个含 SKILL.md 的目录。",
        skillHidden: "仅手动调用",
        skillScopeUser: "用户级",
        openFile: "打开配置文件",
        openFolder: "打开配置目录",
        externalNote: "由用户手工维护，本页仅展示",
        savedButRestart: "已写入，但需要重启 DSH 才能生效",
        colCost: "每轮 tokens",
        costHint: "最近一次请求里，这台服务器的工具定义占用的上下文（估算）。数据来自 dsh-context。",
        costMissing: "最近一次请求里没有这台服务器的工具记录（可能已停用或还没连上）。",
        costTotalHint: "最近一次请求里全部工具定义的合计估算。",
        openContext: "查看上下文明细",
        openContextHint: "在 dsh-context 的上下文洞察页里看完整构成",
        skillUsed7: "近 7 天 {n} 次 · 最近 {when}",
        skillIdle7: "近 7 天未用 · 最近 {when}",
        skillUsageHint: "使用次数来自 dsh-context，按技能被加载的次数计，只用于参考。",
        whenJustNow: "刚刚",
        whenMinutes: "{n} 分钟前",
        whenHours: "{n} 小时前",
        whenDays: "{n} 天前",
      },
      en: {
        nav: "Services",
        back: "Back to chat",
        title: "Services",
        sub: "One place for MCP servers and skills. Changes go straight into the config and are available in the next turn.",
        refresh: "Refresh",
        tabs: { mcp: "MCP servers", skill: "Skills" },
        search: "Search servers…",
        add: "Add server",
        colName: "Name",
        colEndpoint: "Transport / endpoint",
        colStatus: "Status",
        colTools: "Tools",
        colActions: "",
        statusConnected: "Connected",
        statusConfigured: "Loaded",
        statusDisabled: "Disabled",
        statusFailed: "Failed",
        emptyTitle: "No MCP servers yet",
        emptyBody: "MCP servers give the model tools from outside DSH. Add one and its tools appear in chat right away.",
        emptyAdd: "Add the first one",
        emptyOpen: "Open config file",
        loading: "Loading…",
        errorTitle: "Could not load",
        retry: "Retry",
        verStaleTitle: "Plugin updated — restart DSH to apply",
        verStaleBody: "This page comes from the newer copy on disk, but the Host process still runs the old one. Restart DSH once.",
        verMissingTitle: "Host is older than this page",
        verMissingBody: "The page on disk already ships the version endpoint; the running Host predates 0.8.0. Restart DSH once.",
        verPageTitle: "This page renders an older build",
        verPageBody: "Reload the page to pick up the new version; if the notice survives a reload, the build stamp was not updated.",
        verUnknown: "Could not read package.json on disk, so the restart check is unavailable.",
        verDisk: "disk",
        verRunning: "process",
        verStarted: "started",
        verDismiss: "Dismiss",
        showInFiles: "Show in file manager",
        edit: "Edit",
        remove: "Remove",
        enable: "Enable",
        disable: "Disable",
        removeConfirm: "Removing this server deletes it from the config; its tools disappear from the model.",
        cancel: "Cancel",
        close: "Close",
        confirmRemove: "Remove",
        save: "Save",
        saving: "Saving…",
        formTitleNew: "Add MCP server",
        formTitleEdit: "Edit MCP server",
        fieldName: "Server name",
        fieldNameHint: "Prefix of the tool names the model sees.",
        fieldTransport: "Transport",
        fieldCommand: "Command",
        fieldArgs: "Arguments",
        fieldArgsHint: "One per line",
        fieldCwd: "Working directory",
        fieldCwdHint: "Required. Leaving it empty makes the server fail to start.",
        fieldUrl: "Endpoint URL",
        fieldEnv: "Environment",
        fieldEnvHint: "A value like ${NAME} is read from the environment and never written to the config file in plain text.",
        fieldHeaders: "Headers",
        fieldHeadersHint: "A value like ${NAME} is read from the environment, e.g. Authorization: Bearer ${TAVILY_API_KEY}.",
        addPair: "Add",
        removePair: "Remove",
        keyLabel: "Key",
        valueLabel: "Value",
        presetLabel: "Start from a preset",
        presetNone: "No preset",
        presetTavily: "Tavily search",
        presetGithub: "GitHub",
        presetFilesystem: "Local filesystem",
        presetFetch: "Web fetch (uvx)",
        envRefHint: "Tip: writing ${VAR} anywhere makes DSH read it from the environment at load time, so no secret lands in the config file. Restart DSH after changing this.",
        more: "More",
        fieldNote: "Note",
        fieldNoteHint: "Shown here only, never sent to the model.",
        skillTitle: "Skills",
        searchSkill: "Search skills…",
        summaryLabel: "Summary",
        translating: "Translating summaries…",
        translateModel: "Translation model",
        translateModelHint: "Skill summaries are translated with this model. Display only — SKILL.md is never modified and the model still receives the English original.",
        noModel: "No model available",
        required: "Required",
        paramsLabel: "Parameters",
        toolNoDesc: "No description",
        toolPending: "Not connected yet — tools appear once the server connects.",
        toolDisabled: "Disabled, so no tools are loaded.",
        reconnecting: "Reconnecting MCP servers…",
        toolTransFailed: "Some tool summaries could not be translated",
        retranslate: "Translate again",
        retranslateAll: "Translate all again",
        translateRetry: "Retry",
        viewMode: "Display language",
        showTranslated: "Summary",
        showOriginal: "Original",
        transModel: "Model",
        transMachine: "MT",
        transNone: "Failed",
        transBusy: "Translating",
        noticeWaiting: "Translating {n} summaries…",
        noticeMachine: "{n} used machine translation",
        noticeNone: "{n} could not be translated",
        sourceLabel: "Original",
        searchNoResult: "No matching skills",
        removeSkillConfirm: "The skill file is renamed to SKILL.md.disabled-<timestamp>, so DSH stops loading it. Rename it back to restore.",
        skillEmpty: "No skills found",
        skillEmptyBody: "Skills live in ~/.agents/skills or ~/.dsh/skills as folders containing SKILL.md.",
        skillHidden: "Manual only",
        skillScopeUser: "User",
        openFile: "Open config file",
        openFolder: "Open config folder",
        externalNote: "Maintained by hand; read-only here",
        savedButRestart: "Saved, but DSH must restart for this to take effect",
        colCost: "Tokens / turn",
        costHint: "Estimated context cost of this server's tool definitions in the latest request. Data from dsh-context.",
        costMissing: "No tools from this server in the latest request (disabled, or not connected yet).",
        costTotalHint: "Estimated total of all tool definitions in the latest request.",
        openContext: "Context details",
        openContextHint: "Open the full composition in dsh-context's insights page",
        skillUsed7: "{n}× in 7 days · last {when}",
        skillIdle7: "Unused in 7 days · last {when}",
        skillUsageHint: "Usage comes from dsh-context and counts skill loads. For reference only.",
        whenJustNow: "just now",
        whenMinutes: "{n} min ago",
        whenHours: "{n} h ago",
        whenDays: "{n} d ago",
      },
    };

    const pick = (locale: string): Translate => {
      const base = MESSAGES[String(locale || "").toLowerCase().startsWith("zh") ? "zh" : "en"] ?? MESSAGES.en;
      return (key: string) => {
        const parts = key.split(".");
        let node: any = base;
        for (const part of parts) node = node?.[part];
        return typeof node === "string" ? node : key;
      };
    };

    /* ------------------------------------------------------------ 语言服务 */

    /**
     * 界面语言必须读宿主 locale 服务的 getLocale().active（返回 `zh` / `en`）。
     * 不能用 navigator.language：那是 Electron 启动参数 --lang 决定的，
     * 与用户在设置里选的语言无关，会导致「界面已切英文、插件页仍是中文」。
     */
    let localeService: any = null;

    const readLocale = (): string => {
      try {
        const active = localeService?.getLocale?.()?.active;
        if (typeof active === "string" && active) return active;
      } catch {
        /* 宿主没提供 locale 服务时退回浏览器语言 */
      }
      return typeof navigator !== "undefined" && navigator.language ? navigator.language : "zh";
    };

    /**
     * 翻译目标语言 = DSH 的界面语言。Host 只认 zh / en，这里先归一化再发出去；
     * 每次调用都现读，所以设置里切语言之后，下一次翻译请求就跟着变。
     */
    const currentLanguage = (): string => (String(readLocale() || "").toLowerCase().startsWith("zh") ? "zh" : "en");

    const tCache = new Map<string, Translate>();
    const tFor = (value: string): Translate => {
      const lang = String(value || "").toLowerCase().startsWith("zh") ? "zh" : "en";
      let fn = tCache.get(lang);
      if (!fn) {
        fn = pick(lang);
        tCache.set(lang, fn);
      }
      return fn;
    };

    /* 每次调用都按当前语言取，所以任何一次重渲染都会用上新语言 */
    const t: Translate = (key) => tFor(readLocale())(key);

    const subscribeLocale = (onChange: () => void) => {
      try {
        if (typeof localeService?.subscribe === "function") return localeService.subscribe(onChange);
      } catch {
        /* ignore */
      }
      return () => {};
    };

    /* 有 useSyncExternalStore 就订阅语言切换（切语言即时生效），否则退化为每次渲染读一次 */
    const useLocaleTick = () => {
      if (typeof React.useSyncExternalStore === "function") {
        React.useSyncExternalStore(subscribeLocale, readLocale);
      }
    };

    /* ---------------------------------------------------------------- 图标 */

    interface IconProps {
      size?: number;
      style?: CSSProperties;
    }

    const Icon = ({ size = 16, style, children }: IconProps & { children: ReactNode }) => (
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        fill="none"
        aria-hidden="true"
        style={{ flex: "0 0 auto", display: "block", ...(style ?? {}) }}
      >
        {children}
      </svg>
    );

    const IconBack = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M9.5 3.5 5 8l4.5 4.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </Icon>
    );

    const IconRefresh = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M13 8a5 5 0 1 1-1.6-3.7" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        <path d="M13 2.5V5h-2.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </Icon>
    );

    const IconPlus = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </Icon>
    );

    const IconSearch = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <circle cx={7} cy={7} r={4.2} stroke="currentColor" strokeWidth={1.5} />
        <path d="m10.2 10.2 2.6 2.6" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </Icon>
    );

    const IconServer = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <rect x={2.5} y={3} width={11} height={4} rx={1.4} stroke="currentColor" strokeWidth={1.4} />
        <rect x={2.5} y={9} width={11} height={4} rx={1.4} stroke="currentColor" strokeWidth={1.4} />
      </Icon>
    );

    const IconChevron = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </Icon>
    );

    const IconMore = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        {[0, 4, 8].map((dx, index) => (
          <circle key={index} cx={3 + dx} cy={8} r={1.15} fill="currentColor" />
        ))}
      </Icon>
    );

    const IconExternal = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M9 3.5h3.5V7" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.5 3.5 7.5 8.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        <path d="M11 10v2.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </Icon>
    );

    const IconTrash = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M3 4.5h10" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        <path d="M6.5 4.5V3.4a.9.9 0 0 1 .9-.9h1.2a.9.9 0 0 1 .9.9v1.1" stroke="currentColor" strokeWidth={1.4} />
        <path d="M4.5 4.5 5 12.2a1 1 0 0 0 1 .8h4a1 1 0 0 0 1-.8l.5-7.7" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
      </Icon>
    );

    const IconClose = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </Icon>
    );

    const IconFolder = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M2.5 4.6a1 1 0 0 1 1-1h2.6l1.2 1.4h4.2a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
      </Icon>
    );

    const IconEdit = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M10.4 2.9a1.4 1.4 0 0 1 2 2L6.2 11 3.5 12l1-2.7z" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
        <path d="M9.2 4.1 11.6 6.5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      </Icon>
    );

    const IconTool = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M9.6 2.6a3.2 3.2 0 0 0-3.9 4.2l-3 3a1.2 1.2 0 0 0 0 1.7l.9.9a1.2 1.2 0 0 0 1.7 0l3-3a3.2 3.2 0 0 0 4.2-3.9l-2 2-1.5-.5-.5-1.5z" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
      </Icon>
    );

    const IconContext = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M3.2 13.2V8.6M6.9 13.2V4.4M10.6 13.2v-3M14.3 13.2V6.2" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </Icon>
    );

    const IconAlert = (p: IconProps) => (
      <Icon size={p.size} style={p.style}>
        <path d="M8 3.2 14 13H2z" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
        <path d="M8 6.6v3.2" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        <circle cx={8} cy={11.4} r={0.75} fill="currentColor" />
      </Icon>
    );

    const SidebarGlyph = () => (
      <span className="smNavGlyph" aria-hidden="true">
        <IconServer size={18} />
      </span>
    );

    /* ----------------------------------------------------------------- CSS */

        const CSS = `
.smPage{box-sizing:border-box;height:100%;overflow:auto;color:var(--dsw-alias-label-primary);
  font-family:var(--dsw-font-family);-webkit-font-smoothing:antialiased}
.smInner{width:100%;max-width:1280px;margin:0 auto;padding:20px clamp(24px,4vw,56px) 64px;display:flex;flex-direction:column;gap:28px}
.smTopbar{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:28px}
.smBack{display:inline-flex;align-items:center;gap:6px;padding:4px 8px 4px 4px;margin-left:-4px;border:0;border-radius:var(--dsw-radius-sm,8px);
  background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:color .12s ease,background .12s ease}
.smBack:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.smTopRight{display:flex;align-items:center;gap:4px}
.smIconBtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid transparent;border-radius:var(--dsw-radius-sm,8px);
  background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:color .12s ease,background .12s ease,border-color .12s ease}
.smIconBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.smIconBtnDanger:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.smIconBtn[data-busy=true]{color:var(--dsw-alias-label-dimmed);cursor:default}
.smIconBtn[data-busy=true] svg{animation:smSpin .9s linear infinite}
@keyframes smSpin{to{transform:rotate(360deg)}}
.smHead{display:flex;flex-direction:column;gap:6px}
.smTitle{margin:0;font-size:20px;font-weight:500;line-height:28px;letter-spacing:-0.01em}
.smSub{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);max-width:64ch}
.smTabs{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-interactive-bg-hover);align-self:flex-start}
.smTab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:20px;
  padding:5px 12px;border-radius:calc(var(--dsw-radius-md,12px) - 3px);cursor:pointer;transition:color .12s ease,background .12s ease}
.smTab:hover{color:var(--dsw-alias-label-primary)}
.smTab[aria-selected=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px #0000001a}
.smToolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.smSearch{display:flex;align-items:center;gap:8px;flex:1 1 220px;min-width:180px;height:32px;padding:0 10px;
  border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-tertiary)}
.smSearch:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.smSearch input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.smSearch input::placeholder{color:var(--dsw-alias-label-caption)}
.smBtn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--dsw-radius-sm,8px);
  border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);
  font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease;white-space:nowrap}
.smBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.smBtnPrimary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.smBtnPrimary:hover{background:var(--dsw-alias-button-primary-hover)}
.smBtnDanger{color:var(--dsw-alias-state-error-primary)}
.smBtnGhost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-tertiary)}
.smBtnGhost:hover{color:var(--dsw-alias-label-primary)}
.smBtn:disabled{opacity:.5;cursor:default}
/* 键盘焦点统一一套：宿主 token 的 focus ring，偏移按控件体积取 1–2px */
.smBtn:focus-visible,.smBack:focus-visible,.smTab:focus-visible,.smSegBtn:focus-visible,.smIconBtn:focus-visible,
.smSwitch:focus-visible,.smLinkBtn:focus-visible,.smSelect:focus-visible,.smKVAdd:focus-visible,.smKVRemove:focus-visible,
.smBtnDangerSolid:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.smBtnDangerSolid{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:#fff}
.smBtnDangerSolid:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 86%, #000)}
.smTable{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2);container-type:inline-size;container-name:smtable}
.smTHead{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(180px,1.7fr) 100px 48px 112px;gap:16px;
  padding:8px 10px 8px 32px;font-size:11px;line-height:14px;letter-spacing:.02em;color:var(--dsw-alias-label-caption);box-sizing:border-box}
.smRowWrap{border-bottom:1px solid var(--dsw-alias-border-l2)}
.smRow{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(180px,1.7fr) 100px 48px 112px;gap:16px;align-items:center;
  width:100%;box-sizing:border-box;position:relative;padding:12px 10px 12px 32px;background:transparent;border:0;color:inherit;
  font:inherit;text-align:left;cursor:default;transition:background .12s ease}
.smRow[data-expandable=true]{cursor:pointer}
/* 有「每轮 tokens」列时多一格 92px；没有这一列时原样不动（未装 dsh-context 的默认形态） */
.smTable[data-cost=true] .smTHead,.smTable[data-cost=true] .smRow{
  grid-template-columns:minmax(150px,1.1fr) minmax(180px,1.7fr) 100px 48px 92px 112px}
.smRow:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.smRowChevron{position:absolute;left:9px;top:50%;margin-top:-6px;color:var(--dsw-alias-label-caption);
  pointer-events:none;transition:transform .16s cubic-bezier(.4,0,.2,1)}
.smRowChevron[data-open=true]{transform:rotate(90deg)}
.smRowWrap:hover>.smRow{background:var(--dsw-alias-interactive-bg-hover)}
.smName{display:flex;flex-direction:column;gap:2px;min-width:0}
.smNameMain{display:flex;align-items:center;gap:8px;min-width:0}
.smNameText{font-size:13px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smNameNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smMono{font-family:"SF Mono","JetBrains Mono",Consolas,monospace;font-size:12px}
.smEndpoint{display:flex;align-items:center;gap:8px;min-width:0}
.smTag{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;font-size:11px;line-height:14px;
  color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l3);flex:0 0 auto}
.smEndpointText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.smStatus{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.smDot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-caption)}
.smDot[data-tone=success]{background:var(--dsw-alias-state-success-primary)}
.smDot[data-tone=error]{background:var(--dsw-alias-state-error-primary)}
.smDot[data-tone=warn]{background:var(--dsw-alias-state-warn-primary)}
.smTools{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.smTools[data-empty=true]{color:var(--dsw-alias-label-dimmed)}
.smCost{font-size:13px;line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.smCost[data-empty=true]{color:var(--dsw-alias-label-dimmed)}
/* 网格项是外层这一格（Tip 会再套一层 span），窄容器里隐藏要连它一起 */
.smCostCell{display:block;min-width:0}
.smActions{display:flex;align-items:center;justify-content:flex-end;gap:1px;flex:0 0 auto}
/* 展开区用 grid-template-rows 0fr→1fr 过渡：内容高度不用测量，也不会出现 max-height 的抖动 */
.smDetail{display:grid;grid-template-rows:0fr;overflow:hidden;transition:grid-template-rows .26s cubic-bezier(.32,.72,0,1)}
.smRowWrap[data-open=true]>.smDetail{grid-template-rows:1fr}
.smDetailInner{min-height:0;overflow:hidden}
.smDetailBody{display:flex;flex-direction:column;gap:8px;padding:2px 10px 16px 24px}
.smToolbarDivider{width:1px;height:16px;background:var(--dsw-alias-border-l3);flex:0 0 auto;margin:0 2px}
.smDetailHead{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
.smToolList{display:flex;flex-wrap:wrap;gap:6px}
.smToolChip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:5px;background:transparent;
  border:1px solid var(--dsw-alias-border-l3);font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary)}
.smToolRows{display:flex;flex-direction:column;gap:1px;margin:2px 0 0}
.smToolRow{display:grid;grid-template-columns:minmax(110px,168px) minmax(0,1fr) auto;gap:14px;align-items:center;width:100%;
  padding:6px 8px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:inherit;font:inherit;
  text-align:left;cursor:pointer;transition:background .12s ease}
.smToolRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.smToolRow:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.smToolRowName{font-family:"SF Mono","JetBrains Mono",Consolas,monospace;font-size:12px;line-height:18px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.smToolRowDesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.smToolRowDesc[data-empty=true]{color:var(--dsw-alias-label-dimmed)}
.smParams{display:flex;flex-direction:column;gap:12px;margin:6px 0 0}
.smParam{display:flex;flex-direction:column;gap:3px}
.smParamHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.smParamName{font-family:"SF Mono","JetBrains Mono",Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.smParamType{font-size:11px;line-height:16px;padding:0 5px;border-radius:3px;color:var(--dsw-alias-label-caption);
  border:1px solid var(--dsw-alias-border-l3)}
.smParamReq{font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-label)}
.smParamDesc{margin:0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-tertiary);max-width:64ch}
.smSwitch{position:relative;width:36px;height:20px;border-radius:999px;border:0;padding:0;cursor:pointer;flex:0 0 auto;
  background:var(--dsw-alias-interactive-bg-active);transition:background .15s ease}
.smSwitch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}
.smSwitch span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb);
  transition:transform .15s cubic-bezier(.2,.8,.2,1)}
.smSwitch[aria-checked=true] span{transform:translateX(16px);background:#fff}
.smSwitch:disabled{opacity:.45;cursor:default}
.smHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
.smEmpty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:56px 24px;text-align:center;
  border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,16px);background:transparent}
.smEmptyIcon{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:var(--dsw-radius-md,12px);
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}
.smEmptyTitle{margin:4px 0 0;font-size:14px;font-weight:500;line-height:22px}
.smEmptyBody{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);max-width:44ch}
.smEmptyActions{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;justify-content:center}
.smBanner{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:var(--dsw-radius-sm,8px);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.smBannerText{display:flex;flex-direction:column;gap:2px;min-width:0}
.smBannerTitle{font-weight:500}
.smBannerBody{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;word-break:break-word}
.smBannerWarn{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)}
.smBannerMeta{display:flex;flex-wrap:wrap;gap:2px 12px;margin-top:2px;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.smBannerClose{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;
  border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;
  transition:background .12s ease,color .12s ease}
.smBannerClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.smBannerClose:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
/* 抽屉正文的加载占位（表格/卡片各有自己的骨架，见下） */
.smSkeleton{border-radius:var(--dsw-radius-sm,8px);
  background:linear-gradient(90deg,transparent,var(--dsw-alias-bg-skeleton),transparent);background-size:200% 100%;animation:smShimmer 1.4s ease-in-out infinite}
@keyframes smShimmer{0%{background-position:120% 0}100%{background-position:-20% 0}}
/* 骨架按真实布局画：表格用同样的五列，卡片用同样的内容块，加载完成时不会整块跳动 */
.smSkRow{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(180px,1.7fr) 100px 48px 112px;gap:16px;align-items:center;
  padding:16px 10px 16px 32px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.smSkBar{display:block;height:10px;border-radius:999px;background:var(--dsw-alias-bg-skeleton);opacity:.7}
.smSkBar[data-shimmer=true]{background:linear-gradient(90deg,transparent,var(--dsw-alias-bg-skeleton),transparent);
  background-size:200% 100%;animation:smShimmer 1.4s ease-in-out infinite;opacity:1}
.smSkCard{display:flex;flex-direction:column;gap:8px;padding:14px 14px 40px;border:1px solid var(--dsw-alias-border-l3);
  border-radius:var(--dsw-radius-md,12px)}
/* tooltip：portal 到 body，脱离 overflow 容器，长路径/长描述不会把行撑开 */
.smTip{display:contents}
.smTipBubble{position:fixed;z-index:90;max-width:320px;padding:6px 9px;border-radius:var(--dsw-radius-sm,8px);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l4);
  box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:17px;font-weight:400;text-align:left;
  white-space:normal;word-break:break-word;pointer-events:none;transform:translate(-50%,-100%);animation:smFade .1s ease}
.smTipBubble[data-above=false]{transform:translate(-50%,0)}
.smEmptyIconDanger{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);color:var(--dsw-alias-state-error-primary)}
.smCards{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:12px}
.smCard{position:relative;display:flex;flex-direction:column;gap:6px;padding:14px 14px 40px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,12px);
  background:transparent;text-align:left;color:inherit;font:inherit;cursor:pointer;transition:border-color .12s ease,background .12s ease}
.smCard:hover{border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}
.smCard:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.smCardFoot{position:absolute;right:10px;bottom:8px;display:flex;align-items:center;gap:6px}
/* 技能被用过几次：只在使用过 / 有记录时出现，没数据就整行不渲染 */
.smCardUsage{display:block;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);margin-top:2px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smCardDelete{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:var(--dsw-radius-sm,8px);
  background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer;opacity:0;transition:opacity .12s ease,color .12s ease,background .12s ease}
.smCard:hover .smCardDelete,.smCard:focus-within .smCardDelete{opacity:1}
.smCardDelete:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
@media (hover:none){.smCardDelete{opacity:1}}
.smTranslated{color:var(--dsw-alias-label-tertiary)}
.smTransMark{display:inline-flex;align-items:center;height:14px;padding:0 4px;margin-left:4px;border-radius:3px;font-size:10px;line-height:14px;
  color:var(--dsw-alias-label-caption);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);vertical-align:1px}
.smCardHead{display:flex;align-items:center;justify-content:space-between;gap:8px}
.smCardName{font-size:13px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smCardDesc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.smBadge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;font-size:11px;line-height:14px;flex:0 0 auto;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2)}
.smTransTag{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-caption);
  white-space:nowrap;flex:0 0 auto}
.smTransTag i{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-dimmed);flex:0 0 auto}
.smTransTag[data-engine=model] i{background:var(--dsw-alias-state-success-primary)}
.smTransTag[data-engine=machine]{color:var(--dsw-alias-label-tertiary)}
.smTransTag[data-engine=machine] i{background:var(--dsw-alias-state-warn-primary)}
.smTransTag[data-engine=none]{color:var(--dsw-alias-state-warn-label)}
.smTransTag[data-engine=none] i{background:var(--dsw-alias-state-warn-primary)}
.smTransTag[data-engine=pending] i{background:var(--dsw-alias-state-business-primary);animation:smPulse 1.2s ease-in-out infinite}
@keyframes smPulse{0%,100%{opacity:1}50%{opacity:.25}}
.smModelPick{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);white-space:nowrap}
.smSelect{height:32px;padding:0 28px 0 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,8px);
  background-color:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;outline:0;
  appearance:none;-webkit-appearance:none;-moz-appearance:none;max-width:min(320px,46vw);text-overflow:ellipsis;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 16px) calc(50% - 1px),calc(100% - 11px) calc(50% - 1px);
  background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.smSelect:hover{border-color:var(--dsw-alias-border-l4)}
.smSelect:focus{border-color:var(--dsw-alias-state-business-primary)}
.smSelect:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.smSelect option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.smCardBtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:var(--dsw-radius-sm,8px);
  background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer;opacity:0;
  transition:opacity .12s ease,color .12s ease,background .12s ease}
.smCard:hover .smCardBtn,.smCard:focus-within .smCardBtn{opacity:1}
.smCardBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.smCardBtn:disabled{cursor:default;color:var(--dsw-alias-label-dimmed);opacity:1}
.smCardBtn[data-busy=true] svg{animation:smSpin .9s linear infinite}
@media (hover:none){.smCardBtn{opacity:1}}
.smNotice{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 12px;border-radius:var(--dsw-radius-sm,8px);
  border:1px solid var(--dsw-alias-border-l3);background:transparent;
  color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.smNoticeDot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-warn-primary)}
.smNotice[data-tone=business] .smNoticeDot{background:var(--dsw-alias-state-business-primary);animation:smPulse 1.2s ease-in-out infinite}
.smNoticeText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smNoticeAction{margin-left:auto;flex:0 0 auto}
.smControls{display:flex;flex-direction:column;gap:10px}
.smSummaryMeta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;line-height:14px;color:var(--dsw-alias-label-caption)}
.smLinkBtn{appearance:none;border:0;padding:0;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:11px;
  line-height:14px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.smLinkBtn:hover{color:var(--dsw-alias-label-primary)}
.smLinkBtn:disabled{color:var(--dsw-alias-label-dimmed);cursor:default;text-decoration:none}
.smMenuWrap{position:relative}
.smMenu{position:absolute;top:calc(100% + 6px);right:0;min-width:196px;z-index:40;padding:4px;border-radius:var(--dsw-radius-md,12px);
  background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l4);box-shadow:var(--dsw-elevation-prominent);
  animation:smMenuIn .14s cubic-bezier(.2,.8,.2,1)}
@keyframes smMenuIn{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
.smMenuItem{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;
  color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.smMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.smMenuItem:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.smKV{display:flex;flex-direction:column;gap:6px}
.smKVRow{display:grid;grid-template-columns:minmax(84px,1fr) minmax(120px,1.7fr) 24px;gap:6px;align-items:center}
.smKVRow .smInput{height:30px;padding:4px 8px}
.smKVAdd{align-self:flex-start;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:1px dashed var(--dsw-alias-border-l4);
  border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.smKVAdd:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4)}
.smKVRemove{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:5px;background:transparent;
  color:var(--dsw-alias-label-caption);cursor:pointer}
.smKVRemove:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.smDrawerScrim{position:fixed;inset:0;z-index:55;background:var(--dsw-alias-bg-mask-1);opacity:0;pointer-events:none;
  transition:opacity .22s cubic-bezier(.4,0,.2,1)}
.smDrawerScrim[data-open=true]{opacity:1;pointer-events:auto}
.smDrawer{position:fixed;top:0;right:0;bottom:0;z-index:56;width:min(540px,calc(100% - 40px));display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l4);box-shadow:var(--dsw-elevation-prominent);
  transform:translateX(100%);opacity:.6;will-change:transform;
  transition:transform .34s cubic-bezier(.32,.72,0,1),opacity .26s cubic-bezier(.32,.72,0,1)}
.smDrawer[data-open=true]{transform:translateX(0);opacity:1}
.smDrawer[data-open=false]{transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .16s cubic-bezier(.4,0,.2,1)}
.smDrawerHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.smDrawerTitleWrap{display:flex;flex-direction:column;gap:3px;min-width:0}
.smDrawerTitle{margin:0;font-size:15px;font-weight:500;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smDrawerMeta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 标题下的第二行（技能使用频次）：可选，没数据时整行不存在 */
.smDrawerTitleNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default}
/* 路径后面挂一个「在文件管理器中显示」的小按钮：路径本身可能很长，按钮不能被挤走 */
.smDrawerMetaRow{display:flex;align-items:center;gap:6px;min-width:0}
.smDrawerMetaRow .smDrawerMeta{flex:1 1 auto;min-width:0}
.smIconBtnTiny{width:22px;height:22px;flex:none}
.smDrawerBody{flex:1;overflow:auto;padding:16px 20px 28px;overscroll-behavior:contain}
.smSummary{display:flex;flex-direction:column;gap:6px}
.smSummaryLabel{font-size:11px;line-height:14px;letter-spacing:.03em;color:var(--dsw-alias-label-caption)}
.smSummaryText{margin:0;font-size:13.5px;line-height:22px;color:var(--dsw-alias-label-primary);max-width:70ch}
.smSummaryDivider{height:1px;background:var(--dsw-alias-border-l2);margin:16px 0 18px}
.smDrawerBody::-webkit-scrollbar{width:8px}
.smMd{font-size:13px;line-height:21px;color:var(--dsw-alias-label-secondary);max-width:70ch}
.smMd>*:first-child{margin-top:0}
.smMd h1,.smMd h2,.smMd h3,.smMd h4{margin:22px 0 8px;color:var(--dsw-alias-label-primary);font-weight:500;line-height:1.35}
.smMd h1{font-size:17px}.smMd h2{font-size:15px}.smMd h3,.smMd h4{font-size:13.5px}
.smMd p{margin:0 0 10px}
.smMd ul,.smMd ol{margin:0 0 10px;padding-left:20px}
.smMd li{margin:3px 0}
.smMd code{font-family:"SF Mono","JetBrains Mono",Consolas,monospace;font-size:12px;padding:1px 4px;border-radius:4px;
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.smMd pre{margin:0 0 12px;padding:10px 12px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-interactive-bg-hover);
  border:1px solid var(--dsw-alias-border-l2);overflow:auto}
.smMd pre code{padding:0;background:none;font-size:11.5px;line-height:18px}
.smMd hr{margin:18px 0;border:0;border-top:1px solid var(--dsw-alias-border-l2)}
.smMd strong{color:var(--dsw-alias-label-primary);font-weight:500}
.smMd a{color:var(--dsw-alias-link);text-decoration:underline;text-underline-offset:2px}
.smMask{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;
  background:var(--dsw-alias-bg-mask-3);animation:smFade .12s ease}
@keyframes smFade{from{opacity:0}to{opacity:1}}
.smModal{width:min(560px,100%);max-height:86vh;overflow:auto;display:flex;flex-direction:column;
  border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l4);
  box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
.smModalHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px 8px}
.smModalTitle{margin:0;font-size:16px;font-weight:500;line-height:24px}
.smModalBody{display:flex;flex-direction:column;gap:14px;padding:8px 20px 4px}
.smModalFoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 20px 18px}
.smField{display:flex;flex-direction:column;gap:5px}
.smLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-weight:500}
.smInput,.smTextarea{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:var(--dsw-radius-sm,8px);
  border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;outline:0}
.smInput:focus,.smTextarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.smTextarea{min-height:64px;resize:vertical;font-family:"SF Mono","JetBrains Mono",Consolas,monospace;font-size:12px;line-height:18px}
.smSeg{display:inline-flex;gap:2px;padding:3px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-interactive-bg-hover);align-self:flex-start}
.smSegBtn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;
  padding:4px 12px;border-radius:5px;cursor:pointer}
.smSegBtn[aria-pressed=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px #0000001a}
.smWarning{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label)}
.smNavGlyph{display:inline-flex;align-items:center;justify-content:center}
/* 窄容器重排走容器查询：容器宽度 ≠ 窗口宽度，窗口够宽但左栏挤占时同样要生效 */
@container smtable (max-width:720px){
  .smTHead{display:none}
  .smRow{grid-template-columns:1fr auto;grid-template-areas:"name actions" "endpoint endpoint" "status tools";row-gap:8px;align-items:start}
  /* 窄容器里成本列无处安放：整格隐藏，信息仍可在洞察页看到 */
  .smTable[data-cost=true] .smCostCell{display:none}
  .smSkRow{grid-template-columns:1fr auto;align-items:start}
  .smRowChevron{top:14px;margin-top:0}
  .smName{grid-area:name}.smEndpoint{grid-area:endpoint}.smStatus{grid-area:status}.smTools{grid-area:tools;text-align:right}.smActions{grid-area:actions}
}
/* 动效统一退出策略：保留全部状态反馈，只去掉位移与脉冲 */
@media (prefers-reduced-motion:reduce){
  .smDrawer,.smDrawerScrim,.smMenu,.smMask,.smDetail,.smRowChevron,.smSwitch,.smSwitch span,
  .smCard,.smCardBtn,.smCardDelete,.smBtn,.smIconBtn,.smRow,.smTipBubble{transition:none;animation:none}
  .smSkeleton{animation:none;background:var(--dsw-alias-interactive-bg-hover)}
  .smSkBar[data-shimmer=true]{animation:none;background:var(--dsw-alias-interactive-bg-hover);opacity:1}
  .smIconBtn[data-busy=true] svg,.smCardBtn[data-busy=true] svg{animation:none}
  .smNotice[data-tone=business] .smNoticeDot,.smTransTag[data-engine=pending] i{animation:none}
}
`;

    const styleTag = (id: string, css: string) => <style data-smd={id} dangerouslySetInnerHTML={{ __html: css }} />;

    /* ------------------------------------------------------------------ 工具 */

    const request = async (url: string, init?: RequestInit): Promise<any> => {
      const response = await fetch(url, { credentials: "same-origin", ...init });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload && payload.ok === false) throw new Error(payload.error || "请求失败");
      return payload;
    };

    /* ------------------------------------------- 可选的 dsh-context 联动（宿主聚合，只读） */

    /**
     * 铁律：**失败即隐身**。
     *  - 读数：宿主说 `available:false` 就当作没有，不显示 0、不显示假数字；
     *  - 深链：面板没注册就不渲染入口。
     *
     * 页面**不打** dsh-context 的 HTTP 路由：它的 `/snapshot` 会为所有会话折叠时间线，
     * 本机 100+ 会话时又慢又重。成本与技能用量都由宿主从 DSH 投影里聚合好再给。
     */
    const CONTEXT_PANEL_ID = "dsh-context";

    /** 宿主侧聚合返回；宿主说 available:false 时返回 null（= 不渲染这一列）。 */
    const readContextCost = async (): Promise<ContextCost | null> => {
      try {
        const payload = await request("/api/service-manager/context-cost", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        return payload?.available === true ? (payload as ContextCost) : null;
      } catch {
        return null;
      }
    };

    /** 近 7 天每个技能被加载的次数与最近时间；只读聚合数字，不碰正文。 */
    const readContextUsage = async (): Promise<Record<string, SkillUsage> | null> => {
      try {
        const payload = await request("/api/service-manager/context-usage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (payload?.available !== true || !Array.isArray(payload.skills)) return null;
        const out: Record<string, SkillUsage> = {};
        for (const row of payload.skills) {
          const name = String(row?.name ?? "");
          if (!name) continue;
          out[name] = { n: Number(row.n) || 0, last: Number(row.last) || 0 };
        }
        return out;
      } catch {
        return null;
      }
    };

    /** 由 apply() 赋值：面板在不在、怎么跳过去。默认「不在」，缺 dsh-context 时按钮不出现。 */
    let contextPanelProbe: () => boolean = () => false;
    let openContextPanel: () => void = () => {};

    const formatTokens = (value: number): string =>
      Number.isFinite(value) ? String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—";

    /** 相对时间；`last` 可能是秒或毫秒，按量级判断一次。 */
    const relativeWhen = (t: Translate, ms: number): string => {
      const value = ms > 0 && ms < 1e11 ? ms * 1000 : ms;
      if (!Number.isFinite(value) || value <= 0) return "";
      const diff = Math.max(0, Date.now() - value);
      if (diff < 60_000) return t("whenJustNow");
      if (diff < 3_600_000) return t("whenMinutes").replace("{n}", String(Math.floor(diff / 60_000)));
      if (diff < 86_400_000) return t("whenHours").replace("{n}", String(Math.floor(diff / 3_600_000)));
      return t("whenDays").replace("{n}", String(Math.floor(diff / 86_400_000)));
    };

    /**
     * 技能使用频次文案；没有记录时返回空串（调用方据此整行不渲染）。
     * 卡片和抽屉用同一份，避免两处口径漂移。
     */
    const usageLabel = (t: Translate, usage?: SkillUsage): string => {
      if (!usage) return "";
      if (usage.n > 0) {
        return t("skillUsed7").replace("{n}", String(usage.n)).replace("{when}", relativeWhen(t, usage.last));
      }
      if (usage.last > 0) return t("skillIdle7").replace("{when}", relativeWhen(t, usage.last));
      return "";
    };

    /* 只显示时分：横幅里的"启动于"要的是"大概什么时候"，不是精确时刻 */
    const shortClock = (iso?: string | null): string => {
      const date = iso ? new Date(iso) : null;
      if (!date || Number.isNaN(date.getTime())) return "";
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const endpointOf = (server: ServerView): string => {
      if (!server.endpoint) return "—";
      if (server.transport === "stdio") {
        const short = server.endpoint.replace(/^.*[\\/]/, "");
        return short.length > 64 ? short.slice(0, 61) + "…" : short;
      }
      return server.endpoint;
    };

    const STATUS_TONE: Record<string, string> = {
      connected: "success",
      configured: "warn",
      idle: "warn",
      disabled: "",
      failed: "error",
    };

    /* --------------------------------------------------- 最小 Markdown 渲染 */

    const inline = (text: string, keyPrefix: string): ReactNode[] => {
      const nodes: ReactNode[] = [];
      const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
      let last = 0;
      let match: RegExpExecArray | null;
      let index = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const token = match[0];
        const key = `${keyPrefix}-i${index++}`;
        if (token.startsWith("`")) {
          nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
        } else if (token.startsWith("**")) {
          nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
        } else {
          const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) as RegExpExecArray;
          nodes.push(
            <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer noopener">
              {linkMatch[1]}
            </a>
          );
        }
        last = match.index + token.length;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes;
    };

    const renderMarkdown = (source: string): ReactNode[] => {
      const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
      const blocks: ReactNode[] = [];
      let paragraph: string[] = [];
      let list: { ordered: boolean; items: string[] } | null = null;
      let code: string[] | null = null;
      let key = 0;

      const flushParagraph = () => {
        if (!paragraph.length) return;
        const text = paragraph.join(" ").trim();
        if (text) blocks.push(<p key={`p${key++}`}>{inline(text, `p${key}`)}</p>);
        paragraph = [];
      };
      const flushList = () => {
        if (!list) return;
        const ordered = list.ordered;
        const items = list.items;
        const Tag = ordered ? "ol" : "ul";
        blocks.push(
          <Tag key={`l${key++}`}>
            {items.map((item, index) => (
              <li key={index}>{inline(item, `l${key}-${index}`)}</li>
            ))}
          </Tag>
        );
        list = null;
      };

      for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, "");
        const fence = /^```(\w*)\s*$/.exec(line);
        if (code !== null) {
          if (fence) {
            blocks.push(
              <pre key={`c${key++}`}>
                <code>{code.join("\n")}</code>
              </pre>
            );
            code = null;
          } else {
            code.push(rawLine);
          }
          continue;
        }
        if (fence) {
          flushParagraph();
          flushList();
          code = [];
          continue;
        }
        if (line.trim() === "") {
          flushParagraph();
          flushList();
          continue;
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
          flushParagraph();
          flushList();
          blocks.push(<hr key={`h${key++}`} />);
          continue;
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
          flushParagraph();
          flushList();
          const Tag = `h${heading[1].length}` as any;
          blocks.push(<Tag key={`h${key++}`}>{inline(heading[2], `h${key}`)}</Tag>);
          continue;
        }
        const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
        if (ordered || bullet) {
          flushParagraph();
          const isOrdered = Boolean(ordered);
          if (!list || list.ordered !== isOrdered) {
            flushList();
            list = { ordered: isOrdered, items: [] };
          }
          list.items.push((ordered ?? bullet)[1]);
          continue;
        }
        paragraph.push(line.trim());
      }
      if (code !== null)
        blocks.push(
          <pre key={`c${key++}`}>
            <code>{code.join("\n")}</code>
          </pre>
        );
      flushParagraph();
      flushList();
      return blocks;
    };

    /* ---------------------------------------------------------------- 抽屉 */

    /** 译文来源：绿点=模型、琥珀点=机翻或失败、蓝点脉冲=翻译中。 */
    function TransTag({ t, entry, busy }: { t: Translate; entry?: TranslationEntry; busy?: boolean }) {
      if (busy) {
        return (
          <span className="smTransTag" data-engine="pending">
            <i />
            {t("transBusy")}
          </span>
        );
      }
      if (!entry) return null;
      if (entry.engine === "model") {
        return (
          <Tip label={entry.model ?? ""}>
            <span className="smTransTag" data-engine="model">
              <i />
              {t("transModel")}
            </span>
          </Tip>
        );
      }
      if (entry.engine === "machine") {
        return (
          <span className="smTransTag" data-engine="machine">
            <i />
            {t("transMachine")}
          </span>
        );
      }
      if (entry.engine === "none") {
        return (
          <span className="smTransTag" data-engine="none">
            <i />
            {t("transNone")}
          </span>
        );
      }
      return null;
    }

    /** 工具摘要与参数说明的翻译键，技能/工具共用同一份磁盘缓存。 */
    const toolKeyOf = (server: ServerView, tool: ToolInfo) => `${server.id}:${tool.name}`;
    const paramKeyOf = (server: ServerView, tool: ToolInfo, param: ToolParam) => `${server.id}:${tool.name}#${param.name}`;

    /** 抽屉外壳：遮罩 + 右侧滑入 + Esc 关闭，技能和工具共用。 */
    function DrawerShell({
      t,
      title,
      subtitle,
      note,
      onClose,
      onLocate,
      children,
    }: {
      t: Translate;
      title: string;
      subtitle?: string;
      /** 标题下的第二行说明（技能用它放使用频次），没有就整行不渲染 */
      note?: ReactNode;
      onClose: () => void;
      onLocate?: () => void;
      children: ReactNode;
    }) {
      const [open, setOpen] = useState<boolean>(false);
      /* 用 ref 存回调：父组件重渲染会换掉 onClose 的函数身份，
         如果把它放进依赖里，effect 每次都被取消，进场动画就永远播不出来。 */
      const onCloseRef = useRef(onClose);
      onCloseRef.current = onClose;
      useEffect(() => {
        const frame = requestAnimationFrame(() => setOpen(true));
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "Escape") onCloseRef.current();
        };
        window.addEventListener("keydown", onKey);
        return () => {
          cancelAnimationFrame(frame);
          window.removeEventListener("keydown", onKey);
        };
      }, []);
      const close = () => {
        setOpen(false);
        setTimeout(() => onCloseRef.current(), 200);
      };
      return (
        <>
          <div className="smDrawerScrim" data-open={open} onClick={close} />
          <aside className="smDrawer" data-open={open} role="dialog" aria-modal="true" aria-label={title}>
            <div className="smDrawerHead">
              <div className="smDrawerTitleWrap">
                <h2 className="smDrawerTitle">{title}</h2>
                {subtitle ? (
                  <div className="smDrawerMetaRow">
                    <Tip label={subtitle}>
                      <div className="smDrawerMeta smMono">{subtitle}</div>
                    </Tip>
                    {onLocate ? (
                      <Tip label={t("showInFiles")}>
                        <button type="button" className="smIconBtn smIconBtnTiny" aria-label={t("showInFiles")} onClick={onLocate}>
                          <IconFolder size={13} />
                        </button>
                      </Tip>
                    ) : null}
                  </div>
                ) : null}
                {note ? <div className="smDrawerTitleNote">{note}</div> : null}
              </div>
              <button type="button" className="smIconBtn" onClick={close} aria-label={t("close")}>
                <IconClose size={15} />
              </button>
            </div>
            <div className="smDrawerBody">{children}</div>
          </aside>
        </>
      );
    }

    /** 抽屉里的摘要层：译文 + 来源 + 重翻，技能和工具共用。 */
    function SummarySection({
      t,
      entry,
      busy,
      target,
      onRetranslate,
      children,
    }: {
      t: Translate;
      entry?: TranslationEntry;
      busy?: boolean;
      target?: ModelRef | null;
      onRetranslate: () => void;
      children: ReactNode;
    }) {
      const modelLabel = entry?.model || (target ? `${target.provider}/${target.model}` : "");
      return (
        <section className="smSummary">
          <div className="smSummaryLabel">{t("summaryLabel")}</div>
          <p className="smSummaryText">{children}</p>
          <div className="smSummaryMeta">
            <TransTag t={t} entry={entry} busy={busy} />
            {modelLabel && !busy ? <span className="smMono" style={{ fontSize: 11 }}>{modelLabel}</span> : null}
            <button type="button" className="smLinkBtn" disabled={busy} onClick={onRetranslate}>
              {busy ? `${t("transBusy")}…` : t("retranslate")}
            </button>
          </div>
        </section>
      );
    }

    function SourceDivider({ label }: { label: string }) {
      return (
        <>
          <div className="smSummaryDivider" />
          <div className="smSummaryLabel" style={{ marginBottom: 10 }}>
            {label}
          </div>
        </>
      );
    }

    function SkillDrawer({
      skill,
      t,
      entry,
      busy,
      target,
      usage,
      onRetranslate,
      onClose,
      onLocate,
    }: {
      skill: SkillInfo;
      t: Translate;
      entry?: TranslationEntry;
      busy?: boolean;
      target?: ModelRef | null;
      usage?: SkillUsage;
      onRetranslate: () => void;
      onClose: () => void;
      onLocate: () => void;
    }) {
      const [body, setBody] = useState<string | null>(null);
      const [error, setError] = useState<string>("");
      const [loading, setLoading] = useState<boolean>(true);
      /* 卡片上那行只有 11px、窄列时会被省略号吃掉，所以抽屉里再给一次 */
      const usageText = usageLabel(t, usage);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const url = `/api/service-manager/skills/content?path=${encodeURIComponent(skill.path)}`;
            const response = await fetch(url, { credentials: "same-origin" });
            const payload = await response.json();
            if (!alive) return;
            if (payload.ok === false) throw new Error(payload.error || "读取失败");
            setBody(payload.body ?? "");
          } catch (err: any) {
            if (alive) setError(err.message);
          } finally {
            if (alive) setLoading(false);
          }
        })();
        return () => {
          alive = false;
        };
      }, [skill.path]);

      return (
        <DrawerShell
          t={t}
          title={skill.name}
          subtitle={skill.path}
          note={
            usageText ? (
              <Tip label={t("skillUsageHint")}>
                <span>{usageText}</span>
              </Tip>
            ) : undefined
          }
          onClose={onClose}
          onLocate={onLocate}
        >
          <SummarySection t={t} entry={entry} busy={busy} target={target} onRetranslate={onRetranslate}>
            {entry?.text || skill.description || "—"}
          </SummarySection>
          <SourceDivider label={t("sourceLabel")} />
          {loading ? (
            <div className="smSkeleton" style={{ height: 120, borderRadius: 8 }} />
          ) : error ? (
            <div className="smBanner">
              <div className="smBannerText">
                <span className="smBannerBody">{error}</span>
              </div>
            </div>
          ) : (
            <div className="smMd">{renderMarkdown(body ?? "")}</div>
          )}
        </DrawerShell>
      );
    }

    function ToolDrawer({
      tool,
      server,
      t,
      entry,
      busy,
      target,
      entries,
      onRetranslate,
      onClose,
    }: {
      tool: ToolInfo;
      server: ServerView;
      t: Translate;
      entry?: TranslationEntry;
      busy?: boolean;
      target?: ModelRef | null;
      entries: Record<string, TranslationEntry>;
      onRetranslate: () => void;
      onClose: () => void;
    }) {
      const params = tool.params ?? [];
      return (
        <DrawerShell t={t} title={tool.name} subtitle={`${server.serverName} · ${server.endpoint}`} onClose={onClose}>
          <SummarySection t={t} entry={entry} busy={busy} target={target} onRetranslate={onRetranslate}>
            {entry?.text || tool.description || "—"}
          </SummarySection>
          {params.length ? (
            <>
              <SourceDivider label={t("paramsLabel")} />
              <div className="smParams">
                {params.map((param) => {
                  const text = entries?.[paramKeyOf(server, tool, param)]?.text || param.description || "";
                  return (
                    <div key={param.name} className="smParam">
                      <div className="smParamHead">
                        <span className="smParamName">{param.name}</span>
                        <span className="smParamType">{param.type}</span>
                        {param.required ? <span className="smParamReq">{t("required")}</span> : null}
                      </div>
                      {text ? <p className="smParamDesc">{text}</p> : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </DrawerShell>
      );
    }

    /* ------------------------------------------------------------------ 组件 */

    function StatusBadge({ server, t }: { server: ServerView; t: Translate }) {
      const tone = STATUS_TONE[server.status] ?? "";
      const label =
        ({
          connected: t("statusConnected"),
          configured: t("statusConfigured"),
          idle: t("statusConfigured"),
          disabled: t("statusDisabled"),
          failed: t("statusFailed"),
        } as Record<string, string>)[server.status] ?? t("statusConfigured");
      return (
        <span className="smStatus">
          <i className="smDot" data-tone={tone} />
          {label}
        </span>
      );
    }

    function ToolRow({
      tool,
      t,
      entry,
      busy,
      onOpen,
    }: {
      tool: ToolInfo;
      t: Translate;
      entry?: TranslationEntry;
      busy?: boolean;
      onOpen: (tool: ToolInfo) => void;
    }) {
      const text = entry?.text || tool.description || "";
      return (
        <button type="button" className="smToolRow" onClick={() => onOpen(tool)} aria-label={`${tool.name} ${t("summaryLabel")}`}>
          <span className="smToolRowName">{tool.name}</span>
          {/* 悬停看英文原文：译文在行上，原文在气泡里 —— 不再靠原生 title 的延迟与样式 */}
          <Tip label={tool.description || ""}>
            <span className="smToolRowDesc" data-empty={!text}>
              {text || t("toolNoDesc")}
            </span>
          </Tip>
          <TransTag t={t} entry={entry} busy={busy} />
        </button>
      );
    }

    function ServerRow({
      server,
      t,
      onToggle,
      onRemove,
      onEdit,
      onOpen,
      busy,
      open,
      entries,
      pending,
      showCost,
      cost,
      onOpenTool,
    }: {
      server: ServerView;
      t: Translate;
      onToggle: (server: ServerView) => void;
      onRemove: (server: ServerView) => void;
      onEdit: (server: ServerView) => void;
      onOpen: (id: string) => void;
      busy?: boolean;
      open?: boolean;
      entries?: Record<string, TranslationEntry>;
      pending?: Record<string, boolean>;
      showCost?: boolean;
      cost?: ContextCostServer | null;
      onOpenTool: (server: ServerView, tool: ToolInfo) => void;
    }) {
      const tools = server.tools ?? [];
      const count = server.toolCount;
      /* 详情区一旦展开过就留在树上：收起时高度归零并 inert。
         这样退场有内容可收，再展开也不用重建整份工具行。 */
      const [hasOpened, setHasOpened] = useState<boolean>(open === true);
      if (open && !hasOpened) setHasOpened(true);

      return (
        <div className="smRowWrap" data-open={open}>
          <div
            className="smRow"
            data-expandable="true"
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => onOpen(server.id)}
            onKeyDown={(event: KeyboardEventOf<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(server.id);
              }
            }}
          >
            <span className="smRowChevron" data-open={open} aria-hidden="true">
              <IconChevron size={12} />
            </span>
            <div className="smName">
              <div className="smNameMain">
                <span className="smNameText">{server.serverName}</span>
                {server.managed ? null : <span className="smTag">{t("externalNote")}</span>}
              </div>
              {server.note ? <div className="smNameNote">{server.note}</div> : null}
            </div>
            <div className="smEndpoint">
              <span className="smTag">{server.transport === "stdio" ? "stdio" : "http"}</span>
              <Tip label={server.endpoint}>
                <span className="smEndpointText smMono">{endpointOf(server)}</span>
              </Tip>
            </div>
            <StatusBadge server={server} t={t} />
            <div className="smTools" data-empty={count == null}>
              {count == null ? "–" : String(count)}
            </div>
            {showCost ? (
              <span className="smCostCell">
                <Tip label={cost ? t("costHint") : t("costMissing")}>
                  <span className="smCost" data-empty={!cost}>
                    {cost ? formatTokens(cost.tokens) : "—"}
                  </span>
                </Tip>
              </span>
            ) : null}
            <div className="smActions" onClick={(event: MouseEventOf<HTMLDivElement>) => event.stopPropagation()}>
              <Tip label={`${t("edit")} ${server.serverName}`}>
                <button type="button" className="smIconBtn" aria-label={`${t("edit")} ${server.serverName}`} onClick={() => onEdit(server)}>
                  <IconEdit size={14} />
                </button>
              </Tip>
              <Tip label={`${t("remove")} ${server.serverName}`}>
                <button
                  type="button"
                  className="smIconBtn smIconBtnDanger"
                  aria-label={`${t("remove")} ${server.serverName}`}
                  onClick={() => onRemove(server)}
                >
                  <IconTrash size={14} />
                </button>
              </Tip>
              <Tip label={`${server.enabled ? t("disable") : t("enable")} ${server.serverName}`}>
                <button
                  type="button"
                  className="smSwitch"
                  role="switch"
                  aria-checked={server.enabled}
                  aria-label={`${server.enabled ? t("disable") : t("enable")} ${server.serverName}`}
                  disabled={busy}
                  onClick={() => onToggle(server)}
                >
                  <span />
                </button>
              </Tip>
            </div>
          </div>
          {hasOpened ? (
            <div className="smDetail" data-open={open} {...(open ? {} : ({ inert: "", "aria-hidden": "true" } as any))}>
              <div className="smDetailInner">
                <div className="smDetailBody">
                  {server.transport === "stdio" && server.cwd ? (
                    <div className="smDetailHead">
                      <span>{t("fieldCwd")}</span>
                      <span className="smMono">{server.cwd}</span>
                    </div>
                  ) : null}
                  {tools.length ? (
                    <div className="smToolRows">
                      {tools.map((tool) => (
                        <ToolRow
                          key={tool.name}
                          tool={tool}
                          t={t}
                          entry={entries?.[toolKeyOf(server, tool)]}
                          busy={Boolean(pending?.[toolKeyOf(server, tool)])}
                          onOpen={(target) => onOpenTool(server, target)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="smHint">{server.enabled ? t("toolPending") : t("toolDisabled")}</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    function EmptyState({ t, onAdd, onOpen }: { t: Translate; onAdd: () => void; onOpen: () => void }) {
      return (
        <div className="smEmpty">
          <div className="smEmptyIcon">
            <IconServer size={22} />
          </div>
          <h3 className="smEmptyTitle">{t("emptyTitle")}</h3>
          <p className="smEmptyBody">{t("emptyBody")}</p>
          <div className="smEmptyActions">
            <button type="button" className="smBtn smBtnPrimary" onClick={onAdd}>
              <IconPlus size={14} />
              {t("emptyAdd")}
            </button>
            <button type="button" className="smBtn" onClick={onOpen}>
              <IconExternal size={14} />
              {t("emptyOpen")}
            </button>
          </div>
        </div>
      );
    }

    function ErrorState({ t, message, onRetry }: { t: Translate; message: string; onRetry: () => void }) {
      return (
        <div className="smEmpty">
          <div className="smEmptyIcon smEmptyIconDanger">
            <IconAlert size={22} />
          </div>
          <h3 className="smEmptyTitle">{t("errorTitle")}</h3>
          <p className="smEmptyBody">{message || t("errorTitle")}</p>
          <div className="smEmptyActions">
            <button type="button" className="smBtn" onClick={onRetry}>
              <IconRefresh size={14} />
              {t("retry")}
            </button>
          </div>
        </div>
      );
    }

    /**
     * 轻量 tooltip：外层是 display:contents 的壳，不参与任何布局；
     * 气泡 portal 到 body，所以不会被行里的 overflow:hidden 裁掉。
     * 定位取第一个子元素的盒子——display:contents 的壳自己没有盒子。
     */
    function Tip({ label, children }: { label?: string | null; children: ReactNode }) {
      const [open, setOpen] = useState<boolean>(false);
      const [box, setBox] = useState<{ left: number; top: number; above: boolean }>({ left: 0, top: 0, above: true });
      const text = typeof label === "string" ? label.trim() : "";

      const show = (node: HTMLElement | null) => {
        if (!text || typeof window === "undefined") return;
        const target = (node?.firstElementChild as HTMLElement | null) ?? node;
        if (!target || typeof target.getBoundingClientRect !== "function") return;
        const rect = target.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        const half = Math.min(160, Math.max(0, window.innerWidth / 2 - 12));
        const left = Math.min(Math.max(rect.left + rect.width / 2, 12 + half), window.innerWidth - 12 - half);
        const above = rect.top > 64;
        setBox({ left: Math.round(left), top: Math.round(above ? rect.top - 8 : rect.bottom + 8), above });
        setOpen(true);
      };
      const hide = () => setOpen(false);

      /* 滚动或改窗口大小就收起来：气泡是 fixed 定位，跟着内容跑反而错位 */
      useEffect(() => {
        if (!open || typeof window === "undefined") return;
        const onMove = () => setOpen(false);
        window.addEventListener("scroll", onMove, true);
        window.addEventListener("resize", onMove);
        return () => {
          window.removeEventListener("scroll", onMove, true);
          window.removeEventListener("resize", onMove);
        };
      }, [open]);

      return (
        <>
          <span
            className="smTip"
            onMouseEnter={(event) => show(event.currentTarget)}
            onMouseLeave={hide}
            onFocus={(event) => show(event.currentTarget)}
            onBlur={hide}
          >
            {children}
          </span>
          {open && text && createPortal
            ? createPortal(
                <div className="smTipBubble" role="tooltip" data-above={box.above} style={{ left: box.left, top: box.top }}>
                  {text}
                </div>,
                document.body
              )
            : null}
        </>
      );
    }

    const Bar = ({ w, h: height }: { w?: string; h?: number }) => (
      <span className="smSkBar" data-shimmer="true" style={{ width: w ?? "100%", height: height ?? 10 }} />
    );

    /** 表格骨架：与真实行同一套五列，加载完成时不会整块跳一下。 */
    function TableSkeleton({ t }: { t: Translate }) {
      return (
        <div className="smTable" role="status" aria-label={t("loading")}>
          <div className="smTHead">
            <span>{t("colName")}</span>
            <span>{t("colEndpoint")}</span>
            <span>{t("colStatus")}</span>
            <span>{t("colTools")}</span>
            <span />
          </div>
          {[0, 1, 2].map((row) => (
            <div key={row} className="smSkRow">
              <div className="smName">
                <Bar w={row === 1 ? "54%" : "70%"} />
                <Bar w="38%" h={8} />
              </div>
              <div className="smEndpoint">
                <Bar w="26%" h={14} />
                <Bar w={row === 2 ? "42%" : "62%"} />
              </div>
              <Bar w="64%" />
              <Bar w="18px" />
              <div className="smActions">
                <Bar w="58px" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    /** 卡片骨架：名称一行 + 摘要三行，与真实卡片同高。 */
    function CardSkeleton({ t }: { t: Translate }) {
      return (
        <div className="smCards" role="status" aria-label={t("loading")}>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="smSkCard">
              <div className="smCardHead">
                <Bar w="46%" />
                <Bar w="34px" h={14} />
              </div>
              <Bar w="100%" h={9} />
              <Bar w="92%" h={9} />
              <Bar w={index % 2 ? "58%" : "76%"} h={9} />
            </div>
          ))}
        </div>
      );
    }

    /** 破坏性操作的确认框：删服务器、删技能共用一份，避免两处各写一遍走样。 */
    function ConfirmDialog({
      t,
      title,
      body,
      busy,
      width,
      onCancel,
      onConfirm,
    }: {
      t: Translate;
      title: string;
      body: string;
      busy?: boolean;
      width?: number;
      onCancel: () => void;
      onConfirm: () => void;
    }) {
      return (
        <div className="smMask" onMouseDown={(event: MouseEventOf<HTMLDivElement>) => event.target === event.currentTarget && onCancel()}>
          <div className="smModal" role="dialog" aria-modal="true" style={{ maxWidth: width ?? 440 }}>
            <div className="smModalHead">
              <h2 className="smModalTitle">{title}</h2>
            </div>
            <div className="smModalBody">
              <p className="smHint">{body}</p>
            </div>
            <div className="smModalFoot">
              <button type="button" className="smBtn smBtnGhost" onClick={onCancel}>
                {t("cancel")}
              </button>
              <button type="button" className="smBtn smBtnDangerSolid" disabled={busy} onClick={onConfirm}>
                {t("confirmRemove")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    function ServerForm({
      t,
      initial,
      onClose,
      onSaved,
    }: {
      t: Translate;
      initial?: ServerView | null;
      onClose: () => void;
      onSaved: (payload: any) => void;
    }) {
      const [transport, setTransport] = useState<string>(initial?.transport ?? "stdio");
      const [serverName, setServerName] = useState<string>(initial?.serverName ?? "");
      const [command, setCommand] = useState<string>(initial?.endpoint?.split(" ")[0] ?? "");
      const [args, setArgs] = useState<string>("");
      const [cwd, setCwd] = useState<string>(initial?.cwd ?? "");
      const [url, setUrl] = useState<string>(initial?.transport === "streamable-http" ? initial.endpoint : "");
      const [pairs, setPairs] = useState<{ k: string; v: string }[]>(() =>
        Object.entries((initial?.transport === "streamable-http" ? initial?.headers : initial?.env) ?? {}).map(([k, v]) => ({
          k,
          v: String(v),
        }))
      );
      const [note, setNote] = useState<string>(initial?.note ?? "");
      const [presetId, setPresetId] = useState<string>("");
      const [saving, setSaving] = useState<boolean>(false);
      const [error, setError] = useState<string>("");

      const applyPreset = (id: string) => {
        setPresetId(id);
        const preset = PRESETS.find((item: any) => item.id === id);
        if (!preset) return;
        const values = preset.values;
        setServerName(values.serverName ?? "");
        setTransport(values.transport ?? "stdio");
        setCommand(values.command ?? "");
        setArgs(values.args ?? "");
        setCwd(values.cwd ?? "");
        setUrl(values.url ?? "");
        setNote(values.note ?? "");
        setPairs((values.env ?? values.headers ?? []).map((item: any) => ({ ...item })));
      };

      const submit = async () => {
        setSaving(true);
        setError("");
        try {
          const kv: Record<string, string> = {};
          for (const pair of pairs) {
            const key = pair.k.trim();
            if (!key) continue;
            kv[key] = pair.v;
          }
          const body = {
            serverName,
            transport,
            note,
            ...(transport === "stdio"
              ? { command, args: args.split("\n").map((s) => s.trim()).filter(Boolean), cwd, env: kv }
              : { url, headers: kv }),
          };
          const payload = await request("/api/service-manager/mcp/save", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          onSaved(payload);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setSaving(false);
        }
      };

      return (
        <div className="smMask" onMouseDown={(event: MouseEventOf<HTMLDivElement>) => event.target === event.currentTarget && onClose()}>
          <div className="smModal" role="dialog" aria-modal="true">
            <div className="smModalHead">
              <h2 className="smModalTitle">{initial ? t("formTitleEdit") : t("formTitleNew")}</h2>
              <button type="button" className="smIconBtn" onClick={onClose} aria-label={t("cancel")}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>×</span>
              </button>
            </div>
            <div className="smModalBody">
              {initial ? null : (
                <div className="smField">
                  <label className="smLabel">{t("presetLabel")}</label>
                  <select className="smInput" value={presetId} onChange={(event) => applyPreset(event.target.value)}>
                    <option value="">{t("presetNone")}</option>
                    {PRESETS.map((preset: any) => (
                      <option key={preset.id} value={preset.id}>
                        {t(preset.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="smField">
                <label className="smLabel">{t("fieldName")}</label>
                <input
                  className="smInput"
                  value={serverName}
                  onChange={(event) => setServerName(event.target.value)}
                  placeholder="github"
                  disabled={Boolean(initial)}
                />
                <div className="smHint">{t("fieldNameHint")}</div>
              </div>
              <div className="smField">
                <label className="smLabel">{t("fieldTransport")}</label>
                <div className="smSeg">
                  {["stdio", "streamable-http"].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="smSegBtn"
                      aria-pressed={transport === value}
                      onClick={() => setTransport(value)}
                    >
                      {value === "stdio" ? "stdio" : "HTTP"}
                    </button>
                  ))}
                </div>
              </div>
              {transport === "stdio" ? (
                <>
                  <div className="smField">
                    <label className="smLabel">{t("fieldCommand")}</label>
                    <input className="smInput smMono" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" />
                  </div>
                  <div className="smField">
                    <label className="smLabel">{t("fieldArgs")}</label>
                    <textarea
                      className="smTextarea"
                      value={args}
                      onChange={(event) => setArgs(event.target.value)}
                      placeholder={"-y\n@modelcontextprotocol/server-github"}
                    />
                    <div className="smHint">{t("fieldArgsHint")}</div>
                  </div>
                  <div className="smField">
                    <label className="smLabel">{t("fieldCwd")}</label>
                    <input className="smInput smMono" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="D:\\work" />
                    <div className="smWarning">{t("fieldCwdHint")}</div>
                  </div>
                </>
              ) : (
                <div className="smField">
                  <label className="smLabel">{t("fieldUrl")}</label>
                  <input
                    className="smInput smMono"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/mcp"
                  />
                </div>
              )}
              <div className="smField">
                <label className="smLabel">{transport === "stdio" ? t("fieldEnv") : t("fieldHeaders")}</label>
                <div className="smKV">
                  {pairs.map((pair, index) => (
                    <div key={index} className="smKVRow">
                      <input
                        className="smInput smMono"
                        value={pair.k}
                        placeholder={transport === "stdio" ? "GITHUB_TOKEN" : "Authorization"}
                        aria-label={t("keyLabel")}
                        onChange={(event) =>
                          setPairs((prev) => prev.map((item, i) => (i === index ? { ...item, k: event.target.value } : item)))
                        }
                      />
                      <input
                        className="smInput smMono"
                        value={pair.v}
                        placeholder={transport === "stdio" ? "ghp_…" : "Bearer …"}
                        aria-label={t("valueLabel")}
                        onChange={(event) =>
                          setPairs((prev) => prev.map((item, i) => (i === index ? { ...item, v: event.target.value } : item)))
                        }
                      />
                      <button
                        type="button"
                        className="smKVRemove"
                        aria-label={t("removePair")}
                        onClick={() => setPairs((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <IconClose size={12} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="smKVAdd" onClick={() => setPairs((prev) => [...prev, { k: "", v: "" }])}>
                    <IconPlus size={12} />
                    {t("addPair")}
                  </button>
                </div>
                <div className="smHint">{transport === "stdio" ? t("fieldEnvHint") : t("fieldHeadersHint")}</div>
              </div>
              <div className="smField">
                <label className="smLabel">{t("fieldNote")}</label>
                <input className="smInput" value={note} onChange={(event) => setNote(event.target.value)} />
                <div className="smHint">{t("fieldNoteHint")}</div>
              </div>
              <div className="smHint" style={{ marginTop: -2 }}>
                {t("envRefHint")}
              </div>
              {error ? (
                <div className="smBanner">
                  <div className="smBannerText">
                    <span className="smBannerBody">{error}</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="smModalFoot">
              <button type="button" className="smBtn smBtnGhost" onClick={onClose}>
                {t("cancel")}
              </button>
              <button type="button" className="smBtn smBtnPrimary" onClick={submit} disabled={saving}>
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    function McpView({
      t,
      state,
      reload,
      notify,
    }: {
      t: Translate;
      state: AppState;
      reload: () => void;
      notify: (message: string) => void;
    }) {
      const [query, setQuery] = useState<string>("");
      const [editing, setEditing] = useState<{ mode: string; server?: ServerView | null } | null>(null);
      const [busyId, setBusyId] = useState<string | null>(null);
      const [pendingRemove, setPendingRemove] = useState<ServerView | null>(null);
      const [openId, setOpenId] = useState<string | null>(null);
      const [activeTool, setActiveTool] = useState<{ server: ServerView; tool: ToolInfo } | null>(null);

      const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
      const [target, setTarget] = useState<ModelRef | null>(null);
      const [entries, setEntries] = useState<Record<string, TranslationEntry>>({});
      const [pending, setPending] = useState<Record<string, boolean>>({});
      const [notice, setNotice] = useState<string>("");
      const [refreshing, setRefreshing] = useState<boolean>(false);

      const servers = state.servers ?? [];
      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return servers;
        return servers.filter((s) => s.serverName.toLowerCase().includes(q) || (s.endpoint ?? "").toLowerCase().includes(q));
      }, [servers, query]);

      /* 每轮成本：宿主聚合好的读数；没有 dsh-context 时是 null，表格就不长这一列 */
      const cost = state.context?.cost ?? null;
      const costByServer = useMemo(() => {
        const map: Record<string, ContextCostServer> = {};
        for (const row of cost?.servers ?? []) map[row.serverName] = row;
        return map;
      }, [cost]);

      const targetRef = useRef<ModelRef | null>(null);
      useEffect(() => {
        targetRef.current = target;
      }, [target]);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const payload = await request("/api/service-manager/models");
            if (!alive) return;
            setCatalog(payload);
            if (payload.selected) setTarget(payload.selected);
          } catch {
            if (alive) setCatalog({ providers: [], failures: [] });
          }
        })();
        return () => {
          alive = false;
        };
      }, []);

      const modelOptions = useMemo(() => {
        const out: { key: string; label: string }[] = [];
        for (const provider of catalog?.providers ?? []) {
          for (const model of provider.models ?? []) {
            out.push({ key: `${provider.id}::${model.id}`, label: `${model.name} · ${provider.name}` });
          }
        }
        return out;
      }, [catalog]);

      const selectedKey = target ? `${target.provider}::${target.model}` : "";
      const selectedMissing = Boolean(selectedKey) && !modelOptions.some((option) => option.key === selectedKey);

      const markPending = (ids: string[], value: boolean) =>
        setPending((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            if (value) next[id] = true;
            else delete next[id];
          }
          return next;
        });

      /* 工具摘要翻译：和技能共用同一套磁盘缓存与模型选择；分批回来分批渲染 */
      const translate = async (items: { id: string; text: string }[], options: { force?: boolean; model?: ModelRef | null } = {}) => {
        if (!items.length) return;
        const model = options.model ?? targetRef.current ?? null;
        for (let start = 0; start < items.length; start += 5) {
          const slice = items.slice(start, start + 5);
          const ids = slice.map((item) => item.id);
          markPending(ids, true);
          try {
            const payload = await request("/api/service-manager/skills/translate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                items: slice,
                target: currentLanguage(),
                force: options.force === true,
                ...(model ? { model } : {}),
              }),
            });
            setEntries((prev) => ({ ...prev, ...(payload.results ?? {}) }));
            setNotice(payload.modelError ? String(payload.modelError) : "");
          } catch (err: any) {
            setNotice(String(err.message ?? err));
          } finally {
            markPending(ids, false);
          }
        }
      };

      const openServer = servers.find((server) => server.id === openId) ?? null;
      const openTools = openServer?.tools ?? [];

      /* 展开一台服务器时，要翻的是「工具描述 + 每个参数的说明」 */
      const collectUnits = (server: ServerView | null) => {
        const units: { id: string; text: string }[] = [];
        for (const tool of server?.tools ?? []) {
          if (tool.description) units.push({ id: toolKeyOf(server as ServerView, tool), text: tool.description });
          for (const param of tool.params ?? []) {
            if (param.description) units.push({ id: paramKeyOf(server as ServerView, tool, param), text: param.description });
          }
        }
        return units;
      };

      /* 语言也算进 key：切了界面语言之后，展开中这台服务器的工具要按新语言重来一遍 */
      const openKey = openServer
        ? `${currentLanguage()}|${openServer.id}|${collectUnits(openServer).map((unit) => unit.id).join(",")}`
        : "";
      const lastOpenKey = useRef<string>("");

      /* 展开才翻译：没展开的服务器不发模型请求 */
      useEffect(() => {
        if (!openServer || !openKey) return;
        if (lastOpenKey.current === openKey) return;
        lastOpenKey.current = openKey;
        const items = collectUnits(openServer);
        if (!items.length) return;
        let alive = true;
        (async () => {
          let cached: Record<string, TranslationEntry> = {};
          try {
            const payload = await request("/api/service-manager/skills/translate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ items, target: currentLanguage(), cachedOnly: true }),
            });
            cached = payload.results ?? {};
            if (alive) setEntries((prev) => ({ ...prev, ...cached }));
          } catch {
            /* 读缓存失败就当作全都没翻过 */
          }
          if (!alive) return;
          const missing = items.filter((item) => !cached[item.id]?.text);
          if (missing.length) await translate(missing, { force: false });
        })();
        return () => {
          alive = false;
        };
      }, [openKey]);

      const retranslateOpenTools = async (model: ModelRef | null) => {
        if (!openServer) return;
        const items = collectUnits(openServer);
        if (!items.length) return;
        await translate(items, { force: true, model });
      };

      const changeModel = async (value: string) => {
        const [provider, model] = String(value).split("::");
        if (!provider || !model) return;
        const next = { provider, model };
        setTarget(next);
        try {
          await request("/api/service-manager/models", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(next),
          });
        } catch {
          /* 保存失败只影响下次默认值 */
        }
        await retranslateOpenTools(next);
      };

      /* 写盘后 MCP 是后台重连的，轮询到重连结束再拉一次列表 */
      const waitForRefresh = async (since: number) => {
        setRefreshing(true);
        try {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            let payload: any;
            try {
              payload = await request("/api/service-manager/mcp");
            } catch {
              break;
            }
            const info = payload?.refresh ?? {};
            if (!info.running && (info.at ?? 0) >= since - 5000) break;
          }
        } finally {
          setRefreshing(false);
        }
        await reload();
      };

      const toggle = async (server: ServerView) => {
        const since = Date.now();
        setBusyId(server.id);
        try {
          await request("/api/service-manager/mcp/toggle", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: server.id, enabled: !server.enabled }),
          });
          await reload();
          void waitForRefresh(since);
        } catch (err: any) {
          notify(err.message);
        } finally {
          setBusyId(null);
        }
      };

      const remove = async () => {
        const server = pendingRemove as ServerView;
        const since = Date.now();
        setPendingRemove(null);
        setBusyId(server.id);
        try {
          await request("/api/service-manager/mcp/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: server.id }),
          });
          if (openId === server.id) setOpenId(null);
          await reload();
          void waitForRefresh(since);
        } catch (err: any) {
          notify(err.message);
        } finally {
          setBusyId(null);
        }
      };

      const openConfig = async () => {
        try {
          await request("/api/service-manager/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "file" }),
          });
        } catch (err: any) {
          notify(err.message);
        }
      };

      /* 读失败且没有任何数据：整页报错 + 重试，不要一边报错一边说「还没有服务器」 */
      if (!servers.length && state.error) {
        return <ErrorState t={t} message={state.error} onRetry={reload} />;
      }

      if (state.loading && !servers.length) {
        return <TableSkeleton t={t} />;
      }

      if (!servers.length) {
        return <EmptyState t={t} onAdd={() => setEditing({ mode: "new" })} onOpen={openConfig} />;
      }

      return (
        <>
          <div className="smControls">
            <div className="smToolbar">
              <label className="smSearch">
                <IconSearch size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
              </label>
              <span className="smHint">{`${filtered.length} / ${servers.length}`}</span>
              {openTools.length ? (
                <>
                  <span className="smToolbarDivider" aria-hidden="true" />
                  <Tip label={t("translateModelHint")}>
                    <span className="smModelPick">{t("translateModel")}</span>
                  </Tip>
                  <select
                    className="smSelect"
                    value={selectedKey}
                    disabled={!modelOptions.length}
                    aria-label={t("translateModel")}
                    onChange={(event) => changeModel(event.target.value)}
                  >
                    {selectedMissing || !modelOptions.length ? (
                      <option value={selectedKey}>{target ? `${target.model} · ${target.provider}` : t("noModel")}</option>
                    ) : null}
                    {modelOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              {contextPanelProbe() ? (
                <Tip label={t("openContextHint")}>
                  <button type="button" className="smBtn" onClick={() => openContextPanel()}>
                    <IconContext size={14} />
                    {t("openContext")}
                  </button>
                </Tip>
              ) : null}
              <button type="button" className="smBtn smBtnPrimary" onClick={() => setEditing({ mode: "new" })}>
                <IconPlus size={14} />
                {t("add")}
              </button>
            </div>
            {refreshing ? (
              <div className="smNotice" data-tone="business" role="status">
                <i className="smNoticeDot" />
                <span className="smNoticeText">{t("reconnecting")}</span>
              </div>
            ) : notice ? (
              <div className="smNotice" role="status">
                <i className="smNoticeDot" />
                <Tip label={notice}>
                  <span className="smNoticeText">{t("toolTransFailed")}</span>
                </Tip>
              </div>
            ) : null}
          </div>
          <div className="smTable" data-cost={Boolean(cost?.available)}>
            <div className="smTHead">
              <span>{t("colName")}</span>
              <span>{t("colEndpoint")}</span>
              <span>{t("colStatus")}</span>
              <span>{t("colTools")}</span>
              {cost?.available ? <span>{t("colCost")}</span> : null}
              <span />
            </div>
            {filtered.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                t={t}
                busy={busyId === server.id}
                open={openId === server.id}
                entries={entries}
                pending={pending}
                showCost={Boolean(cost?.available)}
                cost={costByServer[server.serverName] ?? null}
                onOpen={(id) => setOpenId((prev) => (prev === id ? null : id))}
                onToggle={toggle}
                onRemove={setPendingRemove}
                onEdit={(target2) => setEditing({ mode: "edit", server: target2 })}
                onOpenTool={(serverRef, tool) => setActiveTool({ server: serverRef, tool })}
              />
            ))}
          </div>
          {filtered.length ? null : (
            <div className="smEmpty" style={{ padding: "40px 24px" }}>
              <p className="smEmptyBody">{t("searchNoResult")}</p>
            </div>
          )}
          {editing ? (
            <ServerForm
              t={t}
              initial={editing.server ?? null}
              onClose={() => setEditing(null)}
              onSaved={() => {
                const since = Date.now();
                setEditing(null);
                void reload();
                void waitForRefresh(since);
              }}
            />
          ) : null}
          {activeTool ? (
            <ToolDrawer
              tool={activeTool.tool}
              server={activeTool.server}
              t={t}
              entries={entries}
              entry={entries[toolKeyOf(activeTool.server, activeTool.tool)]}
              busy={Boolean(pending[toolKeyOf(activeTool.server, activeTool.tool)])}
              target={target}
              onRetranslate={() =>
                translate([{ id: toolKeyOf(activeTool.server, activeTool.tool), text: activeTool.tool.description }], { force: true })
              }
              onClose={() => setActiveTool(null)}
            />
          ) : null}
          {pendingRemove ? (
            <ConfirmDialog
              t={t}
              title={`${t("remove")} ${pendingRemove.serverName}`}
              body={t("removeConfirm")}
              onCancel={() => setPendingRemove(null)}
              onConfirm={remove}
            />
          ) : null}
        </>
      );
    }

    function SkillView({
      t,
      state,
      reload,
      notify,
    }: {
      t: Translate;
      state: AppState;
      reload: () => void;
      notify: (message: string) => void;
    }) {
      const [query, setQuery] = useState<string>("");
      const [pendingDelete, setPendingDelete] = useState<SkillInfo | null>(null);
      const [activeSkill, setActiveSkill] = useState<SkillInfo | null>(null);
      const [busy, setBusy] = useState<boolean>(false);

      const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
      const [catalogReady, setCatalogReady] = useState<boolean>(false);
      const [target, setTarget] = useState<ModelRef | null>(null);
      const [entries, setEntries] = useState<Record<string, TranslationEntry>>({});
      const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
      const [notice, setNotice] = useState<string>("");
      const [translateBusy, setTranslateBusy] = useState<boolean>(false);
      const [view, setView] = useState<string>("translated");

      const skills = state.skills ?? [];
      /* 目标语言跟着界面语言走；切语言会重渲染，这里读到的就是新值 */
      const lang = currentLanguage();

      /* 只把技能名发给 Host，由 Host 用它自己扫描到的路径去打开——
         客户端不传绝对路径，避免变成任意文件读取/打开的通道 */
      const locateSkill = async (skill: SkillInfo) => {
        try {
          await request("/api/service-manager/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "skill", name: skill.name }),
          });
        } catch (err: any) {
          notify(err.message);
        }
      };

      /* 「要不要翻」由 Host 判断（语言识别只有那一份实现）：原文已经是目标语言的，
         Host 会直接回 engine=source，不花 token。客户端不再按「含汉字」预筛，
         否则英文界面下中文摘要永远不会被翻成英文。 */
      const translatable = useMemo(() => skills.filter((skill) => skill.description), [skills]);
      /* 语言进 key：切语言后要按新语言重新走一遍「读缓存 → 补翻」 */
      const skillsKey = useMemo(
        () => [lang, ...skills.map((skill) => `${skill.path}\u0000${skill.description ?? ""}`)].join("\u0001"),
        [skills, lang]
      );

      const targetRef = useRef<ModelRef | null>(null);
      useEffect(() => {
        targetRef.current = target;
      }, [target]);

      /* 模型目录：等价于官方 GUI 的模型列表，只取 id / 名字 */
      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const payload = await request("/api/service-manager/models");
            if (!alive) return;
            setCatalog(payload);
            if (payload.selected) setTarget(payload.selected);
          } catch (err: any) {
            if (alive) setCatalog({ providers: [], failures: [{ id: "-", message: err.message }] });
          } finally {
            if (alive) setCatalogReady(true);
          }
        })();
        return () => {
          alive = false;
        };
      }, []);

      const markPending = (ids: string[], value: boolean) =>
        setPendingIds((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            if (value) next[id] = true;
            else delete next[id];
          }
          return next;
        });

      /* 翻译一批技能。译文由 Host 落盘到 translations.json，刷新后仍在。 */
      /* 分批请求，每批回来就渲染——首屏不用等全部翻完。
         本地模型代理是串行的，一次发 13 条只会让所有卡片一起干等。 */
      const TRANSLATE_CHUNK = 5;

      const translate = async (list: SkillInfo[], options: { force?: boolean; model?: ModelRef | null } = {}) => {
        const items = list
          .filter((skill) => skill.description)
          .map((skill) => ({ id: skill.path, text: skill.description }));
        if (!items.length) return;
        const model = options.model ?? targetRef.current ?? null;
        for (let start = 0; start < items.length; start += TRANSLATE_CHUNK) {
          const slice = items.slice(start, start + TRANSLATE_CHUNK);
          const ids = slice.map((item) => item.id);
          markPending(ids, true);
          try {
            const payload = await request("/api/service-manager/skills/translate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                items: slice,
                target: lang,
                force: options.force === true,
                ...(model ? { model } : {}),
              }),
            });
            setEntries((prev) => ({ ...prev, ...(payload.results ?? {}) }));
            setNotice(payload.modelError ? String(payload.modelError) : "");
          } catch (err: any) {
            setNotice(String(err.message ?? err));
          } finally {
            markPending(ids, false);
          }
        }
      };

      const initialKey = useRef<string>("");
      useEffect(() => {
        if (!catalogReady || !translatable.length) return;
        if (initialKey.current === skillsKey) return;
        initialKey.current = skillsKey;
        let alive = true;
        (async () => {
          const items = translatable.map((skill) => ({ id: skill.path, text: skill.description }));
          let cached: Record<string, TranslationEntry> = {};
          try {
            const payload = await request("/api/service-manager/skills/translate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ items, target: lang, cachedOnly: true }),
            });
            cached = payload.results ?? {};
            if (alive) setEntries((prev) => ({ ...prev, ...cached }));
          } catch {
            /* 读缓存失败就当作全都没翻过 */
          }
          if (!alive) return;
          const missing = translatable.filter((skill) => !cached[skill.path]?.text);
          if (missing.length) await translate(missing, { force: false });
        })();
        return () => {
          alive = false;
        };
      }, [catalogReady, skillsKey, translatable]);

      const modelOptions = useMemo(() => {
        const out: { key: string; label: string }[] = [];
        for (const provider of catalog?.providers ?? []) {
          for (const model of provider.models ?? []) {
            out.push({ key: `${provider.id}::${model.id}`, label: `${model.name} · ${provider.name}` });
          }
        }
        return out;
      }, [catalog]);

      const selectedKey = target ? `${target.provider}::${target.model}` : "";
      const selectedMissing = Boolean(selectedKey) && !modelOptions.some((option) => option.key === selectedKey);

      const changeModel = async (value: string) => {
        const [provider, model] = String(value).split("::");
        if (!provider || !model) return;
        const next = { provider, model };
        setTarget(next);
        try {
          await request("/api/service-manager/models", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(next),
          });
        } catch {
          /* 保存失败只影响下次默认值，不影响本次翻译 */
        }
        setTranslateBusy(true);
        await translate(translatable, { force: true, model: next });
        setTranslateBusy(false);
      };

      const retranslateAll = async () => {
        setTranslateBusy(true);
        await translate(translatable, { force: true });
        setTranslateBusy(false);
      };

      /* 摘要统计：决定顶部提示条说什么，以及「重试」重翻哪些 */
      const tally = useMemo(() => {
        const out: { model: number; machine: number; none: number; waiting: number; retry: SkillInfo[] } = {
          model: 0,
          machine: 0,
          none: 0,
          waiting: 0,
          retry: [],
        };
        for (const skill of translatable) {
          if (pendingIds[skill.path]) {
            out.waiting += 1;
            continue;
          }
          const engine = entries[skill.path]?.engine;
          if (engine === "model") out.model += 1;
          else if (engine === "machine") {
            out.machine += 1;
            out.retry.push(skill);
          } else if (engine === "none") {
            out.none += 1;
            out.retry.push(skill);
          }
        }
        return out;
      }, [translatable, entries, pendingIds]);

      const noticeText = tally.waiting
        ? t("noticeWaiting").replace("{n}", String(tally.waiting))
        : tally.none
          ? t("noticeNone").replace("{n}", String(tally.none))
          : tally.machine
            ? t("noticeMachine").replace("{n}", String(tally.machine))
            : notice;
      const noticeTone = tally.waiting ? "business" : "warn";

      const retryFailed = async () => {
        if (!tally.retry.length) return;
        setTranslateBusy(true);
        await translate(tally.retry, { force: true });
        setTranslateBusy(false);
      };

      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return skills;
        return skills.filter((skill) => skill.name.toLowerCase().includes(q));
      }, [skills, query]);

      const removeSkill = async () => {
        const skill = pendingDelete as SkillInfo;
        setPendingDelete(null);
        setBusy(true);
        try {
          await request("/api/service-manager/skills/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: skill.path }),
          });
          await reload();
        } catch (err: any) {
          notify(err.message);
        } finally {
          setBusy(false);
        }
      };

      /* 同 MCP 页：没有数据时的错误直接占满列表区，不和空态混着说 */
      if (!skills.length && state.error) {
        return <ErrorState t={t} message={state.error} onRetry={reload} />;
      }

      if (state.loading && !state.skills) {
        return <CardSkeleton t={t} />;
      }

      if (!skills.length) {
        return (
          <div className="smEmpty">
            <div className="smEmptyIcon">
              <IconServer size={22} />
            </div>
            <h3 className="smEmptyTitle">{t("skillEmpty")}</h3>
            <p className="smEmptyBody">{t("skillEmptyBody")}</p>
          </div>
        );
      }

      const card = (skill: SkillInfo) => {
        const raw = skill.description || "";
        const entry = entries[skill.path];
        const itemBusy = Boolean(pendingIds[skill.path]);
        /* engine=source 表示「原文本来就是目标语言」，不该被当成译文显示成灰色 */
        const translated = Boolean(entry?.text) && entry.engine !== "source";
        const showingTranslation = translated && view === "translated";
        const fallback = showingTranslation ? (entry?.text as string) : raw || "—";
        /* 使用次数只在「近 7 天有记录」时出现；没有记录（含没装 dsh-context）就整行不渲染 */
        const usage = state.context?.usage?.[skill.name];
        const usageText = usageLabel(t, usage);
        return (
          <div
            key={skill.path ?? skill.name}
            className="smCard"
            role="button"
            tabIndex={0}
            onClick={() => setActiveSkill(skill)}
            onKeyDown={(event: KeyboardEventOf<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveSkill(skill);
              }
            }}
          >
            <div className="smCardHead">
              <span className="smCardName">{skill.name}</span>
              {skill.modelInvocable ? null : <span className="smBadge">{t("skillHidden")}</span>}
            </div>
            <div className={showingTranslation ? "smCardDesc smTranslated" : "smCardDesc"}>{fallback}</div>
            {usageText ? (
              <Tip label={t("skillUsageHint")}>
                <span className="smCardUsage">{usageText}</span>
              </Tip>
            ) : null}
            <div className="smCardFoot">
              <span className="smHint">{skill.scope === "user" ? t("skillScopeUser") : skill.scope}</span>
              <TransTag t={t} entry={entry} busy={itemBusy} />
              {raw ? (
                <Tip label={`${t("retranslate")} ${skill.name}`}>
                  <button
                    type="button"
                    className="smCardBtn"
                    aria-label={`${t("retranslate")} ${skill.name}`}
                    data-busy={itemBusy}
                    disabled={itemBusy}
                    onClick={(event) => {
                      event.stopPropagation();
                      void translate([skill], { force: true });
                    }}
                  >
                    <IconRefresh size={13} />
                  </button>
                </Tip>
              ) : null}
              <Tip label={`${t("remove")} ${skill.name}`}>
                <button
                  type="button"
                  className="smCardDelete"
                  aria-label={`${t("remove")} ${skill.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDelete(skill);
                  }}
                >
                  <IconTrash size={14} />
                </button>
              </Tip>
            </div>
          </div>
        );
      };

      return (
        <>
          <div className="smControls">
            <div className="smToolbar">
              <label className="smSearch">
                <IconSearch size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchSkill")} aria-label={t("searchSkill")} />
              </label>
              <div className="smSeg" role="group" aria-label={t("viewMode")}>
                <button type="button" className="smSegBtn" aria-pressed={view === "translated"} onClick={() => setView("translated")}>
                  {t("showTranslated")}
                </button>
                <button type="button" className="smSegBtn" aria-pressed={view === "original"} onClick={() => setView("original")}>
                  {t("showOriginal")}
                </button>
              </div>
              <span className="smHint">{`${filtered.length} / ${skills.length}`}</span>
              <span className="smToolbarDivider" aria-hidden="true" />
              <Tip label={t("translateModelHint")}>
                <span className="smModelPick">{t("translateModel")}</span>
              </Tip>
              <select
                className="smSelect"
                value={selectedKey}
                disabled={translateBusy || !modelOptions.length}
                aria-label={t("translateModel")}
                onChange={(event) => changeModel(event.target.value)}
              >
                {selectedMissing || !modelOptions.length ? (
                  <option value={selectedKey}>{target ? `${target.model} · ${target.provider}` : t("noModel")}</option>
                ) : null}
                {modelOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button type="button" className="smBtn" disabled={translateBusy || !translatable.length} onClick={retranslateAll} data-busy={translateBusy}>
                <IconRefresh size={14} />
                {t("retranslateAll")}
              </button>
            </div>
            {noticeText ? (
              <div className="smNotice" data-tone={noticeTone} role="status">
                <i className="smNoticeDot" />
                <Tip label={notice || ""}>
                  <span className="smNoticeText">{noticeText}</span>
                </Tip>
                {tally.retry.length ? (
                  <button type="button" className="smLinkBtn smNoticeAction" disabled={translateBusy} onClick={retryFailed}>
                    {t("translateRetry")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {filtered.length ? (
            <div className="smCards">{filtered.map(card)}</div>
          ) : (
            <div className="smEmpty" style={{ padding: "40px 24px" }}>
              <p className="smEmptyBody">{t("searchNoResult")}</p>
            </div>
          )}
          {activeSkill ? (
            <SkillDrawer
              skill={activeSkill}
              t={t}
              entry={entries[activeSkill.path]}
              busy={Boolean(pendingIds[activeSkill.path])}
              target={target}
              usage={state.context?.usage?.[activeSkill.name]}
              onRetranslate={() => translate([activeSkill], { force: true })}
              onLocate={() => locateSkill(activeSkill)}
              onClose={() => setActiveSkill(null)}
            />
          ) : null}
          {pendingDelete ? (
            <ConfirmDialog
              t={t}
              title={`${t("remove")} ${pendingDelete.name}`}
              body={t("removeSkillConfirm")}
              busy={busy}
              width={460}
              onCancel={() => setPendingDelete(null)}
              onConfirm={removeSkill}
            />
          ) : null}
        </>
      );
    }

    function Page({
      t,
      tab,
      setTab,
      state,
      reload,
      notify,
    }: {
      t: Translate;
      tab: string;
      setTab: (tab: string) => void;
      state: AppState;
      reload: () => void;
      notify: (message: string) => void;
    }) {
      const [menuOpen, setMenuOpen] = useState<boolean>(false);
      const [verHidden, setVerHidden] = useState<boolean>(false);

      /**
       * 三个版本读数，各自独立：
       *  disk    磁盘上现在这版（Host 收到请求时才读）
       *  running Host 进程启动时加载的那版
       *  page    这份 JS 的构建戳
       * 前两者不同 = 必须重启；page 与 Host 不同 = 页面里是旧构建，刷新即可。
       */
      const version = state.version ?? null;
      const diskVersion = version?.disk?.version ?? null;
      const runningVersion = version?.running?.version ?? null;
      const hostCommit = version?.build?.commit ?? "";
      const hostMissing = version?.missing === true;
      const hostStale = !hostMissing && version?.stale === true;
      const pageStale = !hostStale && !hostMissing && Boolean(hostCommit && BUILD.commit && hostCommit !== BUILD.commit);
      const versionUnknown = version?.unknown === true;
      const showVersion = !verHidden && Boolean(version) && (hostStale || hostMissing || pageStale || versionUnknown);

      useEffect(() => {
        if (!menuOpen) return;
        const onDown = (event: MouseEvent) => {
          const node = event.target as HTMLElement | null;
          if (node && node.closest && node.closest(".smMenuWrap")) return;
          setMenuOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [menuOpen]);

      const openTarget = async (kind: string) => {
        setMenuOpen(false);
        try {
          await request("/api/service-manager/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind }),
          });
        } catch (err: any) {
          notify(err.message);
        }
      };

      const versionBanner = !showVersion ? null : (
        <div className="smBanner smBannerWarn" role="status">
          <div className="smBannerText">
            {hostMissing ? (
              <span className="smBannerTitle">{t("verMissingTitle")}</span>
            ) : hostStale ? (
              <span className="smBannerTitle">{t("verStaleTitle")}</span>
            ) : pageStale ? (
              <span className="smBannerTitle">{t("verPageTitle")}</span>
            ) : null}
            <span className="smBannerBody">
              {hostMissing ? t("verMissingBody") : hostStale ? t("verStaleBody") : pageStale ? t("verPageBody") : t("verUnknown")}
            </span>
            {hostStale ? (
              <span className="smBannerMeta">
                {diskVersion ? <span>{`${t("verDisk")} ${diskVersion}`}</span> : null}
                {runningVersion ? <span>{`${t("verRunning")} ${runningVersion}`}</span> : null}
                {version?.running?.startedAt ? <span>{`${t("verStarted")} ${shortClock(version.running.startedAt)}`}</span> : null}
              </span>
            ) : null}
          </div>
          <Tip label={t("verDismiss")}>
            <button type="button" className="smBannerClose" aria-label={t("verDismiss")} onClick={() => setVerHidden(true)}>
              ×
            </button>
          </Tip>
        </div>
      );

      /* 列表为空时错误由视图整块呈现（ErrorState）；这里只在已有数据时挂一条横幅，
         否则同一件事会被说两遍：上面「读取失败」，下面「还没有服务器」。 */
      const hasContent = tab === "mcp" ? Boolean(state.servers?.length) : Boolean(state.skills?.length);

      return (
        <>
          {styleTag("page", CSS)}
          <div className="smPage">
            <div className="smInner">
              <div className="smTopbar">
                <button type="button" className="smBack" onClick={() => ctxLayoutSelect(null)}>
                  <IconBack size={14} />
                  {t("back")}
                </button>
                <div className="smTopRight">
                  <Tip label={t("refresh")}>
                    <button type="button" className="smIconBtn" data-busy={state.loading} onClick={reload} aria-label={t("refresh")}>
                      <IconRefresh size={15} />
                    </button>
                  </Tip>
                  <div className="smMenuWrap">
                    <Tip label={t("more")}>
                      <button
                        type="button"
                        className="smIconBtn"
                        onClick={() => setMenuOpen((v) => !v)}
                        aria-label={t("more")}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                      >
                        <IconMore size={15} />
                      </button>
                    </Tip>
                    {menuOpen ? (
                      <div className="smMenu" role="menu">
                        <button type="button" className="smMenuItem" role="menuitem" onClick={() => openTarget("file")}>
                          <IconExternal size={14} />
                          {t("openFile")}
                        </button>
                        <button type="button" className="smMenuItem" role="menuitem" onClick={() => openTarget("folder")}>
                          <IconFolder size={14} />
                          {t("openFolder")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="smHead">
                <h1 className="smTitle">{t("title")}</h1>
                <p className="smSub">{t("sub")}</p>
              </div>
              <div className="smTabs" role="tablist">
                {["mcp", "skill"].map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    className="smTab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                  >
                    {t(`tabs.${key}`)}
                  </button>
                ))}
              </div>
              {versionBanner}
              {state.error && hasContent ? (
                <div className="smBanner">
                  <div className="smBannerText">
                    <span className="smBannerTitle">{t("errorTitle")}</span>
                    <span className="smBannerBody">{state.error}</span>
                  </div>
                  <button type="button" className="smBtn smBtnGhost" onClick={reload}>
                    {t("retry")}
                  </button>
                </div>
              ) : null}
              {tab === "mcp" ? <McpView t={t} state={state} reload={reload} notify={notify} /> : null}
              {tab === "skill" ? <SkillView t={t} state={state} reload={reload} notify={notify} /> : null}
            </div>
          </div>
        </>
      );
    }

    let ctxLayoutSelect: (id: string | null) => void = () => {};

    /* ------------------------------------------------------------------ 插件 */

    return {
      inject: ["slots", "locale", "layout"],
      apply(ctx: PluginCtx) {
        localeService = ctx.get("locale") ?? null;

        try {
          localeService?.register?.(NS, MESSAGES);
          localeService?.bind?.(NS);
        } catch {
          /* locale 不可用不阻塞页面 */
        }

        ctxLayoutSelect = (id: string | null) => {
          try {
            ctx.get("layout")?.selectPanel?.(id);
          } catch {
            /* ignore */
          }
        };

        /**
         * 深链入口只在「dsh-context 的 main 面板真的注册着」时出现。
         * 它可能没装，也可能装了但用户在偏好里把洞察页入口关了——两种都当作没有入口。
         *
         * 首选 layout 服务的 `hasMainPanel`（和 selectPanel 内部检查的是同一个注册表），
         * 老版本没有这个方法时再退回 slots.entries。
         */
        contextPanelProbe = () => {
          try {
            const layout = ctx.get("layout");
            if (typeof layout?.hasMainPanel === "function") return layout.hasMainPanel(CONTEXT_PANEL_ID) === true;
          } catch {
            /* 落到 slots 注册表 */
          }
          try {
            const entries = ctx.slots?.entries?.("main") ?? [];
            return entries.some((entry: any) => entry?.options?.key === CONTEXT_PANEL_ID);
          } catch {
            return false;
          }
        };

        openContextPanel = () => {
          try {
            ctx.get("layout")?.selectPanel?.(CONTEXT_PANEL_ID);
          } catch {
            /* 面板刚被注销：静默回退，不报错、不提示安装 */
          }
        };

        /* 页面状态提升到 apply 作用域，切走再切回不丢 */
        let store: AppState = {
          loading: false,
          error: "",
          servers: null,
          skills: null,
          version: null,
        };
        const listeners = new Set<() => void>();
        const emit = () => listeners.forEach((fn) => fn());
        const set = (patch: Partial<AppState>) => {
          store = { ...store, ...patch };
          emit();
        };

        /* 排查用：浏览器控制台里 `__smDiag()` 能看到探针读到了什么（不进 UI） */
        try {
          (window as any).__smDiag = () => ({
            hasMainPanelApi: typeof ctx.get("layout")?.hasMainPanel === "function",
            hasSlotsEntries: typeof ctx.slots?.entries === "function",
            panel: contextPanelProbe(),
            cost: store.context?.cost?.available ?? null,
            usageKeys: Object.keys(store.context?.usage ?? {}),
          });
        } catch {
          /* ignore */
        }

        /**
         * 读一次版本自述。
         *  404 = 正在跑的 Host 还没有这条路由，也就是它比页面旧。这是最需要说出来的一种情况：
         *        用户刚更新完、还没重启，页面却一言不发，正是历史上最难判断的那一刻。
         */
        const loadVersion = async () => {
          try {
            const payload = await request("/api/service-manager/version");
            set({ version: payload });
          } catch (error: any) {
            set({ version: /\b404\b/.test(String(error?.message ?? "")) ? { ok: false, missing: true } : null });
          }
        };

        const load = async (scope: string) => {
          set({ loading: true, error: "" });
          void loadVersion();
          try {
            if (scope === "mcp") {
              const payload = await request("/api/service-manager/mcp");
              set({ servers: payload.servers ?? [] });
              /* 成本列是增强项：读不到就当作没有这一列，绝不影响上面的列表 */
              void readContextCost().then((cost) =>
                set({
                  context: {
                    ...(store.context ?? { probe: "unknown" }),
                    probe: cost ? "ok" : (store.context?.probe ?? "unknown"),
                    cost,
                  },
                })
              );
            }
            if (scope === "skill") {
              const payload = await request("/api/service-manager/skills");
              set({ skills: payload.skills ?? [] });
              /* 技能用量同样由宿主聚合；拿不到就不显示那一行 */
              void (async () => {
                const usage = (await readContextUsage()) ?? undefined;
                set({
                  context: {
                    ...(store.context ?? { probe: "unknown" }),
                    probe: usage ? "ok" : "absent",
                    usage,
                  },
                });
              })();
            }
          } catch (error: any) {
            set({ error: error.message });
          } finally {
            set({ loading: false });
          }
        };

        function Shell() {
          /* 订阅语言切换：设置里改语言后整页即时重渲染，不需要重启 */
          useLocaleTick();
          const [tab, setTab] = useState<string>("mcp");
          const [snapshot, setSnapshot] = useState<AppState>(store);
          useEffect(() => {
            const fn = () => setSnapshot(store);
            listeners.add(fn);
            return () => {
              listeners.delete(fn);
            };
          }, []);
          useEffect(() => {
            load(tab);
          }, [tab]);
          const reload = useCallback(() => {
            load(tab);
          }, [tab]);
          const notify = useCallback((message: string) => set({ error: message }), []);
          return <Page t={t} tab={tab} setTab={setTab} state={snapshot} reload={reload} notify={notify} />;
        }

        const Comp = () => <Shell />;

        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: 40,
              label: () => t("nav"),
              locale: NS,
            },
            SidebarGlyph
          )
        );

        ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID }, Comp));
      },
    };
  },
});
