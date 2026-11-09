/**
 * Host 半区冒烟：用最小 ctx 替身真跑 apply()，再直接调用路由处理函数。
 *
 * 覆盖三件事，全部在「重启 DSH」之前就能知道答案：
 *  1. apply() 不抛错、路由注册齐全且无重复、各路由能正常应答；
 *  2. 进程启动后磁盘被换成新版 → /version 必须报 stale（这正是历史故障的形状）；
 *  3. package.json 读不到 → /version 报 unknown，而不是瞎猜。
 *
 * 用 node test/host-smoke.mjs 运行。
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
async function boot(dir, profile) {
  const routes = new Map();
  const listeners = new Map();
  const duplicates = [];
  const ctx = {
    baseUrl: pathToFileURL(profile + path.sep).href,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    get: () => null,
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
    check("注入了 tools/result 监听", listeners.has("tools/result"));
    check("没有重复注册的路由", duplicates.length === 0, duplicates.join(","));

    const expected = [
      "/api/service-manager/mcp",
      "/api/service-manager/mcp/save",
      "/api/service-manager/mcp/delete",
      "/api/service-manager/mcp/toggle",
      "/api/service-manager/skills",
      "/api/service-manager/stats",
      "/api/service-manager/models",
      "/api/service-manager/skills/translate",
      "/api/service-manager/skills/content",
      "/api/service-manager/skills/delete",
      "/api/service-manager/open",
      "/api/service-manager/paths",
      "/api/service-manager/version",
      "/api/service-manager/stats/hide",
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

    const stats = await call("/api/service-manager/stats");
    check("/stats 返回 14 天窗口", Array.isArray(stats.days) && stats.days.length === 14, String(stats.days?.length));
    check("/stats 有 rows 数组", Array.isArray(stats.rows));
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

/* ------------------------- 4. 隐藏 / 恢复：只改展示、不动数据、不被防抖保存覆盖 */

{
  const profile = await temp("sm-profile-");
  const { listeners, call } = await boot(ROOT, profile);

  const emit = listeners.get("tools/result");
  check("tools/result 监听可触发", typeof emit === "function");
  emit?.({ name: "mcp__box__run" }, { isError: true, error: { message: "Request timed out" } });
  emit?.({ name: "mcp__box__run" }, { isError: false });

  const before = await call("/api/service-manager/stats");
  check("计数后 rows 含 mcp:box", before.rows.some((row) => row.key === "mcp:box"));

  const post = (body) =>
    call("/api/service-manager/stats/hide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const hide = await post({ key: "mcp:box" });
  check("隐藏返回 ok", hide.ok === true && hide.hidden === true);
  const afterHide = await call("/api/service-manager/stats");
  check("隐藏后 rows 不再含 mcp:box", !afterHide.rows.some((row) => row.key === "mcp:box"));
  check("隐藏后 hiddenRows 含 mcp:box", afterHide.hiddenRows.some((row) => row.key === "mcp:box"));

  /* 关键回归：隐藏之后再发生一次调用会重新排一次防抖保存，隐藏状态不能被覆盖 */
  emit?.({ name: "mcp__box__run" }, { isError: false });
  await new Promise((resolve) => setTimeout(resolve, 2600));
  const afterTimer = await call("/api/service-manager/stats");
  check("隐藏后再有调用，2.6 秒后仍然隐藏", !afterTimer.rows.some((row) => row.key === "mcp:box"));

  const file = JSON.parse(await readFile(path.join(profile, ".dsh-service-manager", "stats.json"), "utf8"));
  check("文件 version = 3", file.version === 3, String(file.version));
  check("文件记下了 hidden", Array.isArray(file.hidden) && file.hidden.includes("mcp:box"));
  check("隐藏不删数据，counters 仍保留", Boolean(file.counters?.["mcp:box"]));

  /* 幽灵键：没有任何计数也能隐藏、能列出来、能恢复，且恢复不会凭空造行 */
  const ghost = await post({ key: "skill:ghost-skill" });
  check("幽灵键可以隐藏", ghost.ok === true);
  const withGhost = await call("/api/service-manager/stats");
  check("幽灵键出现在 hiddenRows", withGhost.hiddenRows.some((row) => row.key === "skill:ghost-skill"));

  await post({ key: "skill:ghost-skill", hidden: false });
  const afterGhostRestore = await call("/api/service-manager/stats");
  check("恢复后幽灵键从 hiddenRows 消失", !afterGhostRestore.hiddenRows.some((row) => row.key === "skill:ghost-skill"));
  check("恢复不会凭空造出计数行", !afterGhostRestore.rows.some((row) => row.key === "skill:ghost-skill"));

  await post({ key: "mcp:box", hidden: false });
  const restored = await call("/api/service-manager/stats");
  const boxRow = restored.rows.find((row) => row.key === "mcp:box");
  check("恢复后 mcp:box 回到 rows", Boolean(boxRow));
  check("隐藏期间的调用没有丢（计数累计到 3）", (boxRow?.count ?? 0) === 3, String(boxRow?.count));

  const bad = await post({ key: "../../etc/passwd" });
  check("非法键被拒绝", bad.ok === false);
}

/* ------------------------------------- 5. v2 → v3 迁移：旧文件不能丢数据 */

{
  const profile = await temp("sm-profile-");
  await mkdir(path.join(profile, ".dsh-service-manager"), { recursive: true });
  await writeFile(
    path.join(profile, ".dsh-service-manager", "stats.json"),
    JSON.stringify({
      version: 2,
      since: "2026-11-01T00:00:00.000Z",
      counters: { "mcp:legacy": { ok: 3, fail: 1, lastAt: 1, lastFailAt: 1 } },
      days: {},
      errors: {},
    }),
    "utf8"
  );
  const { call } = await boot(ROOT, profile);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const stats = await call("/api/service-manager/stats");
  check("v2 文件的计数被读进来（没被版本号挡住）", stats.rows.some((row) => row.key === "mcp:legacy"), `${stats.rows.length} 行`);
  const file = JSON.parse(await readFile(path.join(profile, ".dsh-service-manager", "stats.json"), "utf8"));
  check("v2 文件升到 v3 且带上 hidden", file.version === 3 && Array.isArray(file.hidden), String(file.version));
}

for (const dir of cleanup) await rm(dir, { recursive: true, force: true });

let failures = 0;
for (const [label, ok, detail] of checks) {
  if (!ok) failures += 1;
  if (!ok || /apply|stale|unknown|路由|13 条/.test(label)) {
    console.log(`${ok ? "✔" : "✘"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  }
}
console.log(`\n断言 ${checks.length} 项`);
console.log(failures ? `${failures} 项断言失败` : "全部通过");
process.exit(failures ? 1 : 0);
