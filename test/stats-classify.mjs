/**
 * 统计口径的纯函数测试：错误分类 + 样本脱敏。
 * 这两个函数决定了 stats.json 里存什么，错一次要修很久的历史数据。
 * 用 node test/stats-classify.mjs 运行。
 */
import { classifyError, sanitizeSample } from "../index.js";

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "✔" : "✘"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`);
}

/* ---------- 错误分类 ---------- */
const classify = (code, message) => classifyError({ error: { message, info: { code, name: "mcp" } } });

check("ENOTFOUND → 网络", classify("ENOTFOUND", "getaddrinfo ENOTFOUND"), "NETWORK");
check("ETIMEDOUT → 网络", classify("ETIMEDOUT", "connect ETIMEDOUT 1.2.3.4:443"), "NETWORK");
check("ECONNREFUSED → 网络", classify("ECONNREFUSED", "connect ECONNREFUSED"), "NETWORK");
check("只有文案没有码 → 网络", classify("", "fetch failed"), "NETWORK");
check("401 → 鉴权", classify("HTTP_401", "401 Unauthorized"), "AUTH");
check("403 → 鉴权", classify("403", "Forbidden"), "AUTH");
check("invalid token 优先归鉴权", classify("", "invalid token supplied"), "AUTH");
check("invalid_type → 参数", classify("invalid_type", "arguments invalid"), "PARAM");
check("unknown tool → 参数", classify("UNKNOWN_TOOL", "no such tool"), "PARAM");
check("500 → 服务端", classify("500", "internal server error"), "SERVER");
check("server_error → 服务端", classify("server_error", "upstream failed"), "SERVER");
check("aborted → 取消", classify("aborted", "the operation was aborted"), "CANCELLED");
check("无法归类的 → 未知", classify("WEIRD_THING", "something odd"), "UNKNOWN");
check("空 result 不抛错", classifyError(undefined), "UNKNOWN");

/* ---------- 样本脱敏 ---------- */
const url = sanitizeSample("fetch failed: https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-dev-ABC123&x=1");
check("剥掉 query string", url.includes("tavilyApiKey"), false);
check("保留失败描述", url.startsWith("fetch failed:"), true);

const bearer = sanitizeSample("request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
check("遮掉 Bearer", bearer.includes("eyJhbGciOiJIUzI1NiJ9"), false);

const keyed = sanitizeSample("invalid key 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");
check("遮掉 tvly- 前缀密钥", keyed.includes("21NCDF"), false);

const longToken = sanitizeSample("token " + "a".repeat(48));
check("遮掉长不透明串", longToken.includes("a".repeat(48)), false);

const longText = sanitizeSample("word ".repeat(80).trim());
check("样本截到 200 字符", longText.length, 200);

console.log(failures ? `\n${failures} 项断言失败` : "\n全部通过");
process.exitCode = failures ? 1 : 0;
