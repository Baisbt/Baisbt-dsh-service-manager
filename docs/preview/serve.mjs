/**
 * 预览用静态服务器（仅用于看 docs/preview/index.html，不参与插件运行）。
 *   node docs/preview/serve.mjs   → http://127.0.0.1:4173/docs/preview/
 *
 * 根目录必须是仓库根：页面里的 `../../client.js` 指向仓库根的 client.js，
 * 只把 docs/preview 当根会让它 404（页面白屏，且只报一条网络错误）。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const PAGE = "/docs/preview/";
const port = Number(process.env.PORT ?? 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const query = (request.url ?? "").includes("?") ? (request.url ?? "").slice((request.url ?? "").indexOf("?")) : "";
  if (pathname === "/" || pathname === "/docs/preview") {
    response.writeHead(302, { location: PAGE + query });
    response.end();
    return;
  }
  let relative = normalize(pathname).replace(/^[\\/]+/, "");
  if (pathname.endsWith("/")) relative = normalize(relative + "index.html");
  const file = join(root, relative);
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`预览: http://127.0.0.1:${port}${PAGE}`);
});
