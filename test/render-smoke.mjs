/**
 * 离线渲染校验：用最小 React 替身在 Node 里跑一遍 Client，确认三页 + 抽屉都能构建出树。
 * 只做结构校验，不涉及样式与交互。用 node test/render-smoke.mjs 运行。
 */
import { readFile } from "node:fs/promises";

const source = await readFile("D:/Soft/AI-source/ALL-test/dsh-service-manager/client.js", "utf8");

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
const ctx = {
  slots: {
    inject: (name, factory) => factory(),
    register: (descriptor, component) => {
      if (descriptor?.name === "main") mainComponent = component;
      return noop;
    },
  },
  get: () => undefined,
};

mod.apply(ctx);
if (!mainComponent) throw new Error("main 插槽没有注册组件");

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

store = { loading: false, error: "", servers, skills, stats: [], statsSince: "2026-11-06" };

const skillEntries = {
  "C:/s/banner/SKILL.md": { zh: "为社交媒体和广告设计横幅。", engine: "model", model: "agent2api/ds" },
  "C:/s/brand/SKILL.md": { zh: "品牌语调与识别。", engine: "machine" },
  "C:/s/slides/SKILL.md": { zh: null, engine: "none" },
};

const toolEntries = {
  "mcp-tavily:tavily_search": { zh: "在网络上搜索并返回排序结果。", engine: "model", model: "agent2api/ds" },
  "mcp-tavily:tavily_search#query": { zh: "搜索关键词", engine: "model", model: "agent2api/ds" },
};

const cases = [
  { label: "skill (无译文)", tab: "skill" },
  { label: "skill (模型/机翻/未译出)", tab: "skill", entries: skillEntries },
  { label: "skill (抽屉)", tab: "skill", entries: skillEntries, drawer: skills[0] },
  { label: "mcp (折叠)", tab: "mcp" },
  { label: "mcp (展开工具列表)", tab: "mcp", entries: toolEntries, expand: "mcp-tavily" },
  {
    label: "mcp (工具抽屉)",
    tab: "mcp",
    entries: toolEntries,
    openTool: { server: servers[0], tool: tools[0] },
  },
  { label: "stats", tab: "stats" },
];

let failures = 0;
for (const item of cases) {
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

    const checks = [];
    if (item.tab === "skill" && !item.drawer) {
      if (item.entries) {
        checks.push(["中文译文", text.includes("为社交媒体和广告设计横幅")]);
        checks.push(["模型译标签", text.includes("模型译")]);
      } else {
        checks.push(["回退原文", text.includes("Design banners for social media")]);
      }
      checks.push(["原文切换", text.includes("原文")]);
    }
    if (item.drawer) {
      checks.push(["抽屉摘要", text.includes("摘要")]);
      checks.push(["抽屉重翻", text.includes("重新翻译")]);
    }
    if (item.expand) {
      checks.push(["工具名", text.includes("tavily_search")]);
      checks.push(["工具摘要", text.includes("在网络上搜索并返回排序结果")]);
      checks.push(["机翻兜底占位", text.includes("tavily_extract")]);
    }
    if (item.openTool) {
      checks.push(["参数名", text.includes("query")]);
      checks.push(["必填标记", text.includes("必填")]);
      checks.push(["参数区标题", text.includes("参数")]);
      checks.push(["参数说明已翻译", text.includes("搜索关键词")]);
    }
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
