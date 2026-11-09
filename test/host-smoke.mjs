/**
 * Host 半区冒烟：用最小 ctx 替身真跑 apply()，再直接调用路由处理函数。
 *
 * 覆盖这几件事，全部在「重启 DSH」之前就能知道答案：
 *  1. apply() 不抛错、路由注册齐全且无重复、各路由能正常应答；
 *  2. 进程启动后磁盘被换成新版 → /version 必须报 stale（这正是历史故障的形状）；
 *  3. package.json 读不到 → /version 报 unknown，而不是瞎猜；
 *  4. /open 只接受扫描到的技能名，不接任意路径；
 *  5. 翻译跟随界面语言：原文已经是目标语言就跳过（不花 token），
 *     缓存按目标语言分槽，v2 时代的译文升级后不丢。
 *
 * 用 node test/host-smoke.mjs 运行。
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

const checks = [];
const check = (label, ok, detail = "") => checks.push([label, ok, detail]);
const cleanup = [];
const temp = async (prefix) => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
};

/** 起一个半区：dir 是被 import 的插件目录，profile 是它以为的 profile 目录 */
async function boot(dir, profile, options = {}) {
  const routes = new Map();
  const listeners = new Map();
  const duplicates = [];
  const ctx = {
    baseUrl: pathToFileURL(profile + path.sep).href,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get: (name) => (options.get ? options.get(name) : null),
    on: (event, handler) => {
      listeners.set(event, handler);
      return () => {};
    },
    effect: (factory) => (typeof factory === "function" ? factory() : () => {}),
    inject: (_deps, factory) => factory(),
    loader: { entries: () => [] },
    tools: { register: () => () => {} },
    connection: {
      fetch: {
        register: (descriptor) => {
          if (routes.has(descriptor.path)) duplicates.push(descriptor.path);
          routes.set(descriptor.path, descriptor);
          return () => {};
        },
      },
    },
  };
  const mod = await import(pathToFileURL(path.join(dir, "index.js")).href + `?v=${Math.random()}`);
  mod.apply(ctx, {});
  const call = async (route, init) => {
    const response = await routes.get(route).fetch(new Request(`http://127.0.0.1${route}`, init));
    return response.json();
  };
  return { routes, listeners, duplicates, call };
}

/* ---------------------------------------------------------- 1. 就地跑一遍 */

{
  const profile = await temp("sm-profile-");
  let booted;
  try {
    booted = await boot(ROOT, profile);
    check("apply() 未抛错", true);
  } catch (error) {
    check("apply() 未抛错", false, error.message);
  }

  if (booted) {
    const { routes, listeners, duplicates, call } = booted;
    check("不再监听 tools/result（统计已随 0.10.0 移除）", !listeners.has("tools/result"));
    check("没有重复注册的路由", duplicates.length === 0, duplicates.join(","));

    const expected = [
      "/api/service-manager/mcp",
      "/api/service-manager/mcp/save",
      "/api/service-manager/mcp/delete",
      "/api/service-manager/mcp/toggle",
      "/api/service-manager/skills",
      "/api/service-manager/models",
      "/api/service-manager/skills/translate",
      "/api/service-manager/skills/content",
      "/api/service-manager/skills/delete",
      "/api/service-manager/open",
      "/api/service-manager/paths",
      "/api/service-manager/version",
      "/api/service-manager/context-cost",
      "/api/service-manager/context-usage",
    ];
    const missing = expected.filter((route) => !routes.has(route));
    check(`${expected.length} 条路由全部注册`, missing.length === 0, missing.join(","));
    check("每条路由都有 fetch 与 methods", [...routes.values()].every((d) => typeof d.fetch === "function" && Array.isArray(d.methods) && d.methods.length > 0));

    const version = await call("/api/service-manager/version");
    check("/version ok", version.ok === true);
    check("/version 进程版本 = package.json", version.running?.version === pkg.version, version.running?.version);
    check("/version 磁盘版本 = package.json", version.disk?.version === pkg.version, version.disk?.version);
    check("/version 未变更时不报 stale", version.stale === false);
    check("/version 不报 unknown", version.unknown === false);
    check("/version 启动时间可解析", !Number.isNaN(Date.parse(version.running?.startedAt ?? "")));
    check("/version build.version = package.json", version.build?.version === pkg.version);
    check("/version 报出安装目录", typeof version.dir === "string" && version.dir.length > 0, version.dir);

    const paths = await call("/api/service-manager/paths");
    check("/paths 指向临时 profile", path.resolve(paths.profileDir) === path.resolve(profile), paths.profileDir);
    check("/paths 给出配置文件绝对路径", path.isAbsolute(paths.file ?? ""), paths.file);

    const mcp = await call("/api/service-manager/mcp");
    check("/mcp 返回空列表", Array.isArray(mcp.servers) && mcp.servers.length === 0);

    /* 没装 dsh-context：这是正常状态，不是错误——只有 available:false，没有 4xx */
    const noContext = await call("/api/service-manager/context-cost", { method: "POST", body: "{}" });
    check("没有 dsh-context 时 /context-cost 不报错", noContext.ok === true, JSON.stringify(noContext));
    check("没有 dsh-context 时 /context-cost 说不可用", noContext.available === false, JSON.stringify(noContext));

    /* 统计被移除后不该再写 stats.json；老文件留在磁盘上由用户自己处理，Host 不碰它 */
    const statsFileWritten = await readFile(path.join(profile, ".dsh-service-manager", "stats.json"), "utf8").then(
      () => true,
      () => false
    );
    check("不再生成 stats.json", statsFileWritten === false);
  }
}

/* ------------------------------------- 2. 启动后磁盘被换成新版 → 必须报 stale */

{
  const dir = await temp("sm-plugin-");
  await copyFile(path.join(ROOT, "index.js"), path.join(dir, "index.js"));
  await copyFile(path.join(ROOT, "package.json"), path.join(dir, "package.json"));
  const profile = await temp("sm-profile-");
  const { call } = await boot(dir, profile);

  /* 模拟 pnpm 在进程启动之后把新版本写到磁盘 */
  const bumped = { ...pkg, version: "9.9.9" };
  await writeFile(path.join(dir, "package.json"), JSON.stringify(bumped, null, 2), "utf8");

  const version = await call("/api/service-manager/version");
  check("换版后 stale = true", version.stale === true);
  check("进程版本仍是启动时的旧版", version.running?.version === pkg.version, version.running?.version);
  check("磁盘版本是新版", version.disk?.version === "9.9.9", version.disk?.version);
}

/* ------------------------------- 3. package.json 读不到 → 报 unknown，不乱下结论 */

{
  const dir = await temp("sm-plugin-");
  await copyFile(path.join(ROOT, "index.js"), path.join(dir, "index.js"));
  await copyFile(path.join(ROOT, "package.json"), path.join(dir, "package.json"));
  const profile = await temp("sm-profile-");
  const { call } = await boot(dir, profile);

  await rm(path.join(dir, "package.json"), { force: true });

  const version = await call("/api/service-manager/version");
  check("删掉 package.json 后 unknown = true", version.unknown === true);
  check("此时不报 stale（没有依据就不下结论）", version.stale === false);
  check("仍然报出进程版本", version.running?.version === pkg.version, version.running?.version);
  check("磁盘读数置空", version.disk === null);
}

/* ------------------------------ 6. /open：只接受「扫描到的技能名」，不接任意路径 */

{
  const profile = await temp("sm-profile-");
  const previous = process.env.DSH_SERVICE_MANAGER_NO_OPEN;
  /* 这一块会真的走 openWithShell：开关必须覆盖到所有调用，最后在 finally 里还原。
     历史 bug：曾经在 boot() 之后立刻还原，导致每次跑测试都真的弹出资源管理器。 */
  process.env.DSH_SERVICE_MANAGER_NO_OPEN = "1";
  try {
    const { call } = await boot(ROOT, profile);

    const post = (body) =>
      call("/api/service-manager/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const unknown = await post({ kind: "skill", name: "../../windows/system32" });
    check("未知技能名被拒绝（不打开任意路径）", unknown.ok === false, unknown.error);
    check("拒绝理由是找不到技能", String(unknown.error ?? "").includes("找不到技能"), String(unknown.error));

    const empty = await post({ kind: "skill" });
    check("缺 name 也被拒绝", empty.ok === false);

    /* 真实技能：走 Host 自己的扫描结果，客户端从不传路径 */
    const list = await call("/api/service-manager/skills");
    const first = Array.isArray(list.skills) ? list.skills[0] : null;
    if (first) {
      const opened = await post({ kind: "skill", name: first.name });
      check("按技能名能定位到文件", opened.ok === true && opened.target === first.path, opened.error);
      check("返回的路径就是扫描出来的那个", opened.target === first.path);
      check("测试钩子生效：没有真的打开资源管理器", opened.skipped === true, JSON.stringify(opened));
    } else {
      check("（本机没有技能，跳过定位成功用例）", true);
    }

    /* 打开配置文件那条老路子不能被改坏 */
    await writeFile(path.join(profile, "mcp-servers.yml"), "[]", "utf8");
    const file = await post({ kind: "file" });
    check("打开配置文件仍然可用", file.ok === true && file.kind === "file", file.error);
  } finally {
    if (previous === undefined) delete process.env.DSH_SERVICE_MANAGER_NO_OPEN;
    else process.env.DSH_SERVICE_MANAGER_NO_OPEN = previous;
  }
}

/* ------------- 7. 翻译：目标语言跟随界面语言、同语言跳过、缓存按语言分槽 ------------- */

{
  const profile = await temp("sm-profile-");
  const stateDir = path.join(profile, ".dsh-service-manager");
  const key = (text) => createHash("sha1").update(String(text)).digest("hex").slice(0, 24);

  /* 先放一份 v2 时代的缓存：验证升级到 v3 之后中文译文不丢（升级不该让用户重翻一遍） */
  const legacyText = "Design banners for social media and ads.";
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, "translations.json"),
    JSON.stringify({
      version: 2,
      entries: {
        [key(legacyText)]: { zh: "旧版留下的译文", engine: "machine", model: null, at: "2025-01-01T00:00:00.000Z" },
      },
    }),
    "utf8"
  );

  /* 假模型：只认「目标语言写在提示词里」这一件事，按提示词回中文或英文译文 */
  const llm = {
    listProviders: () => [],
    listModels: async () => [],
    resolveModelInfo: async () => ({}),
    stream: (options) => {
      const prompt = options?.messages?.[0]?.content?.[0]?.text ?? "";
      const text = prompt.includes("简体中文") ? "简体中文译文" : "English translation";
      return (async function* () {
        yield { type: "text-delta", text: `<<<1>>>\n${text}` };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };

  const { call } = await boot(ROOT, profile, { get: (name) => (name === "llm" ? llm : null) });
  const translate = (body) =>
    call("/api/service-manager/skills/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: { provider: "fake", model: "fake-1" }, ...body }),
    });

  /* 页面没带 target（老页面 / 直接调接口）：默认中文 */
  const fallbackLanguage = await translate({ items: [{ id: "h", text: "中文写的技能描述。" }], target: undefined });
  check("不带 target 时退回中文", fallbackLanguage.language === "zh", String(fallbackLanguage.language));

  const skipped = await translate({ items: [{ id: "a", text: "中文写的技能描述。" }], target: "zh" });
  check("中文界面 + 中文原文：直接回原文", skipped.results.a?.engine === "source", skipped.results.a?.engine);
  check("中文界面 + 中文原文：内容就是原文", skipped.results.a?.text === "中文写的技能描述。", skipped.results.a?.text);

  const english = await translate({ items: [{ id: "b", text: "Design banners for social media and ads." }], target: "en" });
  check("英文界面 + 英文原文：也跳过", english.results.b?.engine === "source", english.results.b?.engine);

  const toChinese = await translate({
    items: [{ id: "c", text: "Design banners for social media, ads and hero images." }],
    target: "zh",
  });
  check("中文界面 + 英文原文：翻成中文", toChinese.results.c?.text === "简体中文译文", toChinese.results.c?.text);
  check("译文来源记成 model", toChinese.results.c?.engine === "model", toChinese.results.c?.engine);

  const toEnglish = await translate({ items: [{ id: "d", text: "把本机目录暴露给模型。" }], target: "en" });
  check("英文界面 + 中文原文：翻成英文", toEnglish.results.d?.text === "English translation", toEnglish.results.d?.text);

  /* 同一段认不出语言的原文、两种目标语言：缓存必须分槽，不能互相污染 */
  const undetermined = "Tavily";
  const zhFirst = await translate({ items: [{ id: "e", text: undetermined }], target: "zh" });
  const enFirst = await translate({ items: [{ id: "e", text: undetermined }], target: "en" });
  check("同一原文的中文槽", zhFirst.results.e?.text === "简体中文译文", zhFirst.results.e?.text);
  check("同一原文的英文槽", enFirst.results.e?.text === "English translation", enFirst.results.e?.text);

  const zhCached = await translate({ items: [{ id: "e", text: undetermined }], target: "zh", cachedOnly: true });
  check("第二次中文命中缓存（不再请求模型）", zhCached.results.e?.cached === true && zhCached.results.e?.text === "简体中文译文", zhCached.results.e?.text);

  const legacy = await translate({ items: [{ id: "f", text: legacyText }], target: "zh", cachedOnly: true });
  check("v2 缓存升级后中文译文还在", legacy.results.f?.text === "旧版留下的译文", legacy.results.f?.text);

  const store = JSON.parse(await readFile(path.join(stateDir, "translations.json"), "utf8"));
  check("缓存文件已升到 v3", store.version === 3, String(store.version));
  check("v3 按目标语言分槽", Boolean(store.entries[key(undetermined)]?.zh?.text && store.entries[key(undetermined)]?.en?.text));

  /* 没有可用模型、也关掉机翻：必须显式标成 none，界面才能说「未译出」 */
  const failed = await translate({
    items: [{ id: "g", text: "这条中文描述从来没有被翻译过。" }],
    target: "en",
    model: null,
    machine: false,
  });
  check("模型不可用时机翻可关闭", failed.ok === true);
  check("两轮都没译出时标成 none", failed.results.g?.engine === "none", failed.results.g?.engine);
  check("none 条目的译文为空", failed.results.g?.text === null, String(failed.results.g?.text));

  /* 认不出语言就送翻译：法语不能被当成英文（那样英文界面会整屏留着法语原文） */
  const french = await translate({
    items: [{ id: "j", text: "Créez des règles Codex persistantes pour l'IA." }],
    target: "en",
    model: null,
    machine: false,
  });
  check("法语不会被误判成英文", french.results.j?.engine === "none", french.results.j?.engine);

  /* 页面带了 target 就记下来：探针与「没带 target 的老页面」都靠它 */
  const remembered = await translate({ items: [{ id: "i", text: "中文写的技能描述。" }], target: undefined });
  check("不带 target 时沿用上次保存的语言", remembered.language === "en", String(remembered.language));
  const settings = JSON.parse(await readFile(path.join(stateDir, "settings.json"), "utf8"));
  check("界面语言写进了 settings.json", settings.translateLanguage === "en", String(settings.translateLanguage));
}

/* ---------------------------------------------------------- 5. 上下文成本（可选联动） */

{
  const profile = await temp("sm-profile-");
  /* 假投影：形状照 dsh-context 的 contextHeaders wire view 抄 */
  const tools = [
    { name: "mcp__tavily__tavily_search", tokens: 1209 },
    { name: "mcp__tavily__tavily_extract", tokens: 367 },
    { name: "mcp__github__create_issue", tokens: 500 },
    { name: "pwsh", tokens: 400 },
  ];
  const session = { id: "s1" };
  const { call } = await boot(ROOT, profile, {
    get: (name) => {
      if (name === "sessions") return { list: () => [session], get: () => session };
      if (name === "sessionProjections") {
        return { snapshot: () => ({ values: { contextHeaders: { headers: [{ seq: 7, time: 1, tools }] } } }) };
      }
      return null;
    },
  });

  const cost = await call("/api/service-manager/context-cost", { method: "POST", body: "{}" });
  check("/context-cost 读到投影后可用", cost.available === true, JSON.stringify(cost));
  check("/context-cost 只统计 mcp__ 工具（两台服务器）", cost.servers?.length === 2, JSON.stringify(cost.servers));
  check(
    "/context-cost 按服务器聚合 tavily",
    cost.servers?.find((row) => row.serverName === "tavily")?.tokens === 1576,
    JSON.stringify(cost.servers)
  );
  check("/context-cost 合计含全部工具定义", cost.totalToolTokens === 2476, String(cost.totalToolTokens));
  check(
    "/context-cost 占比按合计算",
    Math.abs((cost.servers?.find((row) => row.serverName === "tavily")?.share ?? 0) - 1576 / 2476) < 1e-9,
    String(cost.servers?.find((row) => row.serverName === "tavily")?.share)
  );
  check("/context-cost 带出请求头序号", cost.headerSeq === 7, String(cost.headerSeq));
}

/* 没有活会话时读检查点：cachedSnapshot 收的是「会话头」，不是 id，也不是列表项本身 */
{
  const profile = await temp("sm-profile-");
  const tools = [{ name: "mcp__tavily__tavily_search", tokens: 1209 }];
  let seenHeader = null;
  const { call } = await boot(ROOT, profile, {
    get: (name) => {
      if (name === "sessions") return { list: () => [] };
      if (name === "sessionQuery") return { listSessions: () => [{ header: { id: "s9", createdAt: 1 } }] };
      if (name === "sessionProjectionCache") {
        return {
          cachedSnapshot: (header) => {
            seenHeader = header;
            return { values: { contextHeaders: { headers: [{ seq: 3, time: 2, tools }] } } };
          },
        };
      }
      if (name === "sessionProjections") return { snapshot: () => undefined };
      return null;
    },
  });
  const cost = await call("/api/service-manager/context-cost", { method: "POST", body: "{}" });
  check("/context-cost 冷会话走缓存", cost.available === true, JSON.stringify(cost));
  check("/context-cost 缓存读到的是会话头（带 id）", seenHeader?.id === "s9", JSON.stringify(seenHeader));
}

/* 技能使用频次：同样来自 dsh-context 的投影（contextActivity），宿主侧聚合 */
{
  const profile = await temp("sm-profile-");
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const session = { id: "s2" };
  const { call } = await boot(ROOT, profile, {
    get: (name) => {
      if (name === "sessions") return { list: () => [session] };
      if (name === "sessionProjections") {
        return {
          snapshot: (_session, keys) =>
            keys.has("contextActivity")
              ? {
                  values: {
                    contextActivity: {
                      days: {
                        [today]: {
                          skills: {
                            "banner-design": { n: 2, last: Date.now() - 3600_000 },
                            brand: { n: 1, last: Date.now() - 7200_000 },
                          },
                        },
                        /* 30 天前的老记录不该算进「近 7 天」 */
                        [old]: { skills: { "banner-design": { n: 9, last: Date.now() - 30 * 86400_000 } } },
                      },
                    },
                  },
                }
              : undefined,
        };
      }
      return null;
    },
  });
  const usage = await call("/api/service-manager/context-usage", { method: "POST", body: "{}" });
  check("/context-usage 可用", usage.available === true, JSON.stringify(usage));
  check(
    "/context-usage 只统计近 7 天",
    usage.skills?.find((row) => row.name === "banner-design")?.n === 2,
    JSON.stringify(usage.skills)
  );
  check("/context-usage 带出最近时间", (usage.skills?.find((row) => row.name === "banner-design")?.last ?? 0) > 0);
}

for (const dir of cleanup) await rm(dir, { recursive: true, force: true });

let failures = 0;
for (const [label, ok, detail] of checks) {
  if (!ok) failures += 1;
  if (!ok || /apply|stale|unknown|路由|stats|翻译|缓存|语言|上下文|context-cost|context-usage/.test(label)) {
    console.log(`${ok ? "✔" : "✘"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  }
}
console.log(`\n断言 ${checks.length} 项`);
console.log(failures ? `${failures} 项断言失败` : "全部通过");
process.exit(failures ? 1 : 0);
