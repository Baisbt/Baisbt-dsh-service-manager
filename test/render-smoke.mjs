/**
 * 离线渲染校验：用最小 React 替身在 Node 里跑一遍 Client，确认两页 + 抽屉都能构建出树。
 * 只做结构校验，不涉及样式与交互。用 node test/render-smoke.mjs 运行。
 *
 * 断言的是编译产物 client.js；直接跑本文件时先确认它不是旧构建（`pnpm test` 会先编译）。
 */
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/* 相对于本文件定位 client.js，仓库搬到哪都能跑。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const parent = path.join(HERE, "..");

/* 源码比产物新 = 这份断言跑的是旧构建，先提醒再继续（不静默） */
const input = await stat(path.join(parent, "client.tsx")).catch(() => null);
const output = await stat(path.join(parent, "client.js")).catch(() => null);
if (input && output && input.mtimeMs > output.mtimeMs) {
  console.log("⚠ client.tsx 比 client.js 新 —— 下面断言的是旧构建，先跑 pnpm build\n");
}

const source = await readFile(path.join(parent, "client.js"), "utf8");

const FRAGMENT = Symbol("Fragment");
const noop = () => {};

let forceTab = "skill";
let store = null;
let entriesOverride = null;
let entriesUsed = false;
let activeSkillOverride = null;
let expandServerId = null;
let openToolOverride = null;
let nullSeen = 0;

const useState = (initial) => {
  if (initial === "mcp") return [forceTab, noop];
  if (initial && typeof initial === "object" && !Array.isArray(initial) && "servers" in initial && store) {
    return [store, noop];
  }
  if (initial === null) {
    nullSeen += 1;
    /* SkillView 第 2 个 null = activeSkill；McpView 第 4 个 = openId，第 5 个 = activeTool */
    if (activeSkillOverride && forceTab === "skill" && nullSeen === 2) return [activeSkillOverride, noop];
    if (expandServerId && forceTab === "mcp" && nullSeen === 4) return [expandServerId, noop];
    if (openToolOverride && forceTab === "mcp" && nullSeen === 5) return [openToolOverride, noop];
    return [null, noop];
  }
  if (
    entriesOverride &&
    !entriesUsed &&
    initial &&
    typeof initial === "object" &&
    !Array.isArray(initial) &&
    Object.keys(initial).length === 0
  ) {
    entriesUsed = true;
    return [entriesOverride, noop];
  }
  return [initial, noop];
};

const React = {
  Fragment: FRAGMENT,
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.length <= 1 ? children[0] : children,
  }),
  useState,
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useEffect: noop,
  useCallback: (fn) => fn,
};

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => {
      captured = definition;
    },
  },
};

new Function("window", source)(globalThis.window);
if (!captured) throw new Error("模块没有被注册");

const mod = captured.factory((id) => {
  if (id === "react") return React;
  throw new Error(`unexpected require: ${id}`);
});

let mainComponent = null;
let activeLocale = "zh";
const ctx = {
  slots: {
    inject: (name, factory) => factory(),
    register: (descriptor, component) => {
      if (descriptor?.name === "main") mainComponent = component;
      return noop;
    },
  },
  /* 真实宿主提供 getLocale().active；navigator.language 是 Electron 的 --lang，不能作为语言来源 */
  get: (name) =>
    name === "locale"
      ? { getLocale: () => ({ active: activeLocale }), register: noop, bind: noop, subscribe: () => noop }
      : undefined,
};

/* 模拟 Electron 启动参数 --lang=zh-CN：用户把界面切成英文后，navigator 仍是 zh-CN */
Object.defineProperty(globalThis, "navigator", {
  value: { language: "zh-CN" },
  configurable: true,
  writable: true,
});

/* client.js 在 apply 时就把语言定下来了，所以每种语言都要重新 apply 一次 */
function boot(locale) {
  activeLocale = locale;
  mainComponent = null;
  mod.apply(ctx);
  if (!mainComponent) throw new Error("main 插槽没有注册组件");
}
boot("zh");

function render(node) {
  if (node === null || node === undefined || node === false || node === true) return null;
  if (typeof node === "string" || typeof node === "number") return { text: String(node) };
  if (Array.isArray(node)) return node.map(render).filter(Boolean);
  if (typeof node.type === "function") return render(node.type({ ...node.props, children: node.children }));
  if (node.type === FRAGMENT) return render(node.children);
  return { tag: node.type, className: node.props?.className, props: node.props, children: render(node.children) };
}

function walk(tree, visit) {
  if (!tree) return;
  if (Array.isArray(tree)) {
    for (const item of tree) walk(item, visit);
    return;
  }
  visit(tree);
  if (tree.children) walk(tree.children, visit);
}

function flatten(tree, out = []) {
  walk(tree, (node) => {
    if (node.text !== undefined) out.push(node.text);
  });
  return out;
}

function countClass(tree, className) {
  let count = 0;
  walk(tree, (node) => {
    if (typeof node.className === "string" && node.className.split(/\s+/).includes(className)) count += 1;
  });
  return count;
}

function hasAriaLabel(tree, label) {
  let found = false;
  walk(tree, (node) => {
    if (node?.props && node.props["aria-label"] === label) found = true;
  });
  return found;
}

function countRole(tree, role) {
  let count = 0;
  walk(tree, (node) => {
    if (node?.props && node.props.role === role) count += 1;
  });
  return count;
}

const tools = [
  {
    name: "tavily_search",
    description: "Search the web for ranked, cited results.",
    params: [
      { name: "query", type: "string", required: true, description: "Search query" },
      { name: "max_results", type: "integer", required: false, description: "" },
    ],
  },
  {
    name: "tavily_extract",
    description: "Extract readable content from URLs.",
    params: [],
  },
];

const skills = [
  { name: "banner-design", description: "Design banners for social media and ads.", scope: "user", modelInvocable: true, path: "C:/s/banner/SKILL.md" },
  { name: "brand", description: "Brand voice and identity.", scope: "user", modelInvocable: true, path: "C:/s/brand/SKILL.md" },
  { name: "slides", description: "Build HTML presentations.", scope: "user", modelInvocable: false, path: "C:/s/slides/SKILL.md" },
];

const servers = [
  { id: "mcp-tavily", serverName: "tavily", transport: "streamable-http", endpoint: "https://mcp.tavily.com/mcp/", status: "connected", toolCount: tools.length, tools, enabled: true, managed: true },
  { id: "mcp-github", serverName: "github", transport: "stdio", endpoint: "npx", cwd: "D:/work", status: "disabled", enabled: true, managed: true, toolCount: null, tools: [] },
];

store = { loading: false, error: "", servers, skills };

const skillEntries = {
  "C:/s/banner/SKILL.md": { text: "为社交媒体和广告设计横幅。", engine: "model", model: "agent2api/ds" },
  "C:/s/brand/SKILL.md": { text: "品牌语调与识别。", engine: "machine" },
  "C:/s/slides/SKILL.md": { text: null, engine: "none" },
};

const toolEntries = {
  "mcp-tavily:tavily_search": { text: "在网络上搜索并返回排序结果。", engine: "model", model: "agent2api/ds" },
  "mcp-tavily:tavily_search#query": { text: "搜索关键词", engine: "model", model: "agent2api/ds" },
};

const cases = [
  { label: "skill (无译文)", tab: "skill" },
  { label: "skill (模型/机翻/未译出)", tab: "skill", entries: skillEntries },
  /* 原文本来就是目标语言时 Host 会回 engine=source：卡片该照原样显示，不能装成译文 */
  {
    label: "skill (原文即目标语言)",
    tab: "skill",
    sourceOnly: true,
    entries: { "C:/s/banner/SKILL.md": { text: "Design banners for social media and ads.", engine: "source" } },
    rejectClass: "smTranslated",
  },
  { label: "skill (抽屉)", tab: "skill", entries: skillEntries, drawer: skills[0] },
  { label: "skill (抽屉：路径旁的文件管理器按钮)", tab: "skill", drawer: skills[0], expectAria: "在文件管理器中显示" },
  { label: "skill (抽屉：按钮文案随语言)", tab: "skill", locale: "en", drawer: skills[0], expectAria: "Show in file manager" },
  { label: "mcp (折叠)", tab: "mcp" },
  { label: "mcp (展开工具列表)", tab: "mcp", entries: toolEntries, expand: "mcp-tavily" },
  {
    label: "mcp (工具抽屉)",
    tab: "mcp",
    entries: toolEntries,
    openTool: { server: servers[0], tool: tools[0] },
  },
  /* 0.10.0 移除了调用统计页：只剩两个 tab，且统计文案不该再出现 */
  { label: "只剩两个 tab（统计页已移除）", tab: "mcp", tabs: 2, rejectTexts: ["调用统计", "近 14 天调用"] },
  /* 语言：client.js 在 apply 时就把语言定下来，所以中英文各 apply 一次 */
  { label: "zh 页面副标题", tab: "mcp", locale: "zh", expectText: "MCP 服务器与技能的统一入口" },
  { label: "en 页面副标题", tab: "mcp", locale: "en", tabs: 2, expectText: "One place for MCP servers and skills", rejectText: "统一入口" },
  { label: "zh 抽屉关闭标签", tab: "skill", locale: "zh", drawer: skills[0], expectAria: "关闭" },
  { label: "en 抽屉关闭标签", tab: "skill", locale: "en", drawer: skills[0], expectAria: "Close" },
  /* 版本自述：三种读数（磁盘 / 进程 / 页面）决定横幅 */
  {
    label: "版本横幅：进程落后于磁盘 → 提示重启",
    tab: "mcp",
    version: {
      ok: true,
      stale: true,
      unknown: false,
      running: { version: "0.7.0", startedAt: "2026-11-07T14:40:00.000Z", pid: 4321 },
      disk: { version: "0.8.0", mtime: "2026-11-07T14:55:00.000Z" },
      build: { version: "0.8.0", commit: "", built: "" },
      dir: "C:/pkg",
      profileDir: "C:/profile",
    },
    expectTexts: ["重启 DSH 后生效", "0.8.0", "0.7.0", "启动于"],
    expectClass: "smBannerWarn",
  },
  {
    label: "版本横幅：一致时不打扰",
    tab: "mcp",
    version: {
      ok: true,
      stale: false,
      unknown: false,
      running: { version: "0.8.0", startedAt: "2026-11-07T14:40:00.000Z", pid: 4321 },
      disk: { version: "0.8.0", mtime: "2026-11-07T14:55:00.000Z" },
      build: { version: "0.8.0", commit: "", built: "" },
    },
    rejectText: "重启 DSH",
    rejectClass: "smBannerWarn",
  },
  {
    label: "版本横幅：页面是旧构建 → 提示刷新",
    tab: "mcp",
    version: {
      ok: true,
      stale: false,
      unknown: false,
      running: { version: "0.8.0", startedAt: "2026-11-07T14:40:00.000Z", pid: 4321 },
      disk: { version: "0.8.0", mtime: "2026-11-07T14:55:00.000Z" },
      build: { version: "0.8.0", commit: "deadbee", built: "" },
    },
    expectText: "页面里是旧版界面",
    expectClass: "smBannerWarn",
  },
  {
    label: "版本横幅：Host 太旧（版本接口 404）→ 提示重启",
    tab: "mcp",
    version: { ok: false, missing: true },
    expectTexts: ["缺少版本接口", "重启一次 DSH"],
    expectClass: "smBannerWarn",
  },
  {
    label: "版本横幅：读不到磁盘版本 → 只说读不到",
    tab: "mcp",
    version: { ok: true, stale: false, unknown: true, running: { version: "0.8.0" }, disk: null, build: {} },
    expectText: "无法判断是否需要重启",
  },
];

let failures = 0;

for (const item of cases) {
  boot(item.locale ?? "zh");
  store = {
    ...store,
    version: item.version ?? null,
  };
  forceTab = item.tab;
  entriesOverride = item.entries ?? null;
  entriesUsed = false;
  activeSkillOverride = item.drawer ?? null;
  expandServerId = item.expand ?? null;
  openToolOverride = item.openTool ?? null;
  nullSeen = 0;
  try {
    const tree = render(mainComponent({}));
    const text = flatten(tree).join(" | ");
    const rowActions = countClass(tree, "smIconBtn");
    const toolRows = countClass(tree, "smToolRow");
    const parts = [`${flatten(tree).length} 文本节点`, `行内图标按钮=${rowActions}`];
    if (item.tab === "mcp") parts.push(`工具行=${toolRows}`);

    const zh = (item.locale ?? "zh").startsWith("zh");
    const checks = [];
    if (item.tab === "skill" && !item.drawer) {
      if (item.sourceOnly) {
        checks.push(["原文照原样显示", text.includes("Design banners for social media")]);
      } else if (item.entries) {
        checks.push(["中文译文", text.includes("为社交媒体和广告设计横幅")]);
        checks.push(["模型译标签", text.includes(zh ? "模型译" : "Model")]);
      } else {
        checks.push(["回退原文", text.includes("Design banners for social media")]);
      }
      checks.push(["原文切换", text.includes(zh ? "原文" : "Original")]);
    }
    if (item.drawer) {
      checks.push(["抽屉摘要", text.includes(zh ? "摘要" : "Summary")]);
      checks.push(["抽屉重翻", text.includes(zh ? "重新翻译" : "Translate again")]);
    }
    if (item.expand) {
      checks.push(["工具名", text.includes("tavily_search")]);
      checks.push(["工具摘要", text.includes("在网络上搜索并返回排序结果")]);
      checks.push(["机翻兜底占位", text.includes("tavily_extract")]);
    }
    if (item.openTool) {
      checks.push(["参数名", text.includes("query")]);
      checks.push(["必填标记", text.includes(zh ? "必填" : "Required")]);
      checks.push(["参数区标题", text.includes(zh ? "参数" : "Parameters")]);
      checks.push(["参数说明已翻译", text.includes("搜索关键词")]);
    }
    if (item.expectTexts) for (const value of item.expectTexts) checks.push([`含「${value}」`, text.includes(value)]);
    if (item.expectText) checks.push([`含「${item.expectText}」`, text.includes(item.expectText)]);
    if (item.rejectText) checks.push([`不含「${item.rejectText}」`, !text.includes(item.rejectText)]);
    if (item.expectAria) checks.push([`aria=${item.expectAria}`, hasAriaLabel(tree, item.expectAria)]);
    if (item.rejectTexts) for (const value of item.rejectTexts) checks.push([`不含「${value}」`, !text.includes(value)]);
    if (item.tabs) checks.push([`tab 数=${item.tabs}`, countRole(tree, "tab") === item.tabs]);
    for (const name of [].concat(item.expectClass ?? [])) checks.push([`含节点 ${name}`, countClass(tree, name) > 0]);
    for (const name of [].concat(item.rejectClass ?? [])) checks.push([`不含节点 ${name}`, countClass(tree, name) === 0]);
    const failed = checks.filter(([, ok]) => !ok);
    failures += failed.length;
    console.log(
      `${failed.length ? "✘" : "✔"} ${item.label}: ${parts.join(" · ")}${checks.length ? " | " + checks.map(([k, ok]) => `${k}=${ok}`).join(" ") : ""}`
    );
  } catch (error) {
    failures += 1;
    console.log(`✘ ${item.label}: ${error.message}`);
    console.log(error.stack.split("\n").slice(0, 6).join("\n"));
  }
}

console.log(failures ? `\n${failures} 项断言失败` : "\n全部通过");
process.exitCode = failures ? 1 : 0;
