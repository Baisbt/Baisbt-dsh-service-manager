#!/usr/bin/env node
/**
 * 一次性验证脚本（spike）——**不进运行时、不参与打包**。
 *
 * 目的：证明「MCP 服务器 → 每轮工具定义 tokens」这组数字在离线状态也算得出来，
 * 并且口径与 docs/integration/dsh-context-feasibility.md §5.2 一致。
 *
 * 它直接读 DSH 的会话投影缓存文件（`~/.dsh/storages/session_projcache/sessions/*.json`），
 * 这只用于验证；真正接入时应由 Host 通过 `sessionProjections` / `sessionProjectionCache`
 * 服务读取（见可行性文档 §7 候选 1）。
 *
 * 用法：
 *   node docs/integration/spike-server-cost.mjs                 # 取最近写入的会话
 *   node docs/integration/spike-server-cost.mjs --session <id>  # 指定会话
 *   node docs/integration/spike-server-cost.mjs --json          # 机器可读
 *
 * 只打印 serverName / 工具 name / tokens，不打印 URL、env、headers 等可能含密钥的字段。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const valueOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const profile = valueOf("profile") ?? process.env.DSH_PROFILE ?? "desktop";
const profileDir = path.join(homedir(), ".dsh", "profiles", profile);
const cacheDir = path.join(homedir(), ".dsh", "storages", "session_projcache", "sessions");

function newestCacheFile() {
  const files = readdirSync(cacheDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(cacheDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

function readServers() {
  // servers.json 里有 url/env/headers，可能含密钥；这里只取 serverName / enabled。
  const file = path.join(profileDir, ".dsh-service-manager", "servers.json");
  const rows = JSON.parse(readFileSync(file, "utf8"));
  const list = Array.isArray(rows) ? rows : rows?.servers ?? [];
  return list.map((row) => ({
    id: String(row.id ?? ""),
    serverName: String(row.serverName ?? ""),
    enabled: row.enabled !== false,
  }));
}

function main() {
  const wanted = valueOf("session");
  const file = wanted
    ? path.join(cacheDir, wanted.endsWith(".json") ? wanted : `${wanted}.json`)
    : newestCacheFile();

  const record = JSON.parse(readFileSync(file, "utf8"));
  const headers = record?.record?.rows?.contextHeaders?.val?.headers;
  if (!Array.isArray(headers) || headers.length === 0) {
    console.error("没有 contextHeaders 记录（dsh-context 未安装/未写入？）");
    process.exit(1);
  }

  const last = headers[headers.length - 1];
  const tools = Array.isArray(last.tools) ? last.tools : [];
  const allTokens = tools.reduce((sum, tool) => sum + (Number(tool.tokens) || 0), 0);

  const servers = new Map(readServers().map((row) => [row.serverName, row]));
  const perServer = new Map();
  for (const tool of tools) {
    const match = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(String(tool?.name ?? ""));
    if (!match) continue;
    const [, serverName] = match;
    const entry = perServer.get(serverName) ?? { name: serverName, tools: 0, tokens: 0 };
    entry.tools += 1;
    entry.tokens += Number(tool.tokens) || 0;
    perServer.set(serverName, entry);
  }

  const rows = [...perServer.values()].sort((a, b) => b.tokens - a.tokens);

  if (flag("json")) {
    console.log(
      JSON.stringify(
        {
          session: path.basename(file, ".json"),
          headerSeq: last.seq,
          headerTime: last.time,
          totalToolTokens: allTokens,
          toolCount: tools.length,
          servers: rows.map((row) => ({
            ...row,
            configured: servers.get(row.name)?.enabled ?? null,
            share: allTokens > 0 ? Number(((row.tokens / allTokens) * 100).toFixed(1)) : 0,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`会话：${path.basename(file, ".json")}`);
  console.log(`请求头：seq=${last.seq}  time=${new Date(last.time).toISOString()}`);
  console.log(`工具定义：${tools.length} 个，合计 ${allTokens} tokens\n`);
  console.log("服务器          工具   tokens   占比    配置");
  console.log("-------------------------------------------------");
  for (const row of rows) {
    const share = allTokens > 0 ? ((row.tokens / allTokens) * 100).toFixed(1) : "0.0";
    const configured = servers.has(row.name) ? (servers.get(row.name).enabled ? "已启用" : "已停用") : "未在 servers.json";
    console.log(
      `${row.name.padEnd(14)}${String(row.tools).padStart(4)}${String(row.tokens).padStart(9)}${share.padStart(7)}%  ${configured}`,
    );
  }
  if (rows.length === 0) console.log("（这次请求里没有 MCP 工具）");
}

main();
