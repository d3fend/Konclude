#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..");
const port = Number(process.env.PORT || 8000);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".ofn", "text/plain; charset=utf-8"],
  [".rdf", "application/rdf+xml"],
  [".xml", "application/xml"],
]);

function send(res, status, body) {
  res.statusCode = status;
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  const requestPath = urlPath === "/" ? "/wasm/web/index.html" : urlPath;
  const filePath = path.normalize(path.join(rootDir, requestPath));

  if (!filePath.startsWith(rootDir)) {
    return send(res, 403, "Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, "Not found");
    }

    const ext = path.extname(filePath);
    const type = contentTypes.get(ext) || "application/octet-stream";

    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", type);
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`COOP/COEP server (repo root) listening on http://localhost:${port}`);
});
