/**
 * 预览外壳：把真实的 client.js 挂到真实 React 上，只把 /api/* 换成示例数据。
 * 用于给 README 截图，不参与插件运行。
 */
(function () {
  const F = window.__FIXTURES;
  const json = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  /* ---------- 示例数据 ---------- */
  const zhByText = new Map();
  for (const skill of F.skills) {
    const tr = F.translations[skill.name];
    if (tr) zhByText.set(skill.description, tr.zh);
  }
  for (const tool of F.tools) {
    const zh = F.toolChinese[tool.name];
    if (zh) zhByText.set(tool.description, zh);
    for (const param of tool.params) {
      const key = F.toolChinese[`${tool.name}#${param.name}`];
      if (key && param.description) zhByText.set(param.description, key);
    }
  }

  const servers = [
    {
      id: "mcp-tavily",
      serverName: "tavily",
      transport: "streamable-http",
      endpoint: "https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-••••••••••••",
      enabled: true,
      status: "connected",
      toolCount: F.tools.length,
      tools: F.tools,
      managed: true,
      note: "联网搜索",
    },
    {
      id: "mcp-github",
      serverName: "github",
      transport: "stdio",
      endpoint: "npx",
      cwd: "D:\\work\\mcp",
      enabled: false,
      status: "disabled",
      toolCount: null,
      tools: [],
      managed: true,
      note: "",
    },
  ];

  const skills = F.skills;

  const providers = [
    {
      id: "agent2api",
      name: "本地",
      models: [
        { id: "ds", name: "deepseek-V4.1-flash" },
        { id: "glm-5.3-flash", name: "GLM-5.3-Flash" },
      ],
    },
    {
      id: "deepseek-official",
      name: "DeepSeek",
      models: [
        { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash" },
        { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
      ],
    },
  ];

  const skillBody = [
    "# banner-design",
    "",
    "Design banners for social media, ads, website heroes, creative assets, and print.",
    "",
    "## When to use",
    "",
    "- A campaign needs a set of sizes from one art direction",
    "- You need a hero image with headline-safe space",
    "",
    "## Process",
    "",
    "1. Pick one art direction from the brief",
    "2. Compose at the largest size first",
    "3. Crop down; never upscale",
    "",
    "```",
    "banner: 1200x630 hero",
    "safe-area: 64px",
    "```",
  ].join("\n");

  const legacy = {};

  /* 版本自述：默认「磁盘与进程一致」，可用 ?version=stale|page|unknown 看三种状态 */
  const scenario = new URLSearchParams(location.search).get("version") ?? "ok";
  const version = {
    ok: true,
    stale: scenario === "stale",
    unknown: scenario === "unknown",
    running: {
      version: scenario === "stale" ? "0.9.1" : "0.13.0",
      startedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
      pid: 4321,
      node: "24.19.0",
    },
    disk: scenario === "unknown" ? null : { version: "0.13.0", mtime: new Date().toISOString() },
    /* page 场景：故意给一个和 client.js 构建戳不同的 commit */
    build: { version: "0.13.0", commit: scenario === "page" ? "deadbee" : "", built: "" },
    dir: "C:/profile/node_modules/dsh-service-manager",
    profileDir: "C:/profile",
  };

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    const clean = url.split("?")[0];
    const path = clean.slice(clean.indexOf("/api/"));
    const method = String(init?.method ?? "GET").toUpperCase();

    if (path === "/api/service-manager/mcp" && method === "GET") {
      return json({ ok: true, servers, refresh: { running: false } });
    }
    if (path === "/api/service-manager/models" && method === "GET") {
      return json({ ok: true, providers, selected: { provider: "agent2api", model: "ds" } });
    }
    if (path === "/api/service-manager/skills" && method === "GET") {
      return json({ ok: true, skills });
    }
    /* 可选联动：预览里假装 dsh-context 装着，好让新列与新行有东西可看 */
    if (path === "/api/service-manager/context-cost" && method === "POST") {
      return json({
        ok: true,
        available: true,
        headerSeq: 812,
        toolCount: 41,
        totalToolTokens: 19717,
        servers: [{ serverName: "tavily", tools: 5, tokens: 2801, share: 2801 / 19717 }],
      });
    }
    if (path === "/api/dsh-context/version" && method === "POST") {
      return json({ ok: true, value: { ready: true, failed: false, checkedAt: Date.now(), current: "0.82.1" } });
    }
    if (path === "/api/dsh-context/snapshot" && method === "POST") {
      const day = new Date().toISOString().slice(0, 10);
      return json({
        ok: true,
        value: {
          "session-demo": {
            contextActivity: {
              days: {
                [day]: {
                  tokens: 12345,
                  requests: 4,
                  skills: {
                    "banner-design": { n: 4, last: Date.now() - 2 * 3600 * 1000 },
                    brand: { n: 1, last: Date.now() - 26 * 3600 * 1000 },
                  },
                },
              },
            },
          },
        },
      });
    }
    if (path === "/api/service-manager/version" && method === "GET") {
      /* missing 场景：模拟「正在跑的 Host 还没有这条路由」，返回 404 */
      if (scenario === "missing") return new Response("not found", { status: 404 });
      /* page 场景：build.commit 与 client.js 里的构建戳不同，触发「页面是旧构建」 */
      return json(version);
    }
    if (path === "/api/service-manager/skills/content") {
      return json({ ok: true, meta: { name: "banner-design" }, body: skillBody });
    }
    if (path === "/api/service-manager/skills/translate") {
      const body = JSON.parse(init.body);
      /* 预览里只准备了中文译文：英文界面下英文原文算「已经是目标语言」，中文原文则没有译文 */
      const target = body.target === "en" ? "en" : "zh";
      const results = {};
      let engine = "cache";
      for (const item of body.items) {
        const zh = zhByText.get(item.text);
        const chinese = /[\u4e00-\u9fff]/.test(item.text ?? "");
        if (target === "zh" && zh) {
          results[item.id] = { text: zh, engine: "model", model: "agent2api/ds", cached: true };
        } else if (target === "zh" && chinese) {
          results[item.id] = { text: item.text, engine: "source", cached: true };
        } else if (target === "en" && !chinese) {
          results[item.id] = { text: item.text, engine: "source", cached: true };
        } else {
          results[item.id] = { text: null, engine: "none", cached: false };
          engine = "model";
        }
        void legacy;
      }
      return json({
        ok: true,
        engine,
        language: target,
        target: { provider: "agent2api", model: "ds" },
        results,
        modelError: null,
      });
    }
    return json({ ok: true });
  };

  /* ---------- 启动 ---------- */
  const definition = window.__PLUGIN;
  const mod = definition.factory((id) => {
    if (id === "react") return window.React;
    /* tooltip 走 react-dom 的 createPortal，和宿主静态模块表给的一致 */
    if (id === "react-dom") return window.ReactDOM;
    throw new Error(`unexpected require(${id})`);
  });

  let Main = null;
  const ctx = {
    slots: {
      inject: (_name, factory) => factory(),
      register: (descriptor, component) => {
        if (descriptor?.name === "main") Main = component;
        return () => {};
      },
      /* 假装 dsh-context 的洞察页面板注册着：预览里能看到深链按钮 */
      entries: (name) => (name === "main" ? [{ options: { key: "dsh-context" } }] : []),
    },
    /* 宿主 locale 服务的真实形状是 getLocale().active；'current' 那个字段不存在 */
    get: (name) =>
      name === "locale"
        ? {
            getLocale: () => ({ active: "zh" }),
            register() {},
            bind() {},
            subscribe: () => () => {},
          }
        : undefined,
  };
  mod.apply(ctx);

  window.ReactDOM.createRoot(document.getElementById("root")).render(window.React.createElement(Main));

  /* ---------- 给截图脚本用的操作入口 ---------- */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const byText = (selector, text) =>
    [...document.querySelectorAll(selector)].find((node) => node.textContent.trim().includes(text));

  window.__ui = {
    wait,
    async tab(index) {
      document.querySelectorAll(".smTab")[index].click();
      await wait(120);
    },
    async expand(name) {
      const row = byText(".smNameText", name);
      if (row) row.closest(".smRow").click();
      await wait(260);
    },
    async openTool(name) {
      const row = byText(".smToolRowName", name);
      if (row) row.closest(".smToolRow").click();
      await wait(420);
    },
    async closeDrawer() {
      const button = document.querySelector(".smDrawer .smIconBtn");
      if (button) button.click();
      await wait(320);
    },
    async openSkill(name) {
      const card = [...document.querySelectorAll(".smCard")].find((node) =>
        node.querySelector(".smCardName")?.textContent.trim() === name
      );
      if (card) card.click();
      await wait(600);
    },
    ready() {
      return Boolean(document.querySelector(".smPage"));
    },
  };
})();
