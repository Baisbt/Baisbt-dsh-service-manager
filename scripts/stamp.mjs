#!/usr/bin/env node
/**
 * 构建戳：把 package.json 的 version、当前 commit、构建时间写进两半区的 BUILD 常量。
 *
 * 为什么需要它：
 *  - Host 进程只在启动时 import 一次 index.js；client.js 每次刷新页面都从磁盘重读。
 *    于是"磁盘 / 进程 / 页面"可能出现三个不同版本，历史上每次都要靠猜。
 *  - 页面拿 BUILD.commit 和 Host 自述的 build.commit 比对，就能自己判断
 *    "页面里跑的是不是旧构建"，不需要人肉对照文件时间。
 *
 * 打在哪：index.js 与 client.tsx（源码）。client.js 是编译产物，不手改；
 * 所以写入之后必须重新编译，否则发出去的 bundle 还带着旧戳——这一步脚本自己会做。
 *
 * 用法：
 *   node scripts/stamp.mjs          写入并重新编译（发布前跑一次，然后提交）
 *   node scripts/stamp.mjs --check  只校验 version 是否一致，不一致退出码 1
 *
 * 注意：commit 取的是"打包时"的 HEAD，可能比发布提交早一个，这是刻意的——
 * 它只用于"两边是不是同一份构建"的相等比较，不承担追溯发布点的职责。
 */
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FILES = ["index.js", "client.tsx"];
const PATTERN = /const BUILD = \{ version: (?:"[^"]*"|'[^']*'), commit: (?:"[^"]*"|'[^']*'), built: (?:"[^"]*"|'[^']*') \};/;

const check = process.argv.includes("--check");
let changed = false;

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const version = String(pkg.version ?? "");
if (!version) {
  console.error("✘ package.json 没有 version");
  process.exit(1);
}

const commit = git(["rev-parse", "--short=7", "HEAD"]) || "unreleased";
const built = new Date().toISOString();
const wanted = `const BUILD = { version: "${version}", commit: "${commit}", built: "${built}" };`;

let failures = 0;
for (const file of FILES) {
  const full = path.join(ROOT, file);
  const text = await readFile(full, "utf8");
  const match = PATTERN.exec(text);
  if (!match) {
    console.log(`✘ ${file}: 找不到 BUILD 常量`);
    failures += 1;
    continue;
  }

  const currentVersion = JSON.parse(match[0].match(/version: ("[^"]*"|'[^']*')/)[1]);
  const currentCommit = JSON.parse(match[0].match(/commit: ("[^"]*"|'[^']*')/)[1]);

  if (check) {
    const ok = currentVersion === version;
    console.log(`${ok ? "✔" : "✘"} ${file}: version=${currentVersion} commit=${currentCommit}${ok ? "" : `（应为 ${version}）`}`);
    if (!ok) failures += 1;
    continue;
  }

  if (match[0] === wanted) {
    console.log(`= ${file}: 已是最新`);
    continue;
  }

  /* 只替换这一行，其余字节原样保留 */
  await writeFile(full, text.replace(PATTERN, wanted), "utf8");
  changed = true;
  console.log(`✔ ${file}: ${currentVersion}@${currentCommit} → ${version}@${commit}`);
}

if (failures > 0) {
  console.error(`\n${failures} 处需要处理。跑 node scripts/stamp.mjs 修正后再提交。`);
  process.exit(1);
}
if (check) console.log("\n构建戳一致");

/* 源码变了就必须重新编译：client.js 才是发出去、也是页面真正加载的那份 */
if (!check && changed) {
  const build = spawnSync(process.execPath, [path.join(HERE, "build.mjs")], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) {
    console.error("✘ 构建戳已写入，但 client.js 编译失败");
    process.exit(build.status ?? 1);
  }
}
