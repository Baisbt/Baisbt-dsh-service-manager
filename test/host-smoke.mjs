/**
 * Host 半区冒烟：用最小 ctx 替身真跑 apply()，再直接调用路由处理函数。
 *
 * 覆盖这几件事，全部在「重启 DSH」之前就能知道答案：
 *  1. apply() 不抛错、路由注册齐全且无重复、各路由能正常应答；
 *  2. 进程启动后磁盘被换成新版 → /version 必须报 stale（这正是历史故障的形状）；
 *  3. package.json 读不到 → /version 报 unknown，而不是瞎猜；
 *  4. /open 只接受扫描到的技能名，不接任意路径。
 *
 * 用 node test/host-smoke.mjs 运行。
 */
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  process.env.DSH_SERVICE_MANAGER_NO_OPEN = "1"; /* 别真的弹资源管理器 */
  const { call } = await boot(ROOT, profile);
  process.env.DSH_SERVICE_MANAGER_NO_OPEN = previous;

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
  } else {
    check("（本机没有技能，跳过定位成功用例）", true);
  }

  /* 打开配置文件那条老路子不能被改坏 */
  await writeFile(path.join(profile, "mcp-servers.yml"), "[]", "utf8");
  const file = await post({ kind: "file" });
  check("打开配置文件仍然可用", file.ok === true && file.kind === "file", file.error);
}

for (const dir of cleanup) await rm(dir, { recursive: true, force: true });

let failures = 0;
for (const [label, ok, detail] of checks) {
  if (!ok) failures += 1;
  if (!ok || /apply|stale|unknown|路由|stats/.test(label)) {
    console.log(`${ok ? "✔" : "✘"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  }
}
console.log(`\n断言 ${checks.length} 项`);
console.log(failures ? `${failures} 项断言失败` : "全部通过");
process.exit(failures ? 1 : 0);
