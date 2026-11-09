#!/usr/bin/env node
/**
 * 编译 Client 半区：client.tsx → client.js。
 *
 * 为什么不是直接 `tsc -p .` 了事：tsc 的 outDir 不能指向项目根（它会把这个目录整个 exclude 掉），
 * 所以先落到 build/，再搬成根目录的 client.js —— 那个路径是插件清单（package.json 的 exports）和
 * 测试、预览页共同引用的，不能改名。
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");

const result = spawnSync(process.execPath, [tsc, "-p", ROOT], { cwd: ROOT, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

copyFileSync(path.join(ROOT, "build", "client.js"), path.join(ROOT, "client.js"));
rmSync(path.join(ROOT, "build"), { recursive: true, force: true });
console.log("client.tsx → client.js");
