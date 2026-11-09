/**
 * 服务管理页 · Host 半区
 *
 * 职责：
 *  - 读写我们自己独占的文件 <profileDir>/mcp-servers.yml（JSON 文本，合法 YAML）
 *  - 通过 cordis:include 让 DSH 加载它，改完调 entry.subtree.refresh()
 *  - 给 Client 提供 /api/service-manager/* 精确路由（自动鉴权）
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "service-manager";
export const inject = ["connection", "loader", "tools"];

const MCP_PLUGIN = "@deepseek-ai/dsh-mcp-client";
const INCLUDE_ID = "service-manager-mcp";
const MCP_TOOL_NAME = "mcp_service";
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

/* ------------------------------------------------------------ 版本与构建戳 */

/**
 * 「磁盘上是哪一版」和「进程里跑的是哪一版」是两件事，历史上最容易误判：
 *  - LOADED 在本模块被 import 的那一刻读一次，代表这个 Host 进程加载的版本
 *  - /version 路由被调用时再读一次磁盘，代表 pnpm 刚刚换上来的版本
 * 两者不同 = 插件已更新但进程没重启，页面照着这条事实说清楚，不再靠猜。
 *
 * BUILD 由 scripts/stamp.mjs 写入，只用来给页面判断「页面里这份 JS 是不是旧构建」；
 * 权威版本永远是 package.json 的 version。
 */
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUILD = { version: "0.12.0", commit: "f182ff8", built: "2026-11-09T09:00:28.943Z" };

function readSelfVersion() {
  try {
    const file = path.join(PLUGIN_DIR, "package.json");
    const info = statSync(file);
    const data = JSON.parse(readFileSync(file, "utf8"));
    const version = typeof data.version === "string" && data.version !== "" ? data.version : null;
    return { version, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

const LOADED = readSelfVersion();
const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

/* ------------------------------------------------------------------ 路径 */

function resolveProfileDir(ctx) {
  try {
    const base = ctx.baseUrl;
    if (typeof base === "string" && base.length > 0) {
      if (base.startsWith("file:")) return fileURLToPath(base.endsWith("/") ? base : base + "/");
      if (path.isAbsolute(base)) return base;
    }
  } catch {
    /* fall through */
  }
  const profile = process.env.DSH_PROFILE || "desktop";
  return path.join(homedir(), ".dsh", "profiles", profile);
}

/* -------------------------------------------------------------- 数据文件 */

const MODEL_FILE = "servers.json";
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** 把含 `${VAR}` 的字符串变成 YAML 的 `!!js` 表达式；不含引用返回 null。 */
function envExpression(value) {
  if (typeof value !== "string" || !value.includes("${")) return null;
  const parts = value.split(ENV_REF);
  let expression = "`";
  for (let index = 0; index < parts.length; index += 1) {
    const chunk = parts[index] ?? "";
    if (index % 2 === 0) {
      expression += chunk.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    } else {
      expression += "${process.env." + chunk + "}";
    }
  }
  expression += "`";
  return expression;
}

function emitScalar(value) {
  const expression = envExpression(value);
  return expression === null ? JSON.stringify(String(value)) : `!!js ${expression}`;
}

function emitMap(lines, indent, map) {
  for (const [key, raw] of Object.entries(map ?? {})) {
    lines.push(`${indent}${JSON.stringify(key)}: ${emitScalar(raw)}`);
  }
}

/** 模型 → 供 DSH 加载的 YAML 文本（单向生成，永不回读）。 */
function renderServersYaml(servers) {
  const lines = ["# 本文件由「服务管理页」自动生成，请勿手工编辑。", "# 需要密钥时写 ${ENV_NAME}，会变成 !!js 表达式从环境变量读取。"];
  if (!servers.length) {
    lines.push("[]");
    return lines.join("\n") + "\n";
  }
  for (const server of servers) {
    lines.push(`- id: ${JSON.stringify(server.id)}`);
    lines.push(`  name: ${JSON.stringify(MCP_PLUGIN)}`);
    if (server.enabled === false) lines.push("  disabled: true");
    lines.push("  config:");
    lines.push(`    serverName: ${JSON.stringify(server.serverName)}`);
    lines.push(`    transport: ${JSON.stringify(server.transport)}`);
    if (server.transport === "stdio") {
      lines.push(`    command: ${emitScalar(server.command ?? "")}`);
      if (server.args?.length) {
        lines.push("    args:");
        for (const arg of server.args) lines.push(`      - ${emitScalar(arg)}`);
      }
      if (server.cwd) lines.push(`    cwd: ${emitScalar(server.cwd)}`);
      if (server.env && Object.keys(server.env).length) {
        lines.push("    env:");
        emitMap(lines, "      ", server.env);
      }
    } else {
      lines.push(`    url: ${emitScalar(server.url ?? "")}`);
      if (server.headers && Object.keys(server.headers).length) {
        lines.push("    headers:");
        emitMap(lines, "      ", server.headers);
      }
    }
    lines.push("    failOnStartupError: true");
  }
  return lines.join("\n") + "\n";
}

async function readServers(modelFile, generatedFile) {
  try {
    const parsed = JSON.parse(await readFile(modelFile, "utf8"));
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* 模型文件不存在时尝试从旧版生成文件迁移 */
  }
  try {
    const legacy = JSON.parse(await readFile(generatedFile, "utf8"));
    if (!Array.isArray(legacy)) return [];
    return legacy.map((entry) => {
      const config = entry.config ?? {};
      return {
        id: entry.id,
        serverName: config.serverName ?? entry.id,
        transport: config.transport === "streamable-http" ? "streamable-http" : "stdio",
        command: config.command,
        args: config.args ?? [],
        cwd: config.cwd,
        env: config.env ?? {},
        url: config.url,
        headers: config.headers ?? {},
        enabled: entry.disabled !== true,
        note: "",
      };
    });
  } catch {
    return [];
  }
}

async function writeServers(modelFile, generatedFile, servers) {
  await mkdir(path.dirname(modelFile), { recursive: true });
  const modelTmp = `${modelFile}.${process.pid}.tmp`;
  await writeFile(modelTmp, JSON.stringify(servers, null, 2) + "\n", "utf8");
  await rename(modelTmp, modelFile);

  const yamlTmp = `${generatedFile}.${process.pid}.tmp`;
  await writeFile(yamlTmp, renderServersYaml(servers), "utf8");
  await rename(yamlTmp, generatedFile);
}

/* ------------------------------------------------------------------ 视图 */

/** 把工具的 JSON Schema 压成抽屉里能用的最小结构，避免整包 schema 上传。 */
function projectParams(parameters) {
  const props = parameters?.properties;
  if (!props || typeof props !== "object") return [];
  const required = new Set(Array.isArray(parameters.required) ? parameters.required : []);
  const out = [];
  for (const [name, schema] of Object.entries(props)) {
    if (out.length >= 40) break;
    let type = "any";
    if (typeof schema?.type === "string") type = schema.type;
    else if (Array.isArray(schema?.enum)) type = "enum";
    else if (Array.isArray(schema?.anyOf)) type = "union";
    out.push({
      name,
      type,
      required: required.has(name),
      description: typeof schema?.description === "string" ? schema.description.trim() : "",
    });
  }
  return out;
}

/** 从 ctx.tools 里按服务器名分组出工具摘要；拿不到就返回空表。 */
function readToolIndex(ctx) {
  const index = new Map();
  let schemas;
  try {
    schemas = ctx?.tools?.schemas?.() ?? [];
  } catch {
    return index;
  }
  for (const schema of schemas) {
    const match = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(String(schema?.name ?? ""));
    if (!match) continue;
    const list = index.get(match[1]) ?? [];
    list.push({
      name: match[2],
      description: typeof schema.description === "string" ? schema.description.trim() : "",
      params: projectParams(schema.parameters),
    });
    index.set(match[1], list);
  }
  for (const list of index.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return index;
}

function toView(server) {
  const stdio = server.transport === "stdio";
  const endpoint = stdio
    ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
    : String(server.url ?? "");
  return {
    id: server.id,
    serverName: server.serverName,
    transport: server.transport,
    endpoint,
    cwd: stdio ? server.cwd ?? "" : "",
    env: server.env ?? {},
    headers: server.headers ?? {},
    enabled: server.enabled !== false,
    toolCount: null,
    tools: [],
    status: server.enabled === false ? "disabled" : "configured",
    managed: true,
    note: server.note ?? "",
  };
}

function cleanMap(input) {
  const out = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    const name = String(key).trim();
    if (!name) continue;
    out[name] = String(value ?? "");
  }
  return out;
}

function normalize(body, existing) {
  const serverName = String(body.serverName ?? "").trim();
  if (!SERVER_NAME_RE.test(serverName)) {
    throw new Error("服务器名只能包含字母、数字、下划线和短横线，长度 1–32");
  }
  const transport = body.transport === "streamable-http" ? "streamable-http" : "stdio";
  const entry = {
    id: existing?.id ?? `mcp-${serverName.toLowerCase()}`,
    serverName,
    transport,
    enabled: body.enabled === false ? false : true,
    note: typeof body.note === "string" ? body.note.trim() : existing?.note ?? "",
  };
  if (transport === "stdio") {
    const command = String(body.command ?? "").trim();
    if (!command) throw new Error("stdio 模式必须填写启动命令");
    if (/\s/.test(command)) throw new Error("启动命令不能包含空格，请把参数填到「参数」里");
    const cwd = String(body.cwd ?? "").trim();
    if (!cwd) throw new Error("stdio 模式必须填写工作目录（留空会导致服务器启动失败）");
    entry.command = command;
    entry.args = Array.isArray(body.args) ? body.args.map(String) : [];
    entry.cwd = cwd;
    entry.env = cleanMap(body.env);
  } else {
    const url = String(body.url ?? "").trim();
    if (!url) throw new Error("HTTP 模式必须填写 URL");
    entry.url = url;
    entry.headers = cleanMap(body.headers);
  }
  return entry;
}

/* --------------------------------------------------------------- 技能扫描 */

async function scanSkills() {
  const roots = [
    { dir: path.join(homedir(), ".agents", "skills"), scope: "user" },
    { dir: path.join(homedir(), ".dsh", "skills"), scope: "user" },
  ];
  const out = [];
  for (const root of roots) {
    let names = [];
    try {
      const { readdir } = await import("node:fs/promises");
      names = await readdir(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of names) {
      if (!dirent.isDirectory()) continue;
      const file = path.join(root.dir, dirent.name, "SKILL.md");
      if (!existsSync(file)) continue;
      let description = "";
      let modelInvocable = true;
      try {
        const head = (await readFile(file, "utf8")).slice(0, 4000);
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
        if (fm) {
          const desc = /^description:\s*(.+)$/m.exec(fm[1]);
          if (desc) description = desc[1].replace(/^["']|["']$/g, "").trim();
          if (/^disable-model-invocation:\s*true/m.test(fm[1])) modelInvocable = false;
        }
      } catch {
        /* ignore */
      }
      out.push({
        name: dirent.name,
        description,
        scope: root.scope,
        modelInvocable,
        path: file,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/* ---------------------------------------------------------- 私有数据目录 */

const STATE_DIRNAME = ".dsh-service-manager";

async function ensureStateDir(profileDir) {
  const dir = path.join(profileDir, STATE_DIRNAME);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function readJsonFile(file, fallback) {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return fallback;
  }
}

let writeCounter = 0;

async function writeJsonFile(file, value) {
  /* 同一进程里并发写同一路径时，tmp 名必须唯一，否则两个写入互相覆盖。 */
  writeCounter += 1;
  const tmp = `${file}.${process.pid}.${writeCounter}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

/* -------------------------------------------------------------- 打开本地 */

function openWithShell(target, reveal) {
  return new Promise((resolve) => {
    try {
      /* 测试钩子：host-smoke 会走「打开」这条路，不能真的弹出资源管理器 */
      if (process.env.DSH_SERVICE_MANAGER_NO_OPEN === "1") {
        resolve({ ok: true, skipped: true });
        return;
      }
      if (process.platform === "win32") {
        const args = reveal ? ["/select,", target] : [target];
        const child = spawn("explorer.exe", args, { detached: true, stdio: "ignore" });
        child.on("error", (error) => resolve({ ok: false, error: error.message }));
        child.unref();
        resolve({ ok: true });
        return;
      }
      const command = process.platform === "darwin" ? "open" : "xdg-open";
      const args = reveal ? ["-R", target] : [target];
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.on("error", (error) => resolve({ ok: false, error: error.message }));
      child.unref();
      resolve({ ok: true });
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

/* ------------------------------------------------------------------ 翻译 */

const TRANSLATE_ENDPOINT = "https://api.mymemory.translated.net/get";
const TRANSLATE_MAX_CHARS = 460;
/* v3：缓存改成「原文哈希 → 各目标语言一层」。v2 的键隐含「目标必是中文」，
   语言能跟随界面之后必须分开存，否则切语言会命中另一门语言的旧译文。 */
const TRANSLATE_STORE_VERSION = 3;
const MODEL_TIMEOUT_MS = 45_000;
const MODEL_TOTAL_BUDGET_MS = 75_000;
const MODEL_BATCH_SIZE = 12;
const MODEL_CONCURRENCY = 1;
const MACHINE_TIMEOUT_MS = 6_000;
const MACHINE_CONCURRENCY = 4;

/* 目标语言跟随 DSH 的界面语言；只认 zh / en，认不出的值退回默认中文。 */
const DEFAULT_TARGET = "zh";
const TARGET_LABEL = { zh: "简体中文", en: "英文" };
const MACHINE_LANG = { zh: "zh-CN", en: "en", ja: "ja", ko: "ko", ru: "ru", ar: "ar" };

function normalizeTarget(value) {
  const lang = String(value ?? "").trim().toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("en")) return "en";
  return null;
}

/* -------------------------------------------------------------- 语言识别 */

/**
 * 只服务一件事：判断「这段原文是否已经是目标语言」，命中就跳过翻译、不花 token。
 * 认不出来返回 "und" —— 这种情况一定送去翻译：宁可多花一次，也不要猜错，
 * 把一段用户看不懂的原文当成译文摆在页面上。
 */
const KANA = /[\u3040-\u309f\u30a0-\u30ff]/;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const CYRILLIC = /[\u0400-\u04ff]/;
const ARABIC = /[\u0600-\u06ff]/;
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;
/* 英文功能词。命中越多越像英文；只有长度没有功能词的（法语、德语…）不算，宁可送去翻译。 */
const ENGLISH_HINT = /\b(the|and|of|to|with|for|from|that|this|your|you|use|when|is|are|be|by|in|on|at|as|or|not|it|its|can|will|into|via)\b/gi;

function detectLang(text) {
  const value = String(text ?? "");
  if (!value.trim()) return "und";
  /* 假名必须先判：日文里也有汉字，反过来不成立 */
  if (KANA.test(value)) return "ja";
  if (HAN.test(value)) return "zh";
  if (HANGUL.test(value)) return "ko";
  if (CYRILLIC.test(value)) return "ru";
  if (ARABIC.test(value)) return "ar";
  const words = value.match(LATIN_WORD) ?? [];
  const hints = value.match(ENGLISH_HINT) ?? [];
  if (words.length >= 3 && hints.length >= 1) return "en";
  if (words.length >= 6 && hints.length >= 2) return "en";
  return "und";
}

/** 稳定缓存键：整段原文的哈希；语言那一层由 store 结构承担，键里不带语言。 */
function textKey(text) {
  return createHash("sha1").update(String(text)).digest("hex").slice(0, 24);
}

/** 把一条缓存记录统一成「语言 → 译文」两层；v2 的顶层就是一条中文译文。 */
function normalizeEntry(raw, version) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (version < TRANSLATE_STORE_VERSION || typeof raw.zh === "string") {
    const text = typeof raw.zh === "string" ? raw.zh : "";
    if (!text) return null;
    return {
      zh: {
        text,
        engine: typeof raw.engine === "string" ? raw.engine : "machine",
        model: typeof raw.model === "string" ? raw.model : null,
        at: typeof raw.at === "string" ? raw.at : null,
      },
    };
  }
  const byLang = {};
  for (const [lang, value] of Object.entries(raw)) {
    if (!TARGET_LABEL[lang]) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const text = typeof value.text === "string" ? value.text : "";
    if (!text) continue;
    byLang[lang] = {
      text,
      engine: typeof value.engine === "string" ? value.engine : "machine",
      model: typeof value.model === "string" ? value.model : null,
      at: typeof value.at === "string" ? value.at : null,
    };
  }
  return Object.keys(byLang).length ? byLang : null;
}

/**
 * 磁盘格式：v1 是「原文前缀 → 译文」的平铺表（没有来源信息，直接作废）；
 * v2 是「原文哈希 → 一条中文译文」；v3 是「原文哈希 → { zh: 条目, en: 条目 }」。
 * v2 升级到 v3 不丢数据：旧条目全部落在 zh 这一层，中文用户升级后不需要重翻。
 */
function normalizeStore(raw) {
  const source = raw && typeof raw === "object" && raw.entries && typeof raw.entries === "object" ? raw.entries : null;
  const version = raw && typeof raw === "object" && typeof raw.version === "number" ? raw.version : 0;
  const entries = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    const entry = normalizeEntry(value, version);
    if (entry) entries[key] = entry;
  }
  return { version: TRANSLATE_STORE_VERSION, entries };
}

/* -------------------------------------------------------- LLM 服务与模型目录 */

function llmService(ctx) {
  try {
    return ctx.get?.("llm") ?? null;
  } catch {
    return null;
  }
}

function defaultModelService(ctx) {
  try {
    return ctx.get?.("agentDefaultModel") ?? null;
  } catch {
    return null;
  }
}

function defaultSelection(ctx) {
  try {
    const selection = defaultModelService(ctx)?.currentSelection?.();
    if (selection?.provider && selection?.model) {
      return { provider: String(selection.provider), model: String(selection.model) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 等价于官方 GUI 的 modelCatalog，但只要 id / 名字——供翻译模型下拉框使用。 */
async function listModelCatalog(ctx) {
  const llm = llmService(ctx);
  if (!llm?.listProviders) {
    return { providers: [], failures: [{ id: "llm", message: "宿主没有提供 LLM 服务" }] };
  }
  const providers = [];
  const failures = [];
  let list;
  try {
    list = llm.listProviders();
  } catch (error) {
    return { providers: [], failures: [{ id: "llm", message: String(error?.message ?? error) }] };
  }
  for (const provider of list) {
    const id = provider?.id;
    if (typeof id !== "string" || !id) continue;
    try {
      const models = await llm.listModels(id);
      const entries = models
        .filter((model) => typeof model?.id === "string" && model.id)
        .map((model) => ({
          id: model.id,
          name: typeof model.name === "string" && model.name ? model.name : model.id,
        }));
      providers.push({
        id,
        name: typeof provider.name === "string" && provider.name ? provider.name : id,
        models: entries,
      });
    } catch (error) {
      failures.push({ id, message: String(error?.message ?? error) });
    }
  }
  return { providers: providers.filter((provider) => provider.models.length > 0), failures };
}

/** 翻译不需要思考链：能关就关，否则推理 token 会把输出预算吃光。 */
async function quietReasoningEffort(llm, selection) {
  try {
    const info = await llm.resolveModelInfo(selection.provider, selection.model);
    const efforts = info?.reasoning?.efforts;
    if (!Array.isArray(efforts) || !efforts.length) return undefined;
    const off = efforts.find((effort) => /^(off|none|minimal|low)$/i.test(String(effort?.id ?? "")));
    return off?.id ?? efforts[0]?.id;
  } catch {
    return undefined;
  }
}

function buildPrompt(texts, offset, target) {
  const last = offset + texts.length;
  const body = texts.map((text, index) => `<<<${offset + index + 1}>>>\n${text}`).join("\n\n");
  const language = TARGET_LABEL[target] ?? TARGET_LABEL[DEFAULT_TARGET];
  const nouns =
    target === "en"
      ? "1. 专有名词保持原样，不要意译：SKILL.md、shadcn/ui、GSAP、Tailwind CSS、Codex、Claude、MCP、API、DeepSeek。"
      : "1. 专有名词保留英文：SKILL.md、shadcn/ui、GSAP、Tailwind CSS、Codex、Claude、MCP、API、DeepSeek。";
  return [
    `把下面 ${texts.length} 条技能 / 工具的描述翻成${language}（原文可能是英文，也可能是别的语言，按它本来的语言翻）。`,
    "",
    "输出格式（必须严格遵守）：",
    `- 每条译文前面顶格写它自己的编号标记，例如 <<<${offset + 1}>>>，标记单独占一行`,
    "- 标记下一行只写译文，不要写原文、不要解释、不要代码块、不要加引号",
    `- 编号从 ${offset + 1} 到 ${last}，一共 ${texts.length} 条，不要漏`,
    "",
    "翻译要求：",
    nouns,
    "2. 语气像产品界面文案，简洁，不要逐字硬译、不要展开解释。",
    "3. 原文被截断时照原样翻完，不要补充原文没有的内容。",
    "",
    body,
  ].join("\n");
}

function buildSinglePrompt(text, target) {
  const language = TARGET_LABEL[target] ?? TARGET_LABEL[DEFAULT_TARGET];
  return [
    `把下面这句技能描述翻成${language}。`,
    "只输出译文本身，一行，不要编号、不要引号、不要解释。",
    "专有名词保留英文（SKILL.md、shadcn/ui、GSAP、Codex、MCP、API 等）。",
    "",
    text,
  ].join("\n");
}

const MARKER_RE = /<<<\s*(\d+)\s*>>>/g;

/** 按 `<<<n>>>` 标记切分。模型对标记的服从度远高于 JSON。 */
function parseMarked(raw, offset, expected) {
  const out = new Array(expected).fill(null);
  const hits = [...raw.matchAll(MARKER_RE)];
  if (!hits.length) return null;
  let filled = 0;
  for (let index = 0; index < hits.length; index += 1) {
    const number = Number(hits[index][1]);
    const start = hits[index].index + hits[index][0].length;
    const end = index + 1 < hits.length ? hits[index + 1].index : raw.length;
    const slot = number - offset - 1;
    if (!Number.isInteger(slot) || slot < 0 || slot >= expected) continue;
    const text = raw
      .slice(start, end)
      .replace(/^[\s:：、.。-]+/, "")
      .replace(/\s+$/, "");
    if (text) {
      out[slot] = text;
      filled += 1;
    }
  }
  return filled ? out : null;
}

/** 退路一：`1. 译文` 这种编号行。 */
function parseNumbered(raw, offset, expected) {
  const out = new Array(expected).fill(null);
  const buffer = [];
  let current = -1;
  let filled = 0;
  const flush = () => {
    if (current < 0) return;
    const slot = current - offset - 1;
    if (slot >= 0 && slot < expected) {
      const text = buffer.join(" ").trim();
      if (text) {
        out[slot] = text;
        filled += 1;
      }
    }
  };
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const hit = /^\s*(\d{1,2})\s*[.、)．]\s*(.*)$/.exec(line);
    if (hit) {
      flush();
      buffer.length = 0;
      current = Number(hit[1]);
      if (hit[2].trim()) buffer.push(hit[2].trim());
      continue;
    }
    if (current >= 0 && line.trim()) buffer.push(line.trim());
  }
  flush();
  return filled ? out : null;
}

/** 退路二：JSON 数组（模型偶尔还是会给）。 */
function parseJsonArray(raw, _offset, expected) {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.length) return null;
  const out = new Array(expected).fill(null);
  let filled = 0;
  parsed.forEach((item, index) => {
    if (typeof item !== "string" || !item.trim()) return;
    if (index >= expected) return;
    out[index] = item.trim();
    filled += 1;
  });
  return filled ? out : null;
}

function parseBatch(raw, offset, expected) {
  return parseMarked(raw, offset, expected) ?? parseJsonArray(raw, offset, expected) ?? parseNumbered(raw, offset, expected);
}

/** 单条译文清洗：去掉模型爱加的前后缀（目标语言不同，前缀词也不同）。 */
function cleanSingle(raw, target) {
  let text = String(raw ?? "").trim();
  if (!text) return null;
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  text = text.replace(/^<<<\s*\d+\s*>>>\s*/, "").trim();
  text = text.replace(/^\d{1,2}\s*[.、)．]\s*/, "").trim();
  text = text.replace(/^(译文|翻译|中文)\s*[:：]\s*/, "").trim();
  if (target === "en") text = text.replace(/^(translation|translated|english)\s*[:：]\s*/i, "").trim();
  text = text.replace(/^["'“”「『]/, "").replace(/["'“”」』]$/, "").trim();
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 1) text = lines[0].trim();
  return text || null;
}

/** 有并发上限的批量执行：结果按输入下标回填。 */
async function runPool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  };
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, run));
  return out;
}

/** 一次模型调用，只负责取回纯文本。timeoutMs 由调用方按剩余总预算收紧。 */
async function callModel(ctx, llm, selection, effort, prompt, maxTokens, timeoutMs = MODEL_TIMEOUT_MS) {
  let raw = "";
  let failure = null;
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      maxTokens,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      signal: AbortSignal.timeout(timeoutMs),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    });
    for await (const chunk of stream) {
      if (!chunk || typeof chunk !== "object") continue;
      if (chunk.type === "text-delta") {
        if (typeof chunk.text === "string") raw += chunk.text;
        continue;
      }
      if (chunk.type === "finish") {
        const reason = chunk.reason ?? {};
        if (reason.kind === "error" || reason.kind === "aborted") {
          failure = {
            code: String(reason.failure?.code ?? reason.kind),
            message: String(reason.failure?.message ?? reason.kind),
          };
        }
      }
    }
  } catch (error) {
    return { text: "", error: { code: "STREAM_THROW", message: String(error?.message ?? error) } };
  }
  if (failure) return { text: "", error: failure };
  return { text: raw, error: null };
}

/**
 * 用指定模型翻译成 target 语言。分批请求 + 标记协议解析 + 单条补齐，
 * 返回与 texts 等长的数组（允许部分为 null），全部失败时 values 为 null。
 */
async function modelTranslate(ctx, texts, selection, target) {
  const llm = llmService(ctx);
  if (!llm?.stream) return { values: null, failure: { code: "NO_LLM", message: "宿主没有提供 LLM 服务" } };
  if (!selection?.provider || !selection?.model) {
    return { values: null, failure: { code: "NO_MODEL", message: "没有选择翻译模型" } };
  }
  const effort = await quietReasoningEffort(llm, selection);
  const values = new Array(texts.length).fill(null);
  const errors = [];
  const deadline = Date.now() + MODEL_TOTAL_BUDGET_MS;

  const batches = [];
  for (let offset = 0; offset < texts.length; offset += MODEL_BATCH_SIZE) {
    batches.push({ offset, slice: texts.slice(offset, offset + MODEL_BATCH_SIZE) });
  }

  /* 分批跑。并发由 MODEL_CONCURRENCY 说了算（默认 1：本地模型代理本身是串行的），
     每一批拿到的超时不会超过剩下多少总预算，所以 75 s 是硬上限而不是「批间才检查」。 */
  await runPool(batches, MODEL_CONCURRENCY, async (batch) => {
    if (Date.now() > deadline) {
      errors.push({ code: "TIMEOUT", message: "模型翻译超时" });
      return;
    }
    const result = await callModel(
      ctx,
      llm,
      selection,
      effort,
      buildPrompt(batch.slice, batch.offset, target),
      Math.min(8192, 900 + batch.slice.length * 300),
      Math.min(MODEL_TIMEOUT_MS, Math.max(1000, deadline - Date.now()))
    );
    if (result.error) {
      errors.push(result.error);
      return;
    }
    const parsed = parseBatch(result.text, batch.offset, batch.slice.length);
    if (!parsed) {
      errors.push({ code: "PARSE", message: `模型没按约定格式返回：${result.text.trim().slice(0, 160) || "(空)"}` });
      return;
    }
    parsed.forEach((value, index) => {
      if (value) values[batch.offset + index] = value;
    });
  });

  /* 还缺的逐条补，最多补 8 条，同样并发 */
  const missing = [];
  values.forEach((value, index) => {
    if (!value) missing.push(index);
  });
  await runPool(missing.slice(0, 8), MODEL_CONCURRENCY, async (index) => {
    if (Date.now() > deadline) return;
    const result = await callModel(
      ctx,
      llm,
      selection,
      effort,
      buildSinglePrompt(texts[index], target),
      600,
      Math.min(MODEL_TIMEOUT_MS, Math.max(1000, deadline - Date.now()))
    );
    if (result.error) {
      errors.push(result.error);
      return;
    }
    const text = cleanSingle(result.text, target);
    if (text) values[index] = text;
  });

  const filled = values.filter(Boolean).length;
  if (!filled) {
    return { values: null, failure: errors[0] ?? { code: "EMPTY", message: "模型没有返回任何译文" } };
  }
  return { values, failure: filled < texts.length ? errors[0] ?? null : null };
}

/* ---------------------------------------------------------------- 机翻回退 */

/** 机翻只按「源语言 → 目标语言」走；认不出源语言时按英文处理（与旧行为一致）。 */
function machineLangPair(source, target) {
  const from = MACHINE_LANG[source === "und" ? "en" : source] ?? "en";
  const to = MACHINE_LANG[target] ?? MACHINE_LANG[DEFAULT_TARGET];
  return from === to ? null : `${from}|${to}`;
}

async function machineOne(item, target) {
  const pair = machineLangPair(item?.lang, target);
  if (!pair) return null;
  const text = String(item?.text ?? "");
  const query = text.length > TRANSLATE_MAX_CHARS ? text.slice(0, TRANSLATE_MAX_CHARS) : text;
  const url = `${TRANSLATE_ENDPOINT}?q=${encodeURIComponent(query)}&langpair=${encodeURIComponent(pair)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(MACHINE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const payload = await response.json();
    const value = payload?.responseData?.translatedText;
    if (typeof value !== "string" || !value.trim()) return null;
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(value)) return null;
    return value.trim();
  } catch {
    return null;
  }
}

/** 有并发上限的批量机翻；串行等待会把一次请求拖到分钟级。 */
async function machineTranslate(items, target) {
  const out = await runPool(items, MACHINE_CONCURRENCY, (item) => machineOne(item, target));
  return out.map((value) => (typeof value === "string" ? value : null));
}

/* ------------------------------------------------------------------ 插件 */

export function apply(ctx, config) {
  const profileDir = resolveProfileDir(ctx);
  const dataFile = path.join(profileDir, "mcp-servers.yml");
  const stateDir = path.join(profileDir, STATE_DIRNAME);
  const modelFile = path.join(stateDir, MODEL_FILE);
  const translateFile = path.join(stateDir, "translations.json");
  const settingsFile = path.join(stateDir, "settings.json");
  const diagnosticsFile = path.join(stateDir, "diagnostics.json");
  let translateStore = null;
  let settingsCache = null;
  /* diagnostics.json 是同一进程里多处写的，串行化避免读取-修改-写入互相覆盖 */
  let diagnosticsChain = Promise.resolve();

  function updateDiagnostics(patch) {
    diagnosticsChain = diagnosticsChain
      .catch(() => {})
      .then(async () => {
        const previous = await readJsonFile(diagnosticsFile, {});
        const base = previous && typeof previous === "object" ? previous : {};
        await writeJsonFile(diagnosticsFile, { ...base, ...patch });
      });
    return diagnosticsChain;
  }

  async function loadStore() {
    if (translateStore === null) {
      translateStore = normalizeStore(await readJsonFile(translateFile, null));
    }
    return translateStore;
  }

  async function saveStore() {
    if (translateStore === null) return;
    try {
      await ensureStateDir(profileDir);
      await writeJsonFile(translateFile, translateStore);
    } catch {
      /* 落盘失败不影响本次结果 */
    }
  }

  async function loadSettings() {
    if (settingsCache === null) {
      const raw = await readJsonFile(settingsFile, null);
      settingsCache = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    }
    return settingsCache;
  }

  async function saveSettings(patch) {
    const current = await loadSettings();
    settingsCache = { ...current, ...patch };
    await ensureStateDir(profileDir);
    await writeJsonFile(settingsFile, settingsCache);
    return settingsCache;
  }

  const log = (level, message, detail) => {
    const fn = ctx.logger?.[level] ?? console[level === "error" ? "error" : "log"];
    try {
      fn.call(ctx.logger ?? console, `[service-manager] ${message}`, detail ?? "");
    } catch {
      /* ignore */
    }
  };

  log("info", `profile 目录 ${profileDir}`);

  /* 自检：把 LLM 服务的可见性写进 diagnostics.json，出问题时不用猜。 */
  void (async () => {
    try {
      await ensureStateDir(profileDir);
      const llm = llmService(ctx);
      const catalog = await listModelCatalog(ctx);
      await updateDiagnostics({
        at: new Date().toISOString(),
        plugin: "service-manager",
        hasLlm: Boolean(llm?.stream),
        hasListProviders: typeof llm?.listProviders === "function",
        hasDefaultModelService: Boolean(defaultModelService(ctx)),
        defaultSelection: defaultSelection(ctx),
        providers: catalog.providers,
        failures: catalog.failures,
      });
    } catch {
      /* 自检失败不影响插件 */
    }

    /* 只在显式打开开关时跑一次真模型调用，用来确认翻译链路是否通。 */
    try {
      const settings = await loadSettings();
      if (process.env.DSH_SERVICE_MANAGER_PROBE !== "1" && settings.probeOnLoad !== true) return;
      const probeTarget =
        settings.translateModel?.provider && settings.translateModel?.model
          ? settings.translateModel
          : defaultSelection(ctx);
      /* 探针和真实翻译走同一条判定：已经是指定语言的描述不必再翻。 */
      const probeLanguage = normalizeTarget(settings.translateLanguage) ?? DEFAULT_TARGET;
      /* 拿真技能描述跑一遍，才能真正验证分批 + 标记解析 */
      const scanned = await scanSkills();
      const sample = scanned
        .map((skill) => skill.description)
        .filter((description) => description && detectLang(description) !== probeLanguage);
      const texts = sample.length
        ? sample
        : [probeLanguage === "en" ? "把本地文件系统暴露给模型，用于读写目录。" : "Design banners for social media, ads, and website heroes."];
      const started = Date.now();
      const result = await modelTranslate(ctx, texts, probeTarget, probeLanguage);
      const values = result.values ?? [];
      await updateDiagnostics({
        probe: {
          at: new Date().toISOString(),
          target: probeTarget,
          language: probeLanguage,
          ms: Date.now() - started,
          total: texts.length,
          filled: values.filter(Boolean).length,
          failure: result.failure,
          sample: values.slice(0, 3),
        },
      });
    } catch (error) {
      try {
        await updateDiagnostics({
          probe: { at: new Date().toISOString(), thrown: String(error?.message ?? error) },
        });
      } catch {
        /* ignore */
      }
    }
  })();

  async function refreshInclude() {
    try {
      const entries = ctx.loader?.entries?.() ?? [];
      for (const entry of entries) {
        const id = entry?.options?.id;
        if (id !== INCLUDE_ID) continue;
        const subtree = entry.subtree;
        if (subtree && typeof subtree.refresh === "function") {
          await subtree.refresh();
          return { refreshed: true };
        }
        return { refreshed: false, reason: "该 include 行没有 subtree.refresh()" };
      }
      return { refreshed: false, reason: `找不到 id 为 ${INCLUDE_ID} 的 include 行` };
    } catch (error) {
      return { refreshed: false, reason: error.message };
    }
  }

  /* 重连 MCP 服务器要几百毫秒到几秒，不能让写盘跟着等：后台跑，前端轮询 refreshState。 */
  let refreshState = { running: false, at: 0, ms: 0, reason: "" };
  let refreshTimer = null;

  function scheduleRefresh() {
    refreshState = { ...refreshState, running: true };
    if (refreshTimer) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      const started = Date.now();
      const outcome = await refreshInclude();
      refreshState = {
        running: false,
        at: Date.now(),
        startedAt: started,
        ms: Date.now() - started,
        reason: outcome.refreshed ? "" : outcome.reason ?? "刷新失败",
      };
    }, 0);
  }

  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  const fail = (error) => json({ ok: false, error: String(error?.message ?? error) }, 200);

  /* ------------------------------------------------------- Agent 工具 */

  /**
   * 让模型在对话里直接管 MCP：列 / 装 / 删 / 启停。
   * 装和删是破坏性写入，必须走 DSH 的一次性审批；列表和启停不需要。
   */
  /** 把 Agent 工具的注册结果记进 diagnostics.json，出问题不用猜。 */
  async function recordAgentTool(payload) {
    try {
      await updateDiagnostics({ agentTool: { ...payload, at: new Date().toISOString() } });
    } catch {
      /* 诊断写失败不影响插件 */
    }
  }

  async function askApproval(exec, reason) {
    let service = null;
    try {
      service = ctx.get?.("approval") ?? null;
    } catch {
      service = null;
    }
    if (!service?.request) {
      throw new Error("当前环境没有审批服务，安装/删除 MCP 需要人工确认，请改用「服务管理」页面操作");
    }
    if (!exec?.agent) throw new Error("没有会话上下文，无法请求审批");
    const outcome = await service.request({
      agent: exec.agent,
      toolName: MCP_TOOL_NAME,
      reason,
      ...(exec.signal === undefined ? {} : { signal: exec.signal }),
    });
    if (outcome === "allowed-once") return;
    if (outcome === "rejected") throw new Error("用户拒绝了这次操作，MCP 配置没有改动");
    if (outcome === "cancelled") throw new Error("审批被取消，MCP 配置没有改动");
    throw new Error("没有可用的审批应答方，MCP 配置没有改动");
  }

  function requireServerName(args) {
    const serverName = String(args?.serverName ?? "").trim();
    if (!serverName) throw new Error("缺少 serverName");
    return serverName;
  }

  function buildInstallBody(args) {
    const transport = args?.transport === "stdio" ? "stdio" : "streamable-http";
    const body = {
      serverName: args?.serverName,
      transport,
      note: typeof args?.note === "string" ? args.note : "",
      enabled: true,
    };
    if (transport === "stdio") {
      body.command = args?.command ?? "";
      body.args = Array.isArray(args?.args) ? args.args.map(String) : [];
      body.cwd = args?.cwd ?? "";
      body.env = args?.env && typeof args.env === "object" ? args.env : {};
    } else {
      body.url = args?.url ?? "";
      body.headers = args?.headers && typeof args.headers === "object" ? args.headers : {};
    }
    return body;
  }

  function describeServers(entries, index) {
    return entries.map((entry) => {
      const enabled = entry.enabled !== false;
      const list = index.get(entry.serverName) ?? [];
      return {
        serverName: entry.serverName,
        transport: entry.transport,
        enabled,
        status: enabled ? (list.length > 0 ? "connected" : "configured") : "disabled",
        tools: list.length,
      };
    });
  }

  const mcpToolDefinition = {
    name: MCP_TOOL_NAME,
    description: [
      "管理 DSH 的 MCP 服务器：列出已有的、安装新的、删除、启用或停用。",
      "安装和删除会先请用户确认（审批），列表和启停不会。",
      "装好之后服务器会在后台重连，它的工具在下一轮对话里可用。",
      "密钥不要写明文：值里写 ${ENV_NAME}，DSH 加载时会从环境变量读取。",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "install", "remove", "enable", "disable"],
          description: "要执行的动作",
        },
        serverName: {
          type: "string",
          description: "服务器名，只能含字母数字下划线短横线，1–32 位；这个前缀会出现在工具名里（mcp__<serverName>__<tool>）",
        },
        transport: {
          type: "string",
          enum: ["streamable-http", "stdio"],
          description: "远程服务用 streamable-http（默认），本地进程用 stdio",
        },
        url: { type: "string", description: "streamable-http：服务地址" },
        headers: { type: "object", description: "streamable-http：请求头键值对，值里可用 ${VAR}" },
        command: { type: "string", description: "stdio：启动命令，不含参数，例如 npx" },
        args: { type: "array", items: { type: "string" }, description: "stdio：命令参数" },
        cwd: { type: "string", description: "stdio：工作目录，必填" },
        env: { type: "object", description: "stdio：环境变量键值对，值里可用 ${VAR}" },
        note: { type: "string", description: "备注，只给人看" },
      },
      required: ["action"],
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean" },
          action: { type: "string" },
          message: { type: "string" },
          servers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                serverName: { type: "string" },
                transport: { type: "string" },
                enabled: { type: "boolean" },
                status: { type: "string" },
                tools: { type: "number" },
              },
              required: ["serverName", "transport", "enabled", "status", "tools"],
            },
          },
        },
        required: ["ok", "action", "message"],
      },
      render(_args, value) {
        const lines = [value?.message ?? ""];
        for (const server of value?.servers ?? []) {
          const state = server.enabled ? server.status : "已停用";
          const tools = server.tools ? `，${server.tools} 个工具` : "";
          lines.push(`· ${server.serverName}（${server.transport}，${state}${tools}）`);
        }
        return [{ type: "text", text: lines.filter(Boolean).join("\n") }];
      },
    },
    async execute(args, exec) {
      const action = String(args?.action ?? "");
      const entries = await readServers(modelFile, dataFile);

      if (action === "list") {
        const list = describeServers(entries, readToolIndex(ctx));
        return {
          ok: true,
          action,
          message: entries.length ? `共 ${entries.length} 台 MCP 服务器` : "还没有 MCP 服务器，可以用 install 动作添加",
          servers: list,
        };
      }

      if (action === "install") {
        /* 先校验再审批：参数不合法时不该弹确认框打扰用户 */
        const body = buildInstallBody(args);
        const latest = await readServers(modelFile, dataFile);
        const position = latest.findIndex((entry) => entry.serverName === body.serverName);
        const next = normalize(body, latest[position]);
        await askApproval(exec, `安装 MCP 服务器「${next.serverName}」`);
        if (position >= 0) latest[position] = next;
        else latest.push(next);
        await writeServers(modelFile, dataFile, latest);
        scheduleRefresh();
        return {
          ok: true,
          action,
          message:
            position >= 0
              ? `已更新 ${next.serverName}，正在后台重连；工具会在下一轮对话里刷新`
              : `已安装 ${next.serverName}，正在后台重连；工具会在下一轮对话里出现`,
        };
      }

      if (action === "remove") {
        const serverName = requireServerName(args);
        const latest = await readServers(modelFile, dataFile);
        const remaining = latest.filter((entry) => entry.serverName !== serverName);
        if (remaining.length === latest.length) throw new Error(`找不到 MCP 服务器 ${serverName}`);
        await askApproval(exec, `删除 MCP 服务器「${serverName}」`);
        await writeServers(modelFile, dataFile, remaining);
        scheduleRefresh();
        return { ok: true, action, message: `已删除 ${serverName}，它的工具会从下一轮对话消失` };
      }

      if (action === "enable" || action === "disable") {
        const serverName = requireServerName(args);
        const target = entries.find((entry) => entry.serverName === serverName);
        if (!target) throw new Error(`找不到 MCP 服务器 ${serverName}`);
        target.enabled = action === "enable";
        await writeServers(modelFile, dataFile, entries);
        scheduleRefresh();
        return {
          ok: true,
          action,
          message: `${serverName} 已${action === "enable" ? "启用" : "停用"}，正在后台重连`,
        };
      }

      throw new Error(`不认识的 action「${action}」，可用：list / install / remove / enable / disable`);
    },
  };

  try {
    ctx.tools.register(mcpToolDefinition);
    log("info", `已注册 Agent 工具 ${MCP_TOOL_NAME}`);
    void recordAgentTool({ ok: true, name: MCP_TOOL_NAME });
  } catch (error) {
    log("error", `注册 Agent 工具失败：${error.message}`);
    void recordAgentTool({ ok: false, name: MCP_TOOL_NAME, error: String(error?.message ?? error) });
  }

  /* ---------------------------------------------------------------- 路由 */

  ctx.connection.fetch.register({
    path: "/api/service-manager/mcp",
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => {
      try {
        const entries = await readServers(modelFile, dataFile);
        const views = entries.map(toView);
        const index = readToolIndex(ctx);
        for (const view of views) {
          if (!view.enabled) continue;
          const list = index.get(view.serverName);
          if (!list) continue;
          view.tools = list;
          view.toolCount = list.length;
          view.status = list.length > 0 ? "connected" : "idle";
        }
        return json({ ok: true, file: dataFile, servers: views, refresh: refreshState });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/mcp/save",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const body = await request.json();
        const entries = await readServers(modelFile, dataFile);
        const index = entries.findIndex((entry) => entry.serverName === body.serverName);
        const next = normalize(body, entries[index]);
        if (index >= 0) entries[index] = next;
        else entries.push(next);
        await writeServers(modelFile, dataFile, entries);
        scheduleRefresh();
        return json({ ok: true, id: next.id, queued: true });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/mcp/delete",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const body = await request.json();
        const entries = await readServers(modelFile, dataFile);
        const next = entries.filter((entry) => entry.id !== body.id);
        if (next.length === entries.length) throw new Error("找不到这台服务器");
        await writeServers(modelFile, dataFile, next);
        scheduleRefresh();
        return json({ ok: true, queued: true });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/mcp/toggle",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const body = await request.json();
        const entries = await readServers(modelFile, dataFile);
        const target = entries.find((entry) => entry.id === body.id);
        if (!target) throw new Error("找不到这台服务器");
        if (body.enabled === false) target.enabled = false;
        else target.enabled = true;
        await writeServers(modelFile, dataFile, entries);
        scheduleRefresh();
        return json({ ok: true, enabled: target.enabled !== false, queued: true });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/skills",
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => {
      try {
        return json({ ok: true, skills: await scanSkills() });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/open",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const body = await request.json();
        const kind = body.kind === "folder" ? "folder" : body.kind === "skill" ? "skill" : "file";
        let target;
        if (kind === "file") {
          target = dataFile;
        } else if (kind === "folder") {
          target = profileDir;
        } else {
          /* 只接受「本插件扫描到的技能名」：客户端不传路径，避免被当成任意文件的打开器 */
          const name = typeof body.name === "string" ? body.name : "";
          const skill = (await scanSkills()).find((entry) => entry.name === name);
          if (!skill?.path) throw new Error(`找不到技能：${name || "(空)"}`);
          target = skill.path;
        }
        if (!existsSync(target)) throw new Error(`路径不存在：${target}`);
        const result = await openWithShell(target, kind !== "folder");
        if (!result.ok) throw new Error(result.error);
        return json({ ok: true, kind, target });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/skills/delete",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const body = await request.json();
        const skillPath = String(body.path ?? "");
        if (!skillPath) throw new Error("缺少技能路径");
        const dir = path.dirname(skillPath);
        const file = path.join(dir, "SKILL.md");
        if (!existsSync(file)) throw new Error("找不到这个技能的 SKILL.md");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backup = path.join(dir, `SKILL.md.disabled-${stamp}`);
        await rename(file, backup);
        return json({ ok: true, backup });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/skills/content",
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const url = new URL(request.url);
        const skillPath = url.searchParams.get("path") ?? "";
        if (!skillPath) throw new Error("缺少技能路径");
        const file = path.resolve(skillPath);
        if (!existsSync(file)) throw new Error("找不到技能文件");
        const raw = await readFile(file, "utf8");
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
        const body = match ? raw.slice(match[0].length) : raw;
        const meta = {};
        if (match) {
          for (const line of match[1].split(/\r?\n/)) {
            const pair = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line);
            if (pair) meta[pair[1]] = pair[2].replace(/^["']|["']$/g, "").trim();
          }
        }
        return json({ ok: true, meta, body });
      } catch (error) {
        return fail(error);
      }
    },
  });

  /* 翻译模型：列出可选的 provider / model，并保存用户的选择 */
  ctx.connection.fetch.register({
    path: "/api/service-manager/models",
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        if (request.method === "POST") {
          const body = await request.json();
          const provider = String(body?.provider ?? "").trim();
          const model = String(body?.model ?? "").trim();
          const language = normalizeTarget(body?.target);
          const patch = language ? { translateLanguage: language } : {};
          if (!provider || !model) {
            await saveSettings({ ...patch, translateModel: null });
            return json({ ok: true, selected: null, language });
          }
          await saveSettings({ ...patch, translateModel: { provider, model } });
          return json({ ok: true, selected: { provider, model }, language });
        }
        const catalog = await listModelCatalog(ctx);
        const settings = await loadSettings();
        const saved = settings.translateModel ?? null;
        const fallback = defaultSelection(ctx);
        const usable = saved && saved.provider && saved.model ? saved : null;
        return json({
          ok: true,
          providers: catalog.providers,
          failures: catalog.failures,
          selected: usable ?? fallback,
          recommended: fallback,
          saved: usable,
          language: normalizeTarget(settings.translateLanguage) ?? DEFAULT_TARGET,
        });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/skills/translate",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      try {
        const body = await request.json();
        const rawItems = Array.isArray(body?.items) ? body.items : [];
        const items = [];
        for (const item of rawItems.slice(0, 60)) {
          const text = typeof item?.text === "string" ? item.text : "";
          if (!text.trim()) continue;
          items.push({ id: String(item?.id ?? textKey(text)), text });
        }
        const force = body?.force === true;
        const cachedOnly = body?.cachedOnly === true;
        const allowMachine = body?.machine !== false;

        const store = await loadStore();
        const settings = await loadSettings();
        const requested =
          body?.model && typeof body.model === "object"
            ? { provider: String(body.model.provider ?? ""), model: String(body.model.model ?? "") }
            : null;
        const savedTarget =
          settings.translateModel && settings.translateModel.provider && settings.translateModel.model
            ? settings.translateModel
            : null;
        const target = (requested?.provider && requested?.model ? requested : null) ?? savedTarget ?? defaultSelection(ctx);
        /* 目标语言 = 页面当前的界面语言。顺手记一笔：加载期探针和「没带 target 的老页面」都用它。 */
        const requestedLanguage = normalizeTarget(body?.target);
        const language = requestedLanguage ?? normalizeTarget(settings.translateLanguage) ?? DEFAULT_TARGET;
        if (requestedLanguage && requestedLanguage !== normalizeTarget(settings.translateLanguage)) {
          try {
            await saveSettings({ translateLanguage: requestedLanguage });
          } catch {
            /* 语言偏好写失败不影响本次翻译 */
          }
        }

        const results = {};
        const pending = [];
        for (const item of items) {
          const sourceLang = detectLang(item.text);
          /* 原文已经是目标语言：直接当译文回，既不进批次也不花 token */
          if (sourceLang === language) {
            results[item.id] = { text: item.text, engine: "source", model: null, lang: language, sourceLang, cached: true };
            continue;
          }
          const key = textKey(item.text);
          const entry = store.entries[key]?.[language];
          if (entry?.text && !force) {
            results[item.id] = {
              text: entry.text,
              engine: entry.engine ?? "machine",
              model: entry.model ?? null,
              at: entry.at ?? null,
              lang: language,
              sourceLang,
              cached: true,
            };
            continue;
          }
          pending.push({ id: item.id, text: item.text, key, sourceLang });
        }

        if (cachedOnly) {
          return json({ ok: true, engine: "cache", target, language, results, pending: pending.map((item) => item.id) });
        }

        let engine = pending.length ? "none" : "cache";
        let modelError = null;

        if (pending.length) {
          const modeled = target
            ? await modelTranslate(ctx, pending.map((item) => item.text), target, language)
            : { values: null, failure: { code: "NO_MODEL", message: "没有可用的翻译模型" } };
          const modelLabel = target ? `${target.provider}/${target.model}` : null;
          if (modeled.values) {
            engine = "model";
            const at = new Date().toISOString();
            const leftover = [];
            pending.forEach((item, index) => {
              const text = modeled.values[index];
              if (!text) {
                leftover.push(item);
                return;
              }
              const slots = store.entries[item.key] ?? {};
              slots[language] = { text, engine: "model", model: modelLabel, at };
              store.entries[item.key] = slots;
              results[item.id] = {
                text,
                engine: "model",
                model: modelLabel,
                at,
                lang: language,
                sourceLang: item.sourceLang,
                cached: false,
              };
            });
            pending.length = 0;
            pending.push(...leftover);
            await saveStore();
            if (modeled.failure) {
              modelError = `${modeled.failure.code ?? "MODEL"}: ${modeled.failure.message ?? "部分条目没有译出"}`;
            }
          } else {
            modelError = `${modeled.failure?.code ?? "MODEL"}: ${modeled.failure?.message ?? "模型翻译失败"}`;
          }

          if (pending.length && allowMachine) {
            const values = await machineTranslate(
              pending.map((item) => ({ text: item.text, lang: item.sourceLang })),
              language
            );
            const at = new Date().toISOString();
            let any = false;
            pending.forEach((item, index) => {
              const text = values[index];
              if (!text) return;
              any = true;
              const slots = store.entries[item.key] ?? {};
              slots[language] = { text, engine: "machine", model: null, at };
              store.entries[item.key] = slots;
              results[item.id] = {
                text,
                engine: "machine",
                model: null,
                at,
                lang: language,
                sourceLang: item.sourceLang,
                cached: false,
              };
            });
            if (any) {
              engine = engine === "model" ? "model+machine" : "machine";
              await saveStore();
            }
          }

          /* 两轮都没拿到：显式标成 none，界面上说「未译出」，而不是留一片空白 */
          for (const item of pending) {
            if (results[item.id]) continue;
            results[item.id] = {
              text: null,
              engine: "none",
              model: null,
              lang: language,
              sourceLang: item.sourceLang,
              cached: false,
            };
          }
        }

        const settled = Object.values(results);
        const counts = {
          model: settled.filter((entry) => entry?.engine === "model").length,
          machine: settled.filter((entry) => entry?.engine === "machine").length,
          source: settled.filter((entry) => entry?.engine === "source").length,
          none: settled.filter((entry) => entry?.engine === "none").length,
        };

        try {
          await updateDiagnostics({
            lastTranslate: {
              at: new Date().toISOString(),
              target,
              language,
              requested: items.length,
              engine,
              counts,
              modelError,
            },
          });
        } catch {
          /* 诊断写失败不影响结果 */
        }

        return json({ ok: true, engine, target, language, modelError, counts, results });
      } catch (error) {
        return fail(error);
      }
    },
  });

  ctx.connection.fetch.register({
    path: "/api/service-manager/paths",
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => json({ ok: true, profileDir, file: dataFile }),
  });

  /**
   * 版本自述。页面据此自己判断「要不要重启」，而不是让用户凭感觉猜。
   * 只读、无副作用，因此可以随便轮询。
   */
  ctx.connection.fetch.register({
    path: "/api/service-manager/version",
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async () => {
      const disk = readSelfVersion();
      const runningVersion = LOADED?.version ?? null;
      const diskVersion = disk?.version ?? null;
      return json({
        ok: true,
        /* 磁盘与进程不一致 → 必须重启才生效 */
        stale: Boolean(runningVersion && diskVersion && runningVersion !== diskVersion),
        /* 读不到 package.json → 不下结论，只说读不到 */
        unknown: diskVersion === null,
        running: {
          version: runningVersion,
          startedAt: PROCESS_STARTED_AT,
          pid: process.pid,
          node: process.versions?.node ?? null,
        },
        disk:
          diskVersion === null
            ? null
            : { version: diskVersion, mtime: new Date(disk.mtimeMs).toISOString() },
        build: BUILD,
        dir: PLUGIN_DIR,
        profileDir,
      });
    },
  });
}
