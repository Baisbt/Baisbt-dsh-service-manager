/**
 * 服务管理页 · Client 半区（手写单文件，不经打包）
 *
 * 设计立场：这个页面是 DSH 的一部分，不是外挂工具。
 *  - 只用宿主的设计 token（--dsw-alias-*），明暗自动跟随
 *  - 内容宽 960、内边距 clamp(24px,4vw,48px)、段间 32 —— 与宿主「插件」页同节奏
 *  - 状态不只靠颜色：圆点 + 文字，色盲友好
 */
window.__ModuleLoader__.load({
  id: "dsh-service-manager",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = "service-manager";
    const PANEL_ID = "service-manager";

    /**
     * 由 scripts/stamp.mjs 写入。用来判断「页面里这份 JS 是不是旧构建」——
     * 版本号本身以 Host 读到的 package.json 为准，这里只提供 commit 供比对。
     */
    const BUILD = { version: "0.8.2", commit: "16941dc", built: "2026-11-09T00:53:26.756Z" };

    /* 模板：只做"预填 + 把密钥写成 ${VAR}"，不引入第二套表单 */
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

    /* ---------------------------------------------------------------- 文案 */

    const MESSAGES = {
      zh: {
        nav: "服务管理",
        back: "返回会话",
        title: "服务管理",
        sub: "MCP 服务器与技能的统一入口。改动会直接写进配置，下次对话即可使用。",
        refresh: "刷新",
        tabs: { mcp: "MCP 服务器", skill: "技能", stats: "调用统计" },
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
        statEmpty: "还没有调用记录",
        statEmptyBody: "每调用一次 MCP 工具或技能，这里就会出现一条计数。统计从插件安装当天开始。",
        mcpcalls: "MCP 工具调用",
        skillcalls: "技能调用",
        statSince: "统计自",
        statSinceUnknown: "统计从插件安装当天开始累计",
        statRule: "技能计数来自模型主动加载 SKILL 的次数；斜杠命令不经过工具，不计入。",
        statUsed: "已用 {n} / {m}",
        statNoServers: "还没有配置 MCP 服务器",
        statNoSkills: "还没有发现技能",
        errTitle: "MCP 调用错误",
        errScopeAll: "全部服务器",
        errClear: "清除筛选",
        errNone: "还没有调用错误",
        errNoneFor: "这台服务器还没有报过错",
        errNoCalls: "没有调用记录，无法判断健康状态",
        errTotal: "共 {n} 次",
        errBadge: "错误 {n}",
        errUnit: "次错误",
        activityTitle: "近 14 天调用",
        actMcp: "MCP",
        actSkill: "技能",
        actFail: "失败",
        actEmpty: "近 14 天还没有调用",
        err: {
          NETWORK: "网络 / 超时",
          AUTH: "鉴权失败",
          PARAM: "参数错误",
          SERVER: "服务端错误",
          CANCELLED: "调用被取消",
          UNKNOWN: "未知",
        },
        errWhy: {
          NETWORK: "连不上或响应太慢：DNS 解析失败、连接被拒绝、读超时",
          AUTH: "密钥无效或过期，或这个 key 没有该接口的权限",
          PARAM: "模型给的参数不符合工具入参结构，请求没发出去就被拦下",
          SERVER: "服务器收到请求但自己出错：崩溃、过载、上游不可用",
          CANCELLED: "你中断了这一轮，或超时策略主动掐断",
          UNKNOWN: "无法归类，展开可见原始错误码与样本",
        },
        openFile: "打开配置文件",
        openFolder: "打开配置目录",
        externalNote: "由用户手工维护，本页仅展示",
        savedButRestart: "已写入，但需要重启 DSH 才能生效",
      },
      en: {
        nav: "Services",
        back: "Back to chat",
        title: "Services",
        sub: "One place for MCP servers and skills. Changes go straight into the config and are available in the next turn.",
        refresh: "Refresh",
        tabs: { mcp: "MCP servers", skill: "Skills", stats: "Usage" },
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
        statEmpty: "No calls recorded yet",
        statEmptyBody: "Every MCP tool call and skill invocation shows up here. Counting starts the day the plugin was installed.",
        mcpcalls: "MCP tool calls",
        skillcalls: "Skill invocations",
        statSince: "Counting since",
        statSinceUnknown: "Counting starts the day the plugin was installed",
        statRule: "Skill counts come from model-initiated SKILL loads. Slash commands bypass the tool and are not counted.",
        statUsed: "{n} of {m} used",
        statNoServers: "No MCP servers configured",
        statNoSkills: "No skills found",
        errTitle: "MCP call errors",
        errScopeAll: "All servers",
        errClear: "Clear filter",
        errNone: "No call errors yet",
        errNoneFor: "This server has not failed yet",
        errNoCalls: "No calls recorded, so health is unknown",
        errTotal: "{n} total",
        errBadge: "{n} errors",
        errUnit: "errors",
        activityTitle: "Calls, last 14 days",
        actMcp: "MCP",
        actSkill: "Skills",
        actFail: "Failed",
        actEmpty: "No calls in the last 14 days",
        err: {
          NETWORK: "Network / timeout",
          AUTH: "Authentication",
          PARAM: "Bad parameters",
          SERVER: "Server error",
          CANCELLED: "Cancelled",
          UNKNOWN: "Unknown",
        },
        errWhy: {
          NETWORK: "Cannot reach it or it is too slow: DNS failure, connection refused, read timeout",
          AUTH: "The key is invalid or expired, or it lacks permission for this endpoint",
          PARAM: "The model's arguments did not match the tool schema, so the call never left",
          SERVER: "The server received the call and failed: crash, overload, upstream unavailable",
          CANCELLED: "You interrupted the turn, or a timeout policy aborted it",
          UNKNOWN: "Not classifiable; expand to see the raw code and sample",
        },
        openFile: "Open config file",
        openFolder: "Open config folder",
        externalNote: "Maintained by hand; read-only here",
        savedButRestart: "Saved, but DSH must restart for this to take effect",
      },
    };

    const pick = (locale) => {
      const base = MESSAGES[String(locale || "").toLowerCase().startsWith("zh") ? "zh" : "en"] ?? MESSAGES.en;
      return (key) => {
        const parts = key.split(".");
        let node = base;
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
    let localeService = null;

    const readLocale = () => {
      try {
        const active = localeService?.getLocale?.()?.active;
        if (typeof active === "string" && active) return active;
      } catch {
        /* 宿主没提供 locale 服务时退回浏览器语言 */
      }
      return typeof navigator !== "undefined" && navigator.language ? navigator.language : "zh";
    };

    const tCache = new Map();
    const tFor = (value) => {
      const lang = String(value || "").toLowerCase().startsWith("zh") ? "zh" : "en";
      let fn = tCache.get(lang);
      if (!fn) {
        fn = pick(lang);
        tCache.set(lang, fn);
      }
      return fn;
    };

    /* 每次调用都按当前语言取，所以任何一次重渲染都会用上新语言 */
    const t = (key) => tFor(readLocale())(key);
    const dateLocale = () => (String(readLocale()).toLowerCase().startsWith("zh") ? "zh-CN" : "en-US");

    const subscribeLocale = (onChange) => {
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

    const svg = (props, children) =>
      h(
        "svg",
        {
          viewBox: "0 0 16 16",
          width: props.size ?? 16,
          height: props.size ?? 16,
          fill: "none",
          "aria-hidden": "true",
          style: { flex: "0 0 auto", display: "block", ...(props.style ?? {}) },
        },
        children
      );

    const IconBack = (p) => svg(p, h("path", { d: "M9.5 3.5 5 8l4.5 4.5", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }));
    const IconRefresh = (p) =>
      svg(p, [
        h("path", { key: "a", d: "M13 8a5 5 0 1 1-1.6-3.7", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
        h("path", { key: "b", d: "M13 2.5V5h-2.5", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
      ]);
    const IconPlus = (p) => svg(p, h("path", { d: "M8 3.5v9M3.5 8h9", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }));
    const IconSearch = (p) =>
      svg(p, [
        h("circle", { key: "a", cx: 7, cy: 7, r: 4.2, stroke: "currentColor", strokeWidth: 1.5 }),
        h("path", { key: "b", d: "m10.2 10.2 2.6 2.6", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
      ]);
    const IconServer = (p) =>
      svg(p, [
        h("rect", { key: "a", x: 2.5, y: 3, width: 11, height: 4, rx: 1.4, stroke: "currentColor", strokeWidth: 1.4 }),
        h("rect", { key: "b", x: 2.5, y: 9, width: 11, height: 4, rx: 1.4, stroke: "currentColor", strokeWidth: 1.4 }),
      ]);
    const IconChevron = (p) => svg(p, h("path", { d: "m6 4 4 4-4 4", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }));
    const IconMore = (p) =>
      svg(p, [0, 4, 8].map((dx, i) => h("circle", { key: i, cx: 3 + dx, cy: 8, r: 1.15, fill: "currentColor" })));
    const IconExternal = (p) =>
      svg(p, [
        h("path", { key: "a", d: "M9 3.5h3.5V7", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
        h("path", { key: "b", d: "M12.5 3.5 7.5 8.5", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
        h("path", { key: "c", d: "M11 10v2.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
      ]);
    const IconTrash = (p) =>
      svg(p, [
        h("path", { key: "a", d: "M3 4.5h10", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
        h("path", { key: "b", d: "M6.5 4.5V3.4a.9.9 0 0 1 .9-.9h1.2a.9.9 0 0 1 .9.9v1.1", stroke: "currentColor", strokeWidth: 1.4 }),
        h("path", { key: "c", d: "M4.5 4.5 5 12.2a1 1 0 0 0 1 .8h4a1 1 0 0 0 1-.8l.5-7.7", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" }),
      ]);
    const IconClose = (p) =>
      svg(p, h("path", { d: "m4.5 4.5 7 7m0-7-7 7", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }));
    const IconFolder = (p) =>
      svg(p, h("path", { d: "M2.5 4.6a1 1 0 0 1 1-1h2.6l1.2 1.4h4.2a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1z", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" }));
    const IconEdit = (p) =>
      svg(p, [
        h("path", { key: "a", d: "M10.4 2.9a1.4 1.4 0 0 1 2 2L6.2 11 3.5 12l1-2.7z", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" }),
        h("path", { key: "b", d: "M9.2 4.1 11.6 6.5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
      ]);
    const IconTool = (p) =>
      svg(p, [
        h("path", { key: "a", d: "M9.6 2.6a3.2 3.2 0 0 0-3.9 4.2l-3 3a1.2 1.2 0 0 0 0 1.7l.9.9a1.2 1.2 0 0 0 1.7 0l3-3a3.2 3.2 0 0 0 4.2-3.9l-2 2-1.5-.5-.5-1.5z", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" }),
      ]);

    /* 错误分类图标：同一 stroke、同一 currentColor，与页面其它图标一致 */
    const IconNetOff = (p) =>
      svg(p, [
        h("path", { key: "a", d: "M2.6 6.4a9.5 9.5 0 0 1 10.8 0", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
        h("path", { key: "b", d: "M5 9.4a5.6 5.6 0 0 1 6 0", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
        h("path", { key: "c", d: "M8 12.3h.01", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }),
        h("path", { key: "d", d: "M2.8 2.8 13.2 13.2", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
      ]);
    const IconKey = (p) =>
      svg(p, [
        h("circle", { key: "a", cx: 5, cy: 8, r: 2.3, stroke: "currentColor", strokeWidth: 1.4 }),
        h("path", { key: "b", d: "M7.3 8H13", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
        h("path", { key: "c", d: "M11 8v2.1M13 8v1.6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
      ]);
    const IconParam = (p) =>
      svg(p, [
        h("path", { key: "a", d: "m6 4.6-3.4 3.4L6 11.4", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }),
        h("path", { key: "b", d: "m10 4.6 3.4 3.4L10 11.4", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }),
      ]);
    const IconStop = (p) =>
      svg(p, [
        h("rect", { key: "a", x: 4, y: 4, width: 8, height: 8, rx: 1.6, stroke: "currentColor", strokeWidth: 1.4 }),
      ]);
    const IconAlert = (p) =>
      svg(p, [
        h("circle", { key: "a", cx: 8, cy: 8, r: 5.4, stroke: "currentColor", strokeWidth: 1.4 }),
        h("path", { key: "b", d: "M8 4.9v3.6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
        h("path", { key: "c", d: "M8 10.9h.01", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }),
      ]);

    const ERROR_ICON = {
      NETWORK: IconNetOff,
      AUTH: IconKey,
      PARAM: IconParam,
      SERVER: IconServer,
      CANCELLED: IconStop,
      UNKNOWN: IconAlert,
    };
    const SidebarGlyph = () =>
      h(
        "span",
        { className: "smNavGlyph", "aria-hidden": "true" },
        h(IconServer, { size: 18 })
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
.smSection{display:flex;flex-direction:column;gap:10px}
.smSectionHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.smSectionTitle{margin:0;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-secondary)}
.smTable{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}
.smTHead{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(180px,1.7fr) 100px 48px 112px;gap:16px;
  padding:8px 10px 8px 32px;font-size:11px;line-height:14px;letter-spacing:.02em;color:var(--dsw-alias-label-caption);box-sizing:border-box}
.smRowWrap{border-bottom:1px solid var(--dsw-alias-border-l2)}
.smRow{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(180px,1.7fr) 100px 48px 112px;gap:16px;align-items:center;
  width:100%;box-sizing:border-box;position:relative;padding:12px 10px 12px 32px;background:transparent;border:0;color:inherit;
  font:inherit;text-align:left;cursor:default;transition:background .12s ease}
.smRow[data-expandable=true]{cursor:pointer}
.smRowChevron{position:absolute;left:9px;top:50%;margin-top:-6px;color:var(--dsw-alias-label-caption);
  pointer-events:none;transition:transform .16s cubic-bezier(.4,0,.2,1)}
.smRowChevron[data-open=true]{transform:rotate(90deg)}
@media (prefers-reduced-motion:reduce){.smRowChevron{transition:none}}
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
.smActions{display:flex;align-items:center;justify-content:flex-end;gap:1px;flex:0 0 auto}
.smDetail{display:flex;flex-direction:column;gap:8px;padding:2px 10px 16px 24px}
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
.smSkeleton{height:52px;border-bottom:1px solid var(--dsw-alias-border-l2);
  background:linear-gradient(90deg,transparent,var(--dsw-alias-bg-skeleton),transparent);background-size:200% 100%;animation:smShimmer 1.4s ease-in-out infinite}
@keyframes smShimmer{0%{background-position:120% 0}100%{background-position:-20% 0}}
.smCards{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:12px}
.smCard{position:relative;display:flex;flex-direction:column;gap:6px;padding:14px 14px 40px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,12px);
  background:transparent;text-align:left;color:inherit;font:inherit;cursor:pointer;transition:border-color .12s ease,background .12s ease}
.smCard:hover{border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}
.smCard:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.smCardFoot{position:absolute;right:10px;bottom:8px;display:flex;align-items:center;gap:6px}
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
@media (prefers-reduced-motion:reduce){.smTransTag[data-engine=pending] i{animation:none}}
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
.smBars{display:flex;flex-direction:column;gap:14px}
.smBar{display:grid;grid-template-columns:minmax(120px,180px) 1fr 52px 56px;align-items:center;gap:14px}
.smBarName{font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smBarTrack{height:6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-active);overflow:hidden}
.smBarFill{display:block;position:relative;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary);transition:width .3s cubic-bezier(.2,.8,.2,1);overflow:hidden}
.smBarFail{position:absolute;top:0;bottom:0;right:0;background:var(--dsw-alias-state-error-primary)}
.smBarValue{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums;
  font-family:"SF Mono","JetBrains Mono",Consolas,monospace}
.smStatsMeta{display:flex;flex-direction:column;gap:3px;margin-top:-4px}
.smStatsSince{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.smStatsRule{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);max-width:72ch}
.smSectionMeta{font-size:11px;line-height:14px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.smBar[data-idle=true] .smBarName{color:var(--dsw-alias-label-tertiary)}
.smBar[data-idle=true] .smBarValue{color:var(--dsw-alias-label-caption)}
.smSpark{width:56px;height:18px;flex:0 0 auto;display:block}
.smSparkOk{fill:var(--dsw-alias-state-business-primary);opacity:.6}
.smSparkFail{fill:var(--dsw-alias-state-error-primary)}
.smSparkEmpty{fill:var(--dsw-alias-label-dimmed);opacity:.45}
.smAct{display:flex;flex-direction:column;gap:10px;padding:6px 0 2px}
.smActChart{width:100%;max-width:420px;height:56px;display:block}
.smActMcp{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary)}
.smActSkill{fill:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-primary)}
.smActFail{fill:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary)}
.smActLegend{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.smActKey{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.smActDot{display:inline-block;width:8px;height:8px;border-radius:2px}
.smSectionTools{display:flex;align-items:center;gap:8px}
.smChip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 7px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:color .12s ease,border-color .12s ease}
.smChip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4)}
.smErrList{display:flex;flex-direction:column;gap:10px}
/* 错误行必须和统计行共用同一套列宽：名字列 180、数值列 52、末列 56（错误行留空）。
   两套模板各写各的，就会出现「错误条比统计条长一截、起点还偏右」——量过：起点差 120px、终点差 66px。 */
.smErrRow{display:grid;grid-template-columns:minmax(120px,180px) 1fr 52px 56px;align-items:center;gap:14px;width:100%;
  padding:4px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left}
.smErrRowBtn{cursor:pointer;border-radius:var(--dsw-radius-sm,8px);padding:5px 8px;margin:0 -8px;width:calc(100% + 16px);
  transition:background .12s ease}
.smErrRowBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.smErrRowBtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.smErrName{display:flex;flex-direction:column;gap:1px;min-width:0}
.smErrNameText{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smErrWhy{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-caption)}
.smErrMeta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;font-family:"SF Mono","JetBrains Mono",Consolas,monospace}
.smErrTag{display:inline-flex;align-items:center;height:16px;padding:0 5px;margin-left:6px;border-radius:3px;
  font-size:11px;line-height:16px;vertical-align:1px;color:var(--dsw-alias-state-error-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}
.smDonutWrap{display:flex;align-items:center;gap:24px;flex-wrap:wrap;padding:6px 0 2px}
.smDonut{width:132px;height:132px;flex:0 0 auto}
.smDonutTrack{fill:none;stroke:var(--dsw-alias-interactive-bg-hover);stroke-width:14}
.smDonutSeg{fill:none;stroke-width:14;transition:stroke-dasharray .3s cubic-bezier(.2,.8,.2,1)}
.smDonutSeg[data-cat=NETWORK]{stroke:var(--dsw-alias-state-warn-primary)}
.smDonutSeg[data-cat=AUTH]{stroke:var(--dsw-alias-state-error-primary)}
.smDonutSeg[data-cat=PARAM]{stroke:var(--dsw-alias-state-business-primary)}
.smDonutSeg[data-cat=SERVER]{stroke:color-mix(in srgb, var(--dsw-alias-state-error-primary) 52%, var(--dsw-alias-bg-base))}
.smDonutSeg[data-cat=CANCELLED]{stroke:var(--dsw-alias-label-caption)}
.smDonutSeg[data-cat=UNKNOWN]{stroke:var(--dsw-alias-label-dimmed)}
.smDonutTotal{fill:var(--dsw-alias-label-primary);font-size:26px;font-weight:500;font-family:var(--dsw-font-family)}
.smDonutCaption{fill:var(--dsw-alias-label-caption);font-size:9px;letter-spacing:.04em}
.smErrLegend{display:flex;flex-direction:column;gap:10px;flex:1 1 260px;min-width:0}
.smErrLegendRow{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:start}
.smErrLegendIcon{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.smErrLegendIcon[data-cat=NETWORK]{color:var(--dsw-alias-state-warn-primary)}
.smErrLegendIcon[data-cat=AUTH]{color:var(--dsw-alias-state-error-primary)}
.smErrLegendIcon[data-cat=PARAM]{color:var(--dsw-alias-state-business-primary)}
.smErrLegendMain{display:flex;flex-direction:column;gap:1px;min-width:0}
.smErrLegendTitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.smErrLegendWhy{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-caption)}
.smErrLegendValue{font-size:12px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:right;
  font-variant-numeric:tabular-nums;font-family:"SF Mono","JetBrains Mono",Consolas,monospace}
.smErrLegendPct{margin-left:6px;font-size:11px;color:var(--dsw-alias-label-caption)}
@media (max-width:720px){.smDonutWrap{gap:14px}.smDonut{width:104px;height:104px}}
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
@media (max-width:720px){
  .smTHead{display:none}
  .smRow{grid-template-columns:1fr auto;grid-template-areas:"name actions" "endpoint endpoint" "status tools";row-gap:8px;align-items:start}
  .smRowChevron{top:14px;margin-top:0}
  .smName{grid-area:name}.smEndpoint{grid-area:endpoint}.smStatus{grid-area:status}.smTools{grid-area:tools;text-align:right}.smActions{grid-area:actions}
  .smBar{grid-template-columns:1fr 56px;grid-template-areas:"name value" "track track";row-gap:6px}
  .smBarName{grid-area:name}.smBarTrack{grid-area:track}.smBarValue{grid-area:value}
  .smErrRow{grid-template-columns:1fr 56px;grid-template-areas:"name value" "track track";row-gap:6px}
  .smErrName{grid-area:name}
}
`;

    const styleTag = (id, css) =>
      h("style", { "data-smd": id, dangerouslySetInnerHTML: { __html: css } });

    /* ------------------------------------------------------------------ 工具 */

    const request = async (url, init) => {
      const response = await fetch(url, { credentials: "same-origin", ...init });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload && payload.ok === false) throw new Error(payload.error || "请求失败");
      return payload;
    };

    /* 只显示时分：横幅里的"启动于"要的是"大概什么时候"，不是精确时刻 */
    const shortClock = (iso) => {
      const date = iso ? new Date(iso) : null;
      if (!date || Number.isNaN(date.getTime())) return "";
      const pad = (value) => String(value).padStart(2, "0");
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const endpointOf = (server) => {
      if (!server.endpoint) return "—";
      if (server.transport === "stdio") {
        const short = server.endpoint.replace(/^.*[\\/]/, "");
        return short.length > 64 ? short.slice(0, 61) + "…" : short;
      }
      return server.endpoint;
    };

    const STATUS_TONE = {
      connected: "success",
      configured: "warn",
      idle: "warn",
      disabled: "",
      failed: "error",
    };

    /* --------------------------------------------------- 最小 Markdown 渲染 */

    const inline = (text, keyPrefix) => {
      const nodes = [];
      const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
      let last = 0;
      let match;
      let index = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const token = match[0];
        const key = `${keyPrefix}-i${index++}`;
        if (token.startsWith("`")) {
          nodes.push(h("code", { key }, token.slice(1, -1)));
        } else if (token.startsWith("**")) {
          nodes.push(h("strong", { key }, token.slice(2, -2)));
        } else {
          const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
          nodes.push(
            h("a", { key, href: linkMatch[2], target: "_blank", rel: "noreferrer noopener" }, linkMatch[1])
          );
        }
        last = match.index + token.length;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes;
    };

    function renderMarkdown(source) {
      const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
      const blocks = [];
      let paragraph = [];
      let list = null;
      let code = null;
      let key = 0;

      const flushParagraph = () => {
        if (!paragraph.length) return;
        const text = paragraph.join(" ").trim();
        if (text) blocks.push(h("p", { key: `p${key++}` }, inline(text, `p${key}`)));
        paragraph = [];
      };
      const flushList = () => {
        if (!list) return;
        blocks.push(h(list.ordered ? "ol" : "ul", { key: `l${key++}` }, list.items.map((item, i) => h("li", { key: i }, inline(item, `l${key}-${i}`)))));
        list = null;
      };

      for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, "");
        const fence = /^```(\w*)\s*$/.exec(line);
        if (code !== null) {
          if (fence) {
            blocks.push(h("pre", { key: `c${key++}` }, h("code", null, code.join("\n"))));
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
          blocks.push(h("hr", { key: `h${key++}` }));
          continue;
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
          flushParagraph();
          flushList();
          const level = heading[1].length;
          blocks.push(h(`h${level}`, { key: `h${key++}` }, inline(heading[2], `h${key}`)));
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
      if (code !== null) blocks.push(h("pre", { key: `c${key++}` }, h("code", null, code.join("\n"))));
      flushParagraph();
      flushList();
      return blocks;
    }

    /* ---------------------------------------------------------------- 抽屉 */

    /** 译文来源：绿点=模型、琥珀点=机翻或失败、蓝点脉冲=翻译中。 */
    function TransTag({ t, entry, busy }) {
      if (busy) {
        return h("span", { className: "smTransTag", "data-engine": "pending" }, h("i", null), t("transBusy"));
      }
      if (!entry) return null;
      if (entry.engine === "model") {
        return h("span", { className: "smTransTag", "data-engine": "model", title: entry.model ?? "" }, h("i", null), t("transModel"));
      }
      if (entry.engine === "machine") {
        return h("span", { className: "smTransTag", "data-engine": "machine" }, h("i", null), t("transMachine"));
      }
      if (entry.engine === "none") {
        return h("span", { className: "smTransTag", "data-engine": "none" }, h("i", null), t("transNone"));
      }
      return null;
    }

    /** 工具摘要与参数说明的翻译键，技能/工具共用同一份磁盘缓存。 */
    const toolKeyOf = (server, tool) => `${server.id}:${tool.name}`;
    const paramKeyOf = (server, tool, param) => `${server.id}:${tool.name}#${param.name}`;

    /** 抽屉外壳：遮罩 + 右侧滑入 + Esc 关闭，技能和工具共用。 */
    function DrawerShell({ t, title, subtitle, onClose, children }) {
      const [open, setOpen] = useState(false);
      /* 用 ref 存回调：父组件重渲染会换掉 onClose 的函数身份，
         如果进把它放进依赖里，effect 每次都被取消，进场动画就永远播不出来。 */
      const onCloseRef = useRef(onClose);
      onCloseRef.current = onClose;
      useEffect(() => {
        const frame = requestAnimationFrame(() => setOpen(true));
        const onKey = (event) => {
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
      return h(
        React.Fragment,
        null,
        h("div", { className: "smDrawerScrim", "data-open": open, onClick: close }),
        h(
          "aside",
          { className: "smDrawer", "data-open": open, role: "dialog", "aria-modal": "true", "aria-label": title },
          h(
            "div",
            { className: "smDrawerHead" },
            h(
              "div",
              { className: "smDrawerTitleWrap" },
              h("h2", { className: "smDrawerTitle" }, title),
              subtitle ? h("div", { className: "smDrawerMeta smMono" }, subtitle) : null
            ),
            h("button", { type: "button", className: "smIconBtn", onClick: close, "aria-label": t("close") }, h(IconClose, { size: 15 }))
          ),
          h("div", { className: "smDrawerBody" }, children)
        )
      );
    }

    /** 抽屉里的摘要层：译文 + 来源 + 重翻，技能和工具共用。 */
    function SummarySection({ t, entry, busy, target, onRetranslate, children }) {
      const modelLabel = entry?.model || (target ? `${target.provider}/${target.model}` : "");
      return h(
        "section",
        { className: "smSummary" },
        h("div", { className: "smSummaryLabel" }, t("summaryLabel")),
        h("p", { className: "smSummaryText" }, children),
        h(
          "div",
          { className: "smSummaryMeta" },
          h(TransTag, { t, entry, busy }),
          modelLabel && !busy ? h("span", { className: "smMono", style: { fontSize: 11 } }, modelLabel) : null,
          h(
            "button",
            { type: "button", className: "smLinkBtn", disabled: busy, onClick: onRetranslate },
            busy ? `${t("transBusy")}…` : t("retranslate")
          )
        )
      );
    }

    function SourceDivider({ label }) {
      return h(
        React.Fragment,
        null,
        h("div", { className: "smSummaryDivider" }),
        h("div", { className: "smSummaryLabel", style: { marginBottom: 10 } }, label)
      );
    }

    function SkillDrawer({ skill, t, entry, busy, target, onRetranslate, onClose }) {
      const [body, setBody] = useState(null);
      const [error, setError] = useState("");
      const [loading, setLoading] = useState(true);

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
          } catch (err) {
            if (alive) setError(err.message);
          } finally {
            if (alive) setLoading(false);
          }
        })();
        return () => {
          alive = false;
        };
      }, [skill.path]);

      return h(
        DrawerShell,
        { t, title: skill.name, subtitle: skill.path, onClose },
        h(SummarySection, { t, entry, busy, target, onRetranslate }, entry?.zh || skill.description || "—"),
        h(SourceDivider, { label: t("sourceLabel") }),
        loading
          ? h("div", { className: "smSkeleton", style: { height: 120, borderRadius: 8 } })
          : error
            ? h("div", { className: "smBanner" }, h("div", { className: "smBannerText" }, h("span", { className: "smBannerBody" }, error)))
            : h("div", { className: "smMd" }, ...renderMarkdown(body))
      );
    }

    function ToolDrawer({ tool, server, t, entry, busy, target, entries, onRetranslate, onClose }) {
      const params = tool.params ?? [];
      return h(
        DrawerShell,
        { t, title: tool.name, subtitle: `${server.serverName} · ${server.endpoint}`, onClose },
        h(SummarySection, { t, entry, busy, target, onRetranslate }, entry?.zh || tool.description || "—"),
        params.length
          ? h(
              React.Fragment,
              null,
              h(SourceDivider, { label: t("paramsLabel") }),
              h(
                "div",
                { className: "smParams" },
                params.map((param) => {
                  const text = entries?.[paramKeyOf(server, tool, param)]?.zh || param.description || "";
                  return h(
                    "div",
                    { key: param.name, className: "smParam" },
                    h(
                      "div",
                      { className: "smParamHead" },
                      h("span", { className: "smParamName" }, param.name),
                      h("span", { className: "smParamType" }, param.type),
                      param.required ? h("span", { className: "smParamReq" }, t("required")) : null
                    ),
                    text ? h("p", { className: "smParamDesc" }, text) : null
                  );
                })
              )
            )
          : null
      );
    }

    /* ------------------------------------------------------------------ 组件 */

    function StatusBadge({ server, t }) {
      const tone = STATUS_TONE[server.status] ?? "";
      const label =
        {
          connected: t("statusConnected"),
          configured: t("statusConfigured"),
          idle: t("statusConfigured"),
          disabled: t("statusDisabled"),
          failed: t("statusFailed"),
        }[server.status] ?? t("statusConfigured");
      return h("span", { className: "smStatus" }, h("i", { className: "smDot", "data-tone": tone }), label);
    }

    function ToolRow({ tool, t, entry, busy, onOpen }) {
      const text = entry?.zh || tool.description || "";
      return h(
        "button",
        {
          type: "button",
          className: "smToolRow",
          onClick: () => onOpen(tool),
          "aria-label": `${tool.name} ${t("summaryLabel")}`,
        },
        h("span", { className: "smToolRowName" }, tool.name),
        h(
          "span",
          { className: "smToolRowDesc", "data-empty": !text, title: tool.description || "" },
          text || t("toolNoDesc")
        ),
        h(TransTag, { t, entry, busy })
      );
    }

    function ServerRow({ server, t, onToggle, onRemove, onEdit, onOpen, busy, open, entries, pending, onOpenTool }) {
      const tools = server.tools ?? [];
      const count = server.toolCount;
      return h(
        "div",
        { className: "smRowWrap", "data-open": open },
        h(
          "div",
          {
            className: "smRow",
            "data-expandable": "true",
            role: "button",
            tabIndex: 0,
            "aria-expanded": open,
            onClick: () => onOpen(server.id),
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(server.id);
              }
            },
          },
          h("span", { className: "smRowChevron", "data-open": open, "aria-hidden": "true" }, h(IconChevron, { size: 12 })),
          h(
            "div",
            { className: "smName" },
            h(
              "div",
              { className: "smNameMain" },
              h("span", { className: "smNameText" }, server.serverName),
              server.managed ? null : h("span", { className: "smTag" }, t("externalNote"))
            ),
            server.note ? h("div", { className: "smNameNote" }, server.note) : null
          ),
          h(
            "div",
            { className: "smEndpoint" },
            h("span", { className: "smTag" }, server.transport === "stdio" ? "stdio" : "http"),
            h("span", { className: "smEndpointText smMono", title: server.endpoint }, endpointOf(server))
          ),
          h(StatusBadge, { server, t }),
          h("div", { className: "smTools", "data-empty": count == null }, count == null ? "–" : String(count)),
          h(
            "div",
            { className: "smActions", onClick: (event) => event.stopPropagation() },
            h(
              "button",
              {
                type: "button",
                className: "smIconBtn",
                title: t("edit"),
                "aria-label": `${t("edit")} ${server.serverName}`,
                onClick: () => onEdit(server),
              },
              h(IconEdit, { size: 14 })
            ),
            h(
              "button",
              {
                type: "button",
                className: "smIconBtn smIconBtnDanger",
                title: t("remove"),
                "aria-label": `${t("remove")} ${server.serverName}`,
                onClick: () => onRemove(server),
              },
              h(IconTrash, { size: 14 })
            ),
            h(
              "button",
              {
                type: "button",
                className: "smSwitch",
                role: "switch",
                "aria-checked": server.enabled,
                "aria-label": `${server.enabled ? t("disable") : t("enable")} ${server.serverName}`,
                disabled: busy,
                onClick: () => onToggle(server),
              },
              h("span", null)
            )
          )
        ),
        open
          ? h(
              "div",
              { className: "smDetail" },
              server.transport === "stdio" && server.cwd
                ? h("div", { className: "smDetailHead" }, h("span", null, t("fieldCwd")), h("span", { className: "smMono" }, server.cwd))
                : null,
              tools.length
                ? h(
                    "div",
                    { className: "smToolRows" },
                    tools.map((tool) =>
                      h(ToolRow, {
                        key: tool.name,
                        tool,
                        t,
                        entry: entries?.[toolKeyOf(server, tool)],
                        busy: Boolean(pending?.[toolKeyOf(server, tool)]),
                        onOpen: (target) => onOpenTool(server, target),
                      })
                    )
                  )
                : h(
                    "div",
                    { className: "smHint" },
                    server.enabled ? t("toolPending") : t("toolDisabled")
                  )
            )
          : null
      );
    }

    function EmptyState({ t, onAdd, onOpen }) {
      return h(
        "div",
        { className: "smEmpty" },
        h("div", { className: "smEmptyIcon" }, h(IconServer, { size: 22 })),
        h("h3", { className: "smEmptyTitle" }, t("emptyTitle")),
        h("p", { className: "smEmptyBody" }, t("emptyBody")),
        h(
          "div",
          { className: "smEmptyActions" },
          h("button", { type: "button", className: "smBtn smBtnPrimary", onClick: onAdd }, h(IconPlus, { size: 14 }), t("emptyAdd")),
          h("button", { type: "button", className: "smBtn", onClick: onOpen }, h(IconExternal, { size: 14 }), t("emptyOpen"))
        )
      );
    }

    function ServerForm({ t, initial, onClose, onSaved }) {
      const [transport, setTransport] = useState(initial?.transport ?? "stdio");
      const [serverName, setServerName] = useState(initial?.serverName ?? "");
      const [command, setCommand] = useState(initial?.endpoint?.split(" ")[0] ?? "");
      const [args, setArgs] = useState("");
      const [cwd, setCwd] = useState(initial?.cwd ?? "");
      const [url, setUrl] = useState(initial?.transport === "streamable-http" ? initial.endpoint : "");
      const [pairs, setPairs] = useState(() =>
        Object.entries((initial?.transport === "streamable-http" ? initial?.headers : initial?.env) ?? {}).map(([k, v]) => ({
          k,
          v: String(v),
        }))
      );
      const [note, setNote] = useState(initial?.note ?? "");
      const [presetId, setPresetId] = useState("");
      const [saving, setSaving] = useState(false);
      const [error, setError] = useState("");

      const applyPreset = (id) => {
        setPresetId(id);
        const preset = PRESETS.find((item) => item.id === id);
        if (!preset) return;
        const values = preset.values;
        setServerName(values.serverName ?? "");
        setTransport(values.transport ?? "stdio");
        setCommand(values.command ?? "");
        setArgs(values.args ?? "");
        setCwd(values.cwd ?? "");
        setUrl(values.url ?? "");
        setNote(values.note ?? "");
        setPairs((values.env ?? values.headers ?? []).map((item) => ({ ...item })));
      };

      const submit = async () => {
        setSaving(true);
        setError("");
        try {
          const kv = {};
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
        } catch (err) {
          setError(err.message);
        } finally {
          setSaving(false);
        }
      };

      return h(
        "div",
        { className: "smMask", onMouseDown: (e) => e.target === e.currentTarget && onClose() },
        h(
          "div",
          { className: "smModal", role: "dialog", "aria-modal": "true" },
          h(
            "div",
            { className: "smModalHead" },
            h("h2", { className: "smModalTitle" }, initial ? t("formTitleEdit") : t("formTitleNew")),
            h(
              "button",
              { type: "button", className: "smIconBtn", onClick: onClose, "aria-label": t("cancel") },
              h("span", { style: { fontSize: 16, lineHeight: 1 } }, "×")
            )
          ),
          h(
            "div",
            { className: "smModalBody" },
            initial
              ? null
              : h(
                  "div",
                  { className: "smField" },
                  h("label", { className: "smLabel" }, t("presetLabel")),
                  h(
                    "select",
                    {
                      className: "smInput",
                      value: presetId,
                      onChange: (event) => applyPreset(event.target.value),
                    },
                    h("option", { value: "" }, t("presetNone")),
                    PRESETS.map((preset) => h("option", { key: preset.id, value: preset.id }, t(preset.labelKey)))
                  )
                ),
            h(
              "div",
              { className: "smField" },
              h("label", { className: "smLabel" }, t("fieldName")),
              h("input", {
                className: "smInput",
                value: serverName,
                onChange: (e) => setServerName(e.target.value),
                placeholder: "github",
                disabled: Boolean(initial),
              }),
              h("div", { className: "smHint" }, t("fieldNameHint"))
            ),
            h(
              "div",
              { className: "smField" },
              h("label", { className: "smLabel" }, t("fieldTransport")),
              h(
                "div",
                { className: "smSeg" },
                ["stdio", "streamable-http"].map((value) =>
                  h(
                    "button",
                    {
                      key: value,
                      type: "button",
                      className: "smSegBtn",
                      "aria-pressed": transport === value,
                      onClick: () => setTransport(value),
                    },
                    value === "stdio" ? "stdio" : "HTTP"
                  )
                )
              )
            ),
            transport === "stdio"
              ? [
                  h(
                    "div",
                    { className: "smField", key: "cmd" },
                    h("label", { className: "smLabel" }, t("fieldCommand")),
                    h("input", { className: "smInput smMono", value: command, onChange: (e) => setCommand(e.target.value), placeholder: "npx" })
                  ),
                  h(
                    "div",
                    { className: "smField", key: "args" },
                    h("label", { className: "smLabel" }, t("fieldArgs")),
                    h("textarea", {
                      className: "smTextarea",
                      value: args,
                      onChange: (e) => setArgs(e.target.value),
                      placeholder: "-y\n@modelcontextprotocol/server-github",
                    }),
                    h("div", { className: "smHint" }, t("fieldArgsHint"))
                  ),
                  h(
                    "div",
                    { className: "smField", key: "cwd" },
                    h("label", { className: "smLabel" }, t("fieldCwd")),
                    h("input", { className: "smInput smMono", value: cwd, onChange: (e) => setCwd(e.target.value), placeholder: "D:\\work" }),
                    h("div", { className: "smWarning" }, t("fieldCwdHint"))
                  ),
                ]
              : h(
                  "div",
                  { className: "smField" },
                  h("label", { className: "smLabel" }, t("fieldUrl")),
                  h("input", { className: "smInput smMono", value: url, onChange: (e) => setUrl(e.target.value), placeholder: "https://example.com/mcp" })
                ),
            h(
              "div",
              { className: "smField" },
              h("label", { className: "smLabel" }, transport === "stdio" ? t("fieldEnv") : t("fieldHeaders")),
              h(
                "div",
                { className: "smKV" },
                pairs.map((pair, index) =>
                  h(
                    "div",
                    { key: index, className: "smKVRow" },
                    h("input", {
                      className: "smInput smMono",
                      value: pair.k,
                      placeholder: transport === "stdio" ? "GITHUB_TOKEN" : "Authorization",
                      "aria-label": t("keyLabel"),
                      onChange: (event) =>
                        setPairs((prev) => prev.map((item, i) => (i === index ? { ...item, k: event.target.value } : item))),
                    }),
                    h("input", {
                      className: "smInput smMono",
                      value: pair.v,
                      placeholder: transport === "stdio" ? "ghp_…" : "Bearer …",
                      "aria-label": t("valueLabel"),
                      onChange: (event) =>
                        setPairs((prev) => prev.map((item, i) => (i === index ? { ...item, v: event.target.value } : item))),
                    }),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "smKVRemove",
                        "aria-label": t("removePair"),
                        onClick: () => setPairs((prev) => prev.filter((_, i) => i !== index)),
                      },
                      h(IconClose, { size: 12 })
                    )
                  )
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "smKVAdd",
                    onClick: () => setPairs((prev) => [...prev, { k: "", v: "" }]),
                  },
                  h(IconPlus, { size: 12 }),
                  t("addPair")
                )
              ),
              h("div", { className: "smHint" }, transport === "stdio" ? t("fieldEnvHint") : t("fieldHeadersHint"))
            ),
            h(
              "div",
              { className: "smField" },
              h("label", { className: "smLabel" }, t("fieldNote")),
              h("input", { className: "smInput", value: note, onChange: (e) => setNote(e.target.value) }),
              h("div", { className: "smHint" }, t("fieldNoteHint"))
            ),
            h("div", { className: "smHint", style: { marginTop: -2 } }, t("envRefHint")),
            error ? h("div", { className: "smBanner" }, h("div", { className: "smBannerText" }, h("span", { className: "smBannerBody" }, error))) : null
          ),
          h(
            "div",
            { className: "smModalFoot" },
            h("button", { type: "button", className: "smBtn smBtnGhost", onClick: onClose }, t("cancel")),
            h("button", { type: "button", className: "smBtn smBtnPrimary", onClick: submit, disabled: saving }, saving ? t("saving") : t("save"))
          )
        )
      );
    }

    function McpView({ t, state, reload, notify }) {
      const [query, setQuery] = useState("");
      const [editing, setEditing] = useState(null);
      const [busyId, setBusyId] = useState(null);
      const [pendingRemove, setPendingRemove] = useState(null);
      const [openId, setOpenId] = useState(null);
      const [activeTool, setActiveTool] = useState(null);

      const [catalog, setCatalog] = useState(null);
      const [target, setTarget] = useState(null);
      const [entries, setEntries] = useState({});
      const [pending, setPending] = useState({});
      const [notice, setNotice] = useState("");
      const [refreshing, setRefreshing] = useState(false);

      const servers = state.servers ?? [];
      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return servers;
        return servers.filter(
          (s) => s.serverName.toLowerCase().includes(q) || (s.endpoint ?? "").toLowerCase().includes(q)
        );
      }, [servers, query]);

      const targetRef = useRef(null);
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
        const out = [];
        for (const provider of catalog?.providers ?? []) {
          for (const model of provider.models ?? []) {
            out.push({ key: `${provider.id}::${model.id}`, label: `${model.name} · ${provider.name}` });
          }
        }
        return out;
      }, [catalog]);

      const selectedKey = target ? `${target.provider}::${target.model}` : "";
      const selectedMissing = Boolean(selectedKey) && !modelOptions.some((option) => option.key === selectedKey);

      const markPending = (ids, value) =>
        setPending((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            if (value) next[id] = true;
            else delete next[id];
          }
          return next;
        });

      /* 工具摘要翻译：和技能共用同一套磁盘缓存与模型选择；分批回来分批渲染 */
      const translate = async (items, options = {}) => {
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
              body: JSON.stringify({ items: slice, force: options.force === true, ...(model ? { model } : {}) }),
            });
            setEntries((prev) => ({ ...prev, ...(payload.results ?? {}) }));
            setNotice(payload.modelError ? String(payload.modelError) : "");
          } catch (err) {
            setNotice(String(err.message ?? err));
          } finally {
            markPending(ids, false);
          }
        }
      };

      const openServer = servers.find((server) => server.id === openId) ?? null;
      const openTools = openServer?.tools ?? [];

      /* 展开一台服务器时，要翻的是「工具描述 + 每个参数的说明」 */
      const collectUnits = (server) => {
        const units = [];
        for (const tool of server?.tools ?? []) {
          if (tool.description) units.push({ id: toolKeyOf(server, tool), text: tool.description });
          for (const param of tool.params ?? []) {
            if (param.description) units.push({ id: paramKeyOf(server, tool, param), text: param.description });
          }
        }
        return units;
      };

      const openKey = openServer ? `${openServer.id}|${collectUnits(openServer).map((unit) => unit.id).join(",")}` : "";
      const lastOpenKey = useRef("");

      /* 展开才翻译：没展开的服务器不发模型请求 */
      useEffect(() => {
        if (!openServer || !openKey) return;
        if (lastOpenKey.current === openKey) return;
        lastOpenKey.current = openKey;
        const items = collectUnits(openServer);
        if (!items.length) return;
        let alive = true;
        (async () => {
          let cached = {};
          try {
            const payload = await request("/api/service-manager/skills/translate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ items, cachedOnly: true }),
            });
            cached = payload.results ?? {};
            if (alive) setEntries((prev) => ({ ...prev, ...cached }));
          } catch {
            /* 读缓存失败就当作全都没翻过 */
          }
          if (!alive) return;
          const missing = items.filter((item) => !cached[item.id]?.zh);
          if (missing.length) await translate(missing, { force: false });
        })();
        return () => {
          alive = false;
        };
      }, [openKey]);

      const retranslateOpenTools = async (model) => {
        if (!openServer) return;
        const items = collectUnits(openServer);
        if (!items.length) return;
        await translate(items, { force: true, model });
      };

      const changeModel = async (value) => {
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
      const waitForRefresh = async (since) => {
        setRefreshing(true);
        try {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            let payload;
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

      const toggle = async (server) => {
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
        } catch (err) {
          notify(err.message);
        } finally {
          setBusyId(null);
        }
      };

      const remove = async () => {
        const server = pendingRemove;
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
        } catch (err) {
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
        } catch (err) {
          notify(err.message);
        }
      };

      if (state.loading && !servers.length) {
        return h("div", { className: "smTable" }, [0, 1, 2].map((i) => h("div", { key: i, className: "smSkeleton" })));
      }

      if (!servers.length) {
        return h(EmptyState, { t, onAdd: () => setEditing({ mode: "new" }), onOpen: openConfig });
      }

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "smControls" },
          h(
            "div",
            { className: "smToolbar" },
            h(
              "label",
              { className: "smSearch" },
              h(IconSearch, { size: 14 }),
              h("input", {
                value: query,
                onChange: (e) => setQuery(e.target.value),
                placeholder: t("search"),
                "aria-label": t("search"),
              })
            ),
            h("span", { className: "smHint" }, `${filtered.length} / ${servers.length}`),
            openTools.length
              ? h(
                  React.Fragment,
                  null,
                  h("span", { className: "smToolbarDivider", "aria-hidden": "true" }),
            h("span", { className: "smModelPick", title: t("translateModelHint") }, t("translateModel")),
                  h(
                    "select",
                    {
                      className: "smSelect",
                      value: selectedKey,
                      disabled: !modelOptions.length,
                      title: t("translateModelHint"),
                      "aria-label": t("translateModel"),
                      onChange: (event) => changeModel(event.target.value),
                    },
                    selectedMissing || !modelOptions.length
                      ? h("option", { value: selectedKey }, target ? `${target.model} · ${target.provider}` : t("noModel"))
                      : null,
                    modelOptions.map((option) => h("option", { key: option.key, value: option.key }, option.label))
                  )
                )
              : null,
            h(
              "button",
              { type: "button", className: "smBtn smBtnPrimary", onClick: () => setEditing({ mode: "new" }) },
              h(IconPlus, { size: 14 }),
              t("add")
            )
          ),
          refreshing
            ? h(
                "div",
                { className: "smNotice", "data-tone": "business", role: "status" },
                h("i", { className: "smNoticeDot" }),
                h("span", { className: "smNoticeText" }, t("reconnecting"))
              )
            : notice
              ? h(
                  "div",
                  { className: "smNotice", role: "status" },
                  h("i", { className: "smNoticeDot" }),
                  h("span", { className: "smNoticeText", title: notice }, t("toolTransFailed"))
                )
              : null
        ),
        h(
          "div",
          { className: "smTable" },
          h(
            "div",
            { className: "smTHead" },
            h("span", null, t("colName")),
            h("span", null, t("colEndpoint")),
            h("span", null, t("colStatus")),
            h("span", null, t("colTools")),
            h("span", null)
          ),
          filtered.map((server) =>
            h(ServerRow, {
              key: server.id,
              server,
              t,
              busy: busyId === server.id,
              open: openId === server.id,
              entries,
              pending,
              onOpen: (id) => setOpenId((prev) => (prev === id ? null : id)),
              onToggle: toggle,
              onRemove: setPendingRemove,
              onEdit: (target2) => setEditing({ mode: "edit", server: target2 }),
              onOpenTool: (serverRef, tool) => setActiveTool({ server: serverRef, tool }),
            })
          )
        ),
        filtered.length
          ? null
          : h(
              "div",
              { className: "smEmpty", style: { padding: "40px 24px" } },
              h("p", { className: "smEmptyBody" }, t("searchNoResult"))
            ),
        editing
          ? h(ServerForm, {
              t,
              initial: editing.server ?? null,
              onClose: () => setEditing(null),
              onSaved: () => {
                const since = Date.now();
                setEditing(null);
                void reload();
                void waitForRefresh(since);
              },
            })
          : null,
        activeTool
          ? h(ToolDrawer, {
              tool: activeTool.tool,
              server: activeTool.server,
              t,
              entries,
              entry: entries[toolKeyOf(activeTool.server, activeTool.tool)],
              busy: Boolean(pending[toolKeyOf(activeTool.server, activeTool.tool)]),
              target,
              onRetranslate: () =>
                translate([{ id: toolKeyOf(activeTool.server, activeTool.tool), text: activeTool.tool.description }], {
                  force: true,
                }),
              onClose: () => setActiveTool(null),
            })
          : null,
        pendingRemove
          ? h(
              "div",
              { className: "smMask", onMouseDown: (e) => e.target === e.currentTarget && setPendingRemove(null) },
              h(
                "div",
                { className: "smModal", role: "dialog", "aria-modal": "true", style: { maxWidth: 440 } },
                h("div", { className: "smModalHead" }, h("h2", { className: "smModalTitle" }, `${t("remove")} ${pendingRemove.serverName}`)),
                h("div", { className: "smModalBody" }, h("p", { className: "smHint" }, t("removeConfirm"))),
                h(
                  "div",
                  { className: "smModalFoot" },
                  h("button", { type: "button", className: "smBtn smBtnGhost", onClick: () => setPendingRemove(null) }, t("cancel")),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "smBtn smBtnPrimary",
                      style: { background: "var(--dsw-alias-state-error-primary)", color: "#fff" },
                      onClick: remove,
                    },
                    t("confirmRemove")
                  )
                )
              )
            )
          : null
      );
    }

    function SkillView({ t, state, reload, notify }) {
      const [query, setQuery] = useState("");
      const [pendingDelete, setPendingDelete] = useState(null);
      const [activeSkill, setActiveSkill] = useState(null);
      const [busy, setBusy] = useState(false);

      const [catalog, setCatalog] = useState(null);
      const [catalogReady, setCatalogReady] = useState(false);
      const [target, setTarget] = useState(null);
      const [entries, setEntries] = useState({});
      const [pendingIds, setPendingIds] = useState({});
      const [notice, setNotice] = useState("");
      const [translateBusy, setTranslateBusy] = useState(false);
      const [view, setView] = useState("zh");

      const skills = state.skills ?? [];

      /* 只有英文描述才需要翻译；已经是中文的跳过 */
      const translatable = useMemo(
        () => skills.filter((skill) => skill.description && !/[\u4e00-\u9fff]/.test(skill.description)),
        [skills]
      );
      const skillsKey = useMemo(
        () => skills.map((skill) => `${skill.path}\u0000${skill.description ?? ""}`).join("\u0001"),
        [skills]
      );

      const targetRef = useRef(null);
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
          } catch (err) {
            if (alive) setCatalog({ providers: [], failures: [{ id: "-", message: err.message }] });
          } finally {
            if (alive) setCatalogReady(true);
          }
        })();
        return () => {
          alive = false;
        };
      }, []);

      const markPending = (ids, value) =>
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

      const translate = async (list, options = {}) => {
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
              body: JSON.stringify({ items: slice, force: options.force === true, ...(model ? { model } : {}) }),
            });
            setEntries((prev) => ({ ...prev, ...(payload.results ?? {}) }));
            setNotice(payload.modelError ? String(payload.modelError) : "");
          } catch (err) {
            setNotice(String(err.message ?? err));
          } finally {
            markPending(ids, false);
          }
        }
      };

      const initialKey = useRef("");
      useEffect(() => {
        if (!catalogReady || !translatable.length) return;
        if (initialKey.current === skillsKey) return;
        initialKey.current = skillsKey;
        let alive = true;
        (async () => {
          const items = translatable.map((skill) => ({ id: skill.path, text: skill.description }));
          let cached = {};
          try {
            const payload = await request("/api/service-manager/skills/translate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ items, cachedOnly: true }),
            });
            cached = payload.results ?? {};
            if (alive) setEntries((prev) => ({ ...prev, ...cached }));
          } catch {
            /* 读缓存失败就当作全都没翻过 */
          }
          if (!alive) return;
          const missing = translatable.filter((skill) => !cached[skill.path]?.zh);
          if (missing.length) await translate(missing, { force: false });
        })();
        return () => {
          alive = false;
        };
      }, [catalogReady, skillsKey, translatable]);

      const modelOptions = useMemo(() => {
        const out = [];
        for (const provider of catalog?.providers ?? []) {
          for (const model of provider.models ?? []) {
            out.push({ key: `${provider.id}::${model.id}`, label: `${model.name} · ${provider.name}` });
          }
        }
        return out;
      }, [catalog]);

      const selectedKey = target ? `${target.provider}::${target.model}` : "";
      const selectedMissing = Boolean(selectedKey) && !modelOptions.some((option) => option.key === selectedKey);

      const changeModel = async (value) => {
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
        const out = { model: 0, machine: 0, none: 0, waiting: 0, retry: [] };
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
        const skill = pendingDelete;
        setPendingDelete(null);
        setBusy(true);
        try {
          await request("/api/service-manager/skills/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: skill.path }),
          });
          await reload();
        } catch (err) {
          notify(err.message);
        } finally {
          setBusy(false);
        }
      };

      if (state.loading && !state.skills) {
        return h("div", { className: "smCards" }, [0, 1, 2, 3].map((i) => h("div", { key: i, className: "smSkeleton", style: { borderRadius: 12, height: 116 } })));
      }

      if (!skills.length) {
        return h(
          "div",
          { className: "smEmpty" },
          h("div", { className: "smEmptyIcon" }, h(IconServer, { size: 22 })),
          h("h3", { className: "smEmptyTitle" }, t("skillEmpty")),
          h("p", { className: "smEmptyBody" }, t("skillEmptyBody"))
        );
      }

      const card = (skill) => {
        const raw = skill.description || "";
        const entry = entries[skill.path];
        const itemBusy = Boolean(pendingIds[skill.path]);
        const hasZh = Boolean(entry?.zh);
        const fallback = hasZh && view === "zh" ? entry.zh : raw || "—";
        return h(
          "div",
          {
            key: skill.path ?? skill.name,
            className: "smCard",
            role: "button",
            tabIndex: 0,
            onClick: () => setActiveSkill(skill),
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveSkill(skill);
              }
            },
          },
          h(
            "div",
            { className: "smCardHead" },
            h("span", { className: "smCardName" }, skill.name),
            skill.modelInvocable ? null : h("span", { className: "smBadge" }, t("skillHidden"))
          ),
          h(
            "div",
            { className: hasZh && view === "zh" ? "smCardDesc smTranslated" : "smCardDesc" },
            fallback
          ),
          h(
            "div",
            { className: "smCardFoot" },
            h("span", { className: "smHint" }, skill.scope === "user" ? t("skillScopeUser") : skill.scope),
            h(TransTag, { t, entry, busy: itemBusy }),
            raw
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "smCardBtn",
                    title: t("retranslate"),
                    "aria-label": `${t("retranslate")} ${skill.name}`,
                    "data-busy": itemBusy,
                    disabled: itemBusy,
                    onClick: (event) => {
                      event.stopPropagation();
                      void translate([skill], { force: true });
                    },
                  },
                  h(IconRefresh, { size: 13 })
                )
              : null,
            h(
              "button",
              {
                type: "button",
                className: "smCardDelete",
                title: t("remove"),
                "aria-label": `${t("remove")} ${skill.name}`,
                onClick: (event) => {
                  event.stopPropagation();
                  setPendingDelete(skill);
                },
              },
              h(IconTrash, { size: 14 })
            )
          )
        );
      };

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "smControls" },
          h(
            "div",
            { className: "smToolbar" },
            h(
              "label",
              { className: "smSearch" },
              h(IconSearch, { size: 14 }),
              h("input", {
                value: query,
                onChange: (e) => setQuery(e.target.value),
                placeholder: t("searchSkill"),
                "aria-label": t("searchSkill"),
              })
            ),
            h(
              "div",
              { className: "smSeg", role: "group", "aria-label": t("viewMode") },
              h(
                "button",
                {
                  type: "button",
                  className: "smSegBtn",
                  "aria-pressed": view === "zh",
                  onClick: () => setView("zh"),
                },
                t("showTranslated")
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "smSegBtn",
                  "aria-pressed": view === "en",
                  onClick: () => setView("en"),
                },
                t("showOriginal")
              )
            ),
            h("span", { className: "smHint" }, `${filtered.length} / ${skills.length}`),
            h("span", { className: "smToolbarDivider", "aria-hidden": "true" }),
            h("span", { className: "smModelPick", title: t("translateModelHint") }, t("translateModel")),
            h(
              "select",
              {
                className: "smSelect",
                value: selectedKey,
                disabled: translateBusy || !modelOptions.length,
                title: t("translateModelHint"),
                "aria-label": t("translateModel"),
                onChange: (event) => changeModel(event.target.value),
              },
              selectedMissing || !modelOptions.length
                ? h("option", { value: selectedKey }, target ? `${target.model} · ${target.provider}` : t("noModel"))
                : null,
              modelOptions.map((option) => h("option", { key: option.key, value: option.key }, option.label))
            ),
            h(
              "button",
              {
                type: "button",
                className: "smBtn",
                disabled: translateBusy || !translatable.length,
                onClick: retranslateAll,
                "data-busy": translateBusy,
              },
              h(IconRefresh, { size: 14 }),
              t("retranslateAll")
            )
          ),
          noticeText
            ? h(
                "div",
                { className: "smNotice", "data-tone": noticeTone, role: "status" },
                h("i", { className: "smNoticeDot" }),
                h("span", { className: "smNoticeText", title: notice || "" }, noticeText),
                tally.retry.length
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "smLinkBtn smNoticeAction",
                        disabled: translateBusy,
                        onClick: retryFailed,
                      },
                      t("translateRetry")
                    )
                  : null
              )
            : null
        ),
        filtered.length
          ? h("div", { className: "smCards" }, filtered.map(card))
          : h("div", { className: "smEmpty", style: { padding: "40px 24px" } }, h("p", { className: "smEmptyBody" }, t("searchNoResult"))),
        activeSkill
          ? h(SkillDrawer, {
              skill: activeSkill,
              t,
              entry: entries[activeSkill.path],
              busy: Boolean(pendingIds[activeSkill.path]),
              target,
              onRetranslate: () => translate([activeSkill], { force: true }),
              onClose: () => setActiveSkill(null),
            })
          : null,
        pendingDelete
          ? h(
              "div",
              { className: "smMask", onMouseDown: (e) => e.target === e.currentTarget && setPendingDelete(null) },
              h(
                "div",
                { className: "smModal", role: "dialog", "aria-modal": "true", style: { maxWidth: 460 } },
                h("div", { className: "smModalHead" }, h("h2", { className: "smModalTitle" }, `${t("remove")} ${pendingDelete.name}`)),
                h("div", { className: "smModalBody" }, h("p", { className: "smHint" }, t("removeSkillConfirm"))),
                h(
                  "div",
                  { className: "smModalFoot" },
                  h("button", { type: "button", className: "smBtn smBtnGhost", onClick: () => setPendingDelete(null) }, t("cancel")),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "smBtn smBtnPrimary",
                      disabled: busy,
                      style: { background: "var(--dsw-alias-state-error-primary)", color: "#fff" },
                      onClick: removeSkill,
                    },
                    t("confirmRemove")
                  )
                )
              )
            )
          : null
      );
    }
    function StatsView({ t, state }) {
      const [selected, setSelected] = useState(null);
      const rows = state.stats ?? [];

      if (state.loading && !state.stats) {
        return h("div", { className: "smSkeleton", style: { height: 120, borderRadius: 12 } });
      }
      if (!rows.length) {
        return h(
          "div",
          { className: "smEmpty" },
          h("div", { className: "smEmptyIcon" }, h(IconRefresh, { size: 20 })),
          h("h3", { className: "smEmptyTitle" }, t("statEmpty")),
          h("p", { className: "smEmptyBody" }, t("statEmptyBody"))
        );
      }

      const keyOf = (row) => `${row.kind}:${row.name}`;
      const max = Math.max(...rows.map((row) => row.count), 1);
      const servers = rows.filter((row) => row.kind === "mcp");
      const skills = rows.filter((row) => row.kind === "skill");
      const failTotal = rows.reduce((sum, row) => sum + (row.fails ?? 0), 0);
      const activeRow = selected ? servers.find((row) => keyOf(row) === selected) ?? null : null;

      const since = state.statsSince
        ? new Date(state.statsSince).toLocaleDateString(dateLocale(), {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
        : null;

      /* 迷你柱：稀疏计数用柱不用折线——0 值必须有视觉落点。
         全行共用一个刻度，横向才可比。 */
      const sparkMax = Math.max(
        1,
        ...rows.flatMap((row) => {
          const ok = row.series?.ok ?? [];
          const fail = row.series?.fail ?? [];
          return ok.map((value, index) => value + (fail[index] ?? 0));
        })
      );

      const spark = (row, key) => {
        const ok = row.series?.ok ?? [];
        if (!ok.length) return null;
        const fail = row.series?.fail ?? [];
        const W = 56;
        const H = 18;
        const step = W / ok.length;
        const barW = Math.max(2, step - 1.2);
        return h(
          "svg",
          { key, viewBox: `0 0 ${W} ${H}`, className: "smSpark", "aria-hidden": "true" },
          ok.map((value, index) => {
            const failed = fail[index] ?? 0;
            const total = value + failed;
            if (!total) {
              return h("rect", { key: index, x: index * step, y: H - 1.5, width: barW, height: 1.5, className: "smSparkEmpty" });
            }
            const totalH = Math.max(2, (total / sparkMax) * H);
            const failH = (failed / total) * totalH;
            const okH = totalH - failH;
            return h(
              "g",
              { key: index },
              okH > 0 ? h("rect", { x: index * step, y: H - okH, width: barW, height: okH, className: "smSparkOk" }) : null,
              failH > 0
                ? h("rect", { x: index * step, y: H - totalH, width: barW, height: failH, className: "smSparkFail" })
                : null
            );
          })
        );
      };

      /* 0 次的行也要在：没有这一行，用户无法区分「没被用过」和「不支持统计」 */
      const bar = (row) =>
        h(
          "div",
          { key: keyOf(row), className: "smBar", "data-idle": row.count === 0 },
          h(
            "span",
            { className: "smBarName", title: row.name },
            row.name,
            row.fails ? h("span", { className: "smErrTag" }, t("errBadge").replace("{n}", String(row.fails))) : null
          ),
          h(
            "span",
            { className: "smBarTrack" },
            h(
              "span",
              { className: "smBarFill", style: { width: `${(row.count / max) * 100}%` } },
              row.fails ? h("span", { className: "smBarFail", style: { width: `${(row.fails / row.count) * 100}%` } }) : null
            )
          ),
          h("span", { className: "smBarValue" }, String(row.count)),
          spark(row, `spark-${keyOf(row)}`)
        );

      const section = (title, list, emptyText) => {
        const used = list.filter((row) => row.count > 0).length;
        return h(
          "section",
          { className: "smSection" },
          h(
            "div",
            { className: "smSectionHead" },
            h("h3", { className: "smSectionTitle" }, title),
            list.length ? h("span", { className: "smSectionMeta" }, t("statUsed").replace("{n}", String(used)).replace("{m}", String(list.length))) : null
          ),
          list.length ? h("div", { className: "smBars" }, list.map(bar)) : h("div", { className: "smHint" }, emptyText)
        );
      };

      /* 未选中按服务器汇总，选中后换成这台服务器的错误分类。
         同一张图换维度，所以区块右边必须写明当前看的是什么，并给出清除入口。 */
      const failing = servers
        .filter((row) => (row.fails ?? 0) > 0)
        .sort((a, b) => (b.fails ?? 0) - (a.fails ?? 0) || a.name.localeCompare(b.name));
      const failMax = Math.max(...failing.map((row) => row.fails ?? 0), 1);

      const serverFailRow = (row) =>
        h(
          "button",
          {
            key: keyOf(row),
            type: "button",
            className: "smErrRow smErrRowBtn",
            onClick: () => setSelected(keyOf(row)),
            "aria-label": `${row.name} — ${t("errBadge").replace("{n}", String(row.fails ?? 0))}`,
          },
          h("span", { className: "smErrName" }, h("span", { className: "smErrNameText" }, row.name)),
          h(
            "span",
            { className: "smBarTrack" },
            h("span", { className: "smBarFill", style: { width: `${((row.fails ?? 0) / failMax) * 100}%` } })
          ),
          h("span", { className: "smBarValue" }, String(row.fails ?? 0))
        );

      const categories = activeRow
        ? Object.entries(activeRow.errors ?? {})
            .map(([category, value]) => ({
              category,
              count: Number(value?.count) || 0,
              lastAt: Number(value?.lastAt) || 0,
              codes: value?.codes ?? {},
              sample: String(value?.sample ?? ""),
            }))
            .sort((a, b) => b.count - a.count)
        : [];

      /* 选中一台服务器后，错误分类是「部分与整体」关系，环形图比条形更能说明占比；
         图例保留数量、百分比和原因解释——颜色不是唯一编码。 */
      const errorDonut = (items) => {
        const total = items.reduce((sum, item) => sum + item.count, 0);
        const radius = 38;
        const circumference = 2 * Math.PI * radius;
        let offset = 0;
        return h(
          "div",
          { className: "smDonutWrap" },
          h(
            "svg",
            {
              viewBox: "0 0 100 100",
              className: "smDonut",
              role: "img",
              "aria-label": `${t("errTitle")} ${total}`,
            },
            h("circle", { cx: 50, cy: 50, r: radius, className: "smDonutTrack" }),
            items.map((item) => {
              const dash = (item.count / total) * circumference;
              const node = h("circle", {
                key: item.category,
                cx: 50,
                cy: 50,
                r: radius,
                className: "smDonutSeg",
                "data-cat": item.category,
                strokeDasharray: `${dash} ${circumference - dash}`,
                strokeDashoffset: -offset,
                transform: "rotate(-90 50 50)",
              });
              offset += dash;
              return node;
            }),
            h("text", { x: 50, y: 48, className: "smDonutTotal", textAnchor: "middle" }, String(total)),
            h("text", { x: 50, y: 62, className: "smDonutCaption", textAnchor: "middle" }, t("errUnit"))
          ),
          h(
            "div",
            { className: "smErrLegend" },
            items.map((item) => {
              const Icon = ERROR_ICON[item.category] ?? IconAlert;
              const codes = Object.entries(item.codes ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([code, times]) => (times > 1 ? `${code} ×${times}` : code))
                .join(" · ");
              const pct = total ? Math.round((item.count / total) * 100) : 0;
              return h(
                "div",
                { key: item.category, className: "smErrLegendRow" },
                h("span", { className: "smErrLegendIcon", "data-cat": item.category }, h(Icon, { size: 14 })),
                h(
                  "span",
                  { className: "smErrLegendMain" },
                  h("span", { className: "smErrLegendTitle" }, t(`err.${item.category}`)),
                  h("span", { className: "smErrLegendWhy" }, t(`errWhy.${item.category}`)),
                  codes ? h("span", { className: "smErrMeta", title: item.sample }, codes) : null
                ),
                h(
                  "span",
                  { className: "smErrLegendValue" },
                  String(item.count),
                  h("span", { className: "smErrLegendPct" }, `${pct}%`)
                )
              );
            })
          )
        );
      };

      /* 零调用 ≠ 零错误：连不上的服务器根本不会产生 tools/result，
         这里必须说「无法判断」，不能显示成健康。 */
      const errorBody = activeRow
        ? activeRow.count === 0
          ? h("div", { className: "smHint" }, t("errNoCalls"))
          : categories.length
            ? errorDonut(categories)
            : h("div", { className: "smHint" }, activeRow.fails ? t("errNone") : t("errNoneFor"))
        : failing.length
          ? h("div", { className: "smErrList" }, failing.map(serverFailRow))
          : h("div", { className: "smHint" }, t("errNone"));

      const errorSection = h(
        "section",
        { className: "smSection" },
        h(
          "div",
          { className: "smSectionHead" },
          h("h3", { className: "smSectionTitle" }, t("errTitle")),
          h(
            "div",
            { className: "smSectionTools" },
            activeRow
              ? h(
                  "button",
                  { type: "button", className: "smChip", onClick: () => setSelected(null), title: t("errClear") },
                  h("span", null, activeRow.name),
                  h(IconClose, { size: 11 })
                )
              : h("span", { className: "smSectionMeta" }, t("errScopeAll")),
            failTotal ? h("span", { className: "smSectionMeta" }, t("errTotal").replace("{n}", String(failTotal))) : null
          )
        ),
        errorBody
      );

      /* 顶部趋势：按天的调用量，成功按来源堆叠、失败盖在最上面 */
      const dayKeys = state.statsDays ?? [];
      let activitySection = null;
      if (dayKeys.length) {
        const buckets = { mcp: [], skill: [], fail: [] };
        for (let index = 0; index < dayKeys.length; index += 1) {
          buckets.mcp.push(0);
          buckets.skill.push(0);
          buckets.fail.push(0);
        }
        for (const row of rows) {
          const ok = row.series?.ok ?? [];
          const fail = row.series?.fail ?? [];
          for (let index = 0; index < dayKeys.length; index += 1) {
            const value = ok[index] ?? 0;
            if (row.kind === "mcp") buckets.mcp[index] += value;
            else buckets.skill[index] += value;
            buckets.fail[index] += fail[index] ?? 0;
          }
        }
        const totals = dayKeys.map((_, index) => buckets.mcp[index] + buckets.skill[index] + buckets.fail[index]);
        const peak = Math.max(...totals, 1);
        const anyCall = totals.some((value) => value > 0);
        const W = 196;
        const H = 56;
        const step = W / dayKeys.length;
        const barW = Math.max(3, step - 4);
        const shortDate = (key) => String(key).slice(5).replace("-", "/");

        activitySection = h(
          "section",
          { className: "smSection" },
          h(
            "div",
            { className: "smSectionHead" },
            h("h3", { className: "smSectionTitle" }, t("activityTitle")),
            h(
              "span",
              { className: "smSectionMeta" },
              `${shortDate(dayKeys[0])} – ${shortDate(dayKeys[dayKeys.length - 1])}`
            )
          ),
          anyCall
            ? h(
                "div",
                { className: "smAct" },
                h(
                  "svg",
                  { viewBox: `0 0 ${W} ${H}`, className: "smActChart", role: "img", "aria-label": t("activityTitle") },
                  dayKeys.map((day, index) => {
                    let cursor = H;
                    const segs = [];
                    const add = (value, className, suffix) => {
                      if (!value) return;
                      const height = Math.max(1, (value / peak) * H);
                      cursor -= height;
                      segs.push(
                        h("rect", { key: `${day}-${suffix}`, x: index * step, y: cursor, width: barW, height, className })
                      );
                    };
                    add(buckets.mcp[index], "smActMcp", "mcp");
                    add(buckets.skill[index], "smActSkill", "skill");
                    add(buckets.fail[index], "smActFail", "fail");
                    return h("g", { key: day }, segs);
                  })
                ),
                h(
                  "div",
                  { className: "smActLegend" },
                  h("span", { className: "smActKey" }, h("i", { className: "smActDot smActMcp" }), t("actMcp")),
                  h("span", { className: "smActKey" }, h("i", { className: "smActDot smActSkill" }), t("actSkill")),
                  h("span", { className: "smActKey" }, h("i", { className: "smActDot smActFail" }), t("actFail"))
                )
              )
            : h("div", { className: "smHint" }, t("actEmpty"))
        );
      }

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "smStatsMeta" },
          h("span", { className: "smStatsSince" }, since ? `${t("statSince")} ${since}` : t("statSinceUnknown")),
          h("span", { className: "smStatsRule" }, t("statRule"))
        ),
        activitySection,
        section(t("mcpcalls"), servers, t("statNoServers")),
        section(t("skillcalls"), skills, t("statNoSkills")),
        errorSection
      );
    }

    function Page({ t, tab, setTab, state, reload, notify }) {
      const [menuOpen, setMenuOpen] = useState(false);
      const [verHidden, setVerHidden] = useState(false);

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
      const showVersion =
        !verHidden && Boolean(version) && (hostStale || hostMissing || pageStale || versionUnknown);

      useEffect(() => {
        if (!menuOpen) return;
        const onDown = (event) => {
          const node = event.target;
          if (node && node.closest && node.closest(".smMenuWrap")) return;
          setMenuOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [menuOpen]);

      const openTarget = async (kind) => {
        setMenuOpen(false);
        try {
          await request("/api/service-manager/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind }),
          });
        } catch (err) {
          notify(err.message);
        }
      };

      const versionBanner = !showVersion
        ? null
        : h(
            "div",
            { className: "smBanner smBannerWarn", role: "status" },
            h(
              "div",
              { className: "smBannerText" },
              hostMissing
                ? h("span", { className: "smBannerTitle" }, t("verMissingTitle"))
                : hostStale
                  ? h("span", { className: "smBannerTitle" }, t("verStaleTitle"))
                  : pageStale
                    ? h("span", { className: "smBannerTitle" }, t("verPageTitle"))
                    : null,
              h(
                "span",
                { className: "smBannerBody" },
                hostMissing
                  ? t("verMissingBody")
                  : hostStale
                    ? t("verStaleBody")
                    : pageStale
                      ? t("verPageBody")
                      : t("verUnknown")
              ),
              hostStale
                ? h(
                    "span",
                    { className: "smBannerMeta" },
                    diskVersion ? h("span", null, `${t("verDisk")} ${diskVersion}`) : null,
                    runningVersion ? h("span", null, `${t("verRunning")} ${runningVersion}`) : null,
                    version?.running?.startedAt
                      ? h("span", null, `${t("verStarted")} ${shortClock(version.running.startedAt)}`)
                      : null
                  )
                : null
            ),
            h(
              "button",
              {
                type: "button",
                className: "smBannerClose",
                "aria-label": t("verDismiss"),
                title: t("verDismiss"),
                onClick: () => setVerHidden(true),
              },
              "×"
            )
          );

      return h(
        React.Fragment,
        null,
        styleTag("page", CSS),
        h(
          "div",
          { className: "smPage" },
          h(
            "div",
            { className: "smInner" },
            h(
              "div",
              { className: "smTopbar" },
              h(
                "button",
                { type: "button", className: "smBack", onClick: () => ctxLayoutSelect(null) },
                h(IconBack, { size: 14 }),
                t("back")
              ),
              h(
                "div",
                { className: "smTopRight" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "smIconBtn",
                    "data-busy": state.loading,
                    onClick: reload,
                    title: t("refresh"),
                    "aria-label": t("refresh"),
                  },
                  h(IconRefresh, { size: 15 })
                ),
                h(
                  "div",
                  { className: "smMenuWrap" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "smIconBtn",
                      onClick: () => setMenuOpen((v) => !v),
                      title: t("more"),
                      "aria-label": t("more"),
                      "aria-haspopup": "menu",
                      "aria-expanded": menuOpen,
                    },
                    h(IconMore, { size: 15 })
                  ),
                  menuOpen
                    ? h(
                        "div",
                        { className: "smMenu", role: "menu" },
                        h(
                          "button",
                          { type: "button", className: "smMenuItem", role: "menuitem", onClick: () => openTarget("file") },
                          h(IconExternal, { size: 14 }),
                          t("openFile")
                        ),
                        h(
                          "button",
                          { type: "button", className: "smMenuItem", role: "menuitem", onClick: () => openTarget("folder") },
                          h(IconFolder, { size: 14 }),
                          t("openFolder")
                        )
                      )
                    : null
                )
              )
            ),
            h(
              "div",
              { className: "smHead" },
              h("h1", { className: "smTitle" }, t("title")),
              h("p", { className: "smSub" }, t("sub"))
            ),
            h(
              "div",
              { className: "smTabs", role: "tablist" },
              ["mcp", "skill", "stats"].map((key) =>
                h(
                  "button",
                  {
                    key,
                    type: "button",
                    role: "tab",
                    className: "smTab",
                    "aria-selected": tab === key,
                    onClick: () => setTab(key),
                  },
                  t(`tabs.${key}`)
                )
              )
            ),
            versionBanner,
            state.error
              ? h(
                  "div",
                  { className: "smBanner" },
                  h("div", { className: "smBannerText" }, h("span", { className: "smBannerTitle" }, t("errorTitle")), h("span", { className: "smBannerBody" }, state.error)),
                  h("button", { type: "button", className: "smBtn smBtnGhost", onClick: reload }, t("retry"))
                )
              : null,
            tab === "mcp" ? h(McpView, { t, state, reload, notify }) : null,
            tab === "skill" ? h(SkillView, { t, state, reload, notify }) : null,
            tab === "stats" ? h(StatsView, { t, state }) : null
          )
        )
      );
    }

    let ctxLayoutSelect = () => {};

    /* ------------------------------------------------------------------ 插件 */

    return {
      inject: ["slots", "locale", "layout"],
      apply(ctx) {
        localeService = ctx.get("locale") ?? null;

        try {
          localeService?.register?.(NS, MESSAGES);
          localeService?.bind?.(NS);
        } catch {
          /* locale 不可用不阻塞页面 */
        }

        ctxLayoutSelect = (id) => {
          try {
            ctx.get("layout")?.selectPanel?.(id);
          } catch {
            /* ignore */
          }
        };

        /* 页面状态提升到 apply 作用域，切走再切回不丢 */
        let store = {
          loading: false,
          error: "",
          servers: null,
          skills: null,
          stats: null,
          version: null,
        };
        const listeners = new Set();
        const emit = () => listeners.forEach((fn) => fn());
        const set = (patch) => {
          store = { ...store, ...patch };
          emit();
        };

        /**
         * 读一次版本自述。
         *  404 = 正在跑的 Host 还没有这条路由，也就是它比页面旧。这是最需要说出来的一种情况：
         *        用户刚更新完、还没重启，页面却一言不发，正是历史上最难判断的那一刻。
         */
        const loadVersion = async () => {
          try {
            const payload = await request("/api/service-manager/version");
            set({ version: payload });
          } catch (error) {
            set({ version: /\b404\b/.test(String(error?.message ?? "")) ? { ok: false, missing: true } : null });
          }
        };

        const load = async (scope) => {
          set({ loading: true, error: "" });
          void loadVersion();
          try {
            if (scope === "mcp" || scope === "all") {
              const payload = await request("/api/service-manager/mcp");
              set({ servers: payload.servers ?? [] });
            }
            if (scope === "skill" || scope === "all") {
              const payload = await request("/api/service-manager/skills");
              set({ skills: payload.skills ?? [] });
            }
            if (scope === "stats" || scope === "all") {
              const payload = await request("/api/service-manager/stats");
              set({ stats: payload.rows ?? [], statsSince: payload.since ?? null, statsDays: payload.days ?? [] });
            }
          } catch (error) {
            set({ error: error.message });
          } finally {
            set({ loading: false });
          }
        };

        function Shell() {
          /* 订阅语言切换：设置里改语言后整页即时重渲染，不需要重启 */
          useLocaleTick();
          const [tab, setTab] = useState("mcp");
          const [snapshot, setSnapshot] = useState(store);
          useEffect(() => {
            const fn = () => setSnapshot(store);
            listeners.add(fn);
            return () => listeners.delete(fn);
          }, []);
          useEffect(() => {
            load(tab === "mcp" ? "mcp" : tab === "skill" ? "skill" : "stats");
          }, [tab]);
          const reload = useCallback(() => {
            load(tab === "mcp" ? "mcp" : tab === "skill" ? "skill" : "stats");
          }, [tab]);
          const notify = useCallback((message) => set({ error: message }), []);
          return h(Page, { t, tab, setTab, state: snapshot, reload, notify });
        }

        const Comp = () => h(Shell);

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

        ctx.slots.inject("main", () =>
          ctx.slots.register({ name: "main", key: PANEL_ID }, Comp)
        );
      },
    };
  },
});
