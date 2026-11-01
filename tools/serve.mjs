// tools/serve.mjs — FocusWitness 静态发布包的本地服务，只用 Node 内建模块。
// 仅服务 dist/，固定 127.0.0.1:4173，不对外网监听；禁止目录穿越。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".csv", "text/csv; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".wasm", "application/wasm"],
  [".ico", "image/x-icon"],
]);

export function resolveInside(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const clean = decoded.replace(/\\/g, "/");
  const resolved = path.resolve(root, "." + clean);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export function createStaticServer(root) {
  const rootAbs = path.resolve(root);
  return createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
        res.end("Method Not Allowed");
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      let file = resolveInside(rootAbs, url.pathname);
      if (file === null) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
      if (existsSync(file) && statSync(file).isDirectory()) {
        file = path.join(file, "index.html");
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type = MIME.get(ext) || "application/octet-stream";
      const data = await readFile(file);
      res.writeHead(200, {
        "content-type": type,
        "content-length": data.length,
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = "dist";
  const port = 4173;
  const host = "127.0.0.1";
  const rootAbs = path.resolve(root);
  if (!existsSync(rootAbs) || !statSync(rootAbs).isDirectory()) {
    console.error(`serve: root 目录不存在或不是目录：${rootAbs}（请先执行 npm run build 生成 dist）`);
    process.exit(1);
  }
  const server = createStaticServer(rootAbs);
  server.listen(port, host, () => {
    console.log(`FocusWitness serving ${rootAbs} at http://${host}:${port}/`);
  });
}
