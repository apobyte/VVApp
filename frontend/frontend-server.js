/**
 * VVApp frontend static file server (Windows/Linux).
 * Serves the Next.js export from ./site on port 8001.
 *
 * Run: PORT=8001 node frontend-server.js
 * Exe: place vvapp-frontend-win.exe next to the site/ folder, or use embedded assets.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const port = Number(process.env.PORT || 8001);
const host = process.env.HOST || "0.0.0.0";

function resolveSiteRoot() {
  // 1) pkg snapshot assets
  const embedded = path.join(__dirname, "site");
  if (fs.existsSync(embedded)) return embedded;

  // 2) folder next to the .exe
  if (process.pkg) {
    const besideExe = path.join(path.dirname(process.execPath), "site");
    if (fs.existsSync(besideExe)) return besideExe;
  }

  // 3) project out/ during development
  const projectOut = path.join(__dirname, "..", "out");
  if (fs.existsSync(projectOut)) return projectOut;

  return embedded;
}

const siteRoot = resolveSiteRoot();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(root, normalized);
  if (!full.startsWith(root)) return null;
  return full;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  fs.createReadStream(filePath).pipe(res);
}

function tryFile(res, candidates) {
  for (const file of candidates) {
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      sendFile(res, file);
      return true;
    }
  }
  return false;
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let pathname = url.pathname;
    if (pathname === "/") pathname = "/index.html";

    const direct = safeJoin(siteRoot, pathname);
    if (
      tryFile(res, [
        direct,
        direct && `${direct}.html`,
        direct && path.join(direct, "index.html"),
      ])
    ) {
      return;
    }

    // Pretty routes → exported HTML
    if (pathname === "/push" || pathname === "/push/") {
      if (
        tryFile(res, [
          path.join(siteRoot, "push.html"),
          path.join(siteRoot, "push", "index.html"),
        ])
      ) {
        return;
      }
    }

    if (pathname === "/view" || pathname === "/view/") {
      if (
        tryFile(res, [
          path.join(siteRoot, "view.html"),
          path.join(siteRoot, "view", "index.html"),
        ])
      ) {
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error");
  }
});

server.listen(port, host, () => {
  console.log(`VVApp frontend ready`);
  console.log(`  http://${host}:${port}/`);
  console.log(`  site root: ${siteRoot}`);
  console.log(`  signaling expected at ws://<host>:8002/ws`);
});
