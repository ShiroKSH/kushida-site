const { createServer, request: proxyRequest } = require("node:http");
const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const next = require("next");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const dev = process.env.NODE_ENV !== "production";
const hostname = argValue("--hostname") || process.env.HOSTNAME || "0.0.0.0";
const port = Number(argValue("--port") || process.env.PORT || process.env.SERVER_PORT || 3000);
const ogannesPort = Number(process.env.OGANNES_PORT || port + 1);
const ogannesDir = path.join(__dirname, "ogannes");
const ogannesDbPath = path.join(ogannesDir, "data", "study-db.json");
const accessCookie = "study_access_sid";
const adminSeenCookie = "ogannes_admin_seen";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      }),
  );
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (forwarded || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

function hasOgannesAccess(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[accessCookie]) return true;
  if (!existsSync(ogannesDbPath)) return false;
  try {
    const db = JSON.parse(readFileSync(ogannesDbPath, "utf8"));
    const ip = clientIp(req);
    return Array.isArray(db.accessIps) && db.accessIps.some((item) => item.ip === ip);
  } catch {
    return false;
  }
}

function isOgannesAdmin(req) {
  const cookies = parseCookies(req.headers.cookie);
  return Boolean(cookies[adminSeenCookie] || cookies.study_admin_sid);
}

function shouldProtectMain(req, pathname) {
  if (pathname.startsWith("/ogannes")) return false;
  if (pathname.startsWith("/_next/")) return false;
  if (pathname === "/favicon.ico" || pathname === "/icon.png" || pathname === "/apple-touch-icon.png") return false;
  return hasOgannesAccess(req) && !isOgannesAdmin(req);
}

function sendWrongSite(res) {
  const body = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Не тот вход</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1514;color:#fff;font:18px/1.5 system-ui,sans-serif}
main{max-width:560px;padding:28px;text-align:center}
a{color:#7df7d5;font-weight:800}
</style>
</head>
<body><main><h1>Вы ошиблись</h1><p>Вам на <a href="/ogannes">kushida.tech/ogannes</a>.</p></main></body>
</html>`;
  res.writeHead(403, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function appendAdminSeenCookie(headers) {
  const marker = `${adminSeenCookie}=1; Path=/; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`;
  const existing = headers["set-cookie"];
  if (!existing) headers["set-cookie"] = marker;
  else if (Array.isArray(existing)) headers["set-cookie"] = [...existing, marker];
  else headers["set-cookie"] = [existing, marker];
}

function proxyOgannes(req, res, url) {
  const stripped = url.pathname === "/ogannes" ? "/" : url.pathname.replace(/^\/ogannes/, "") || "/";
  const targetPath = `${stripped}${url.search || ""}`;
  const headers = { ...req.headers, host: req.headers.host || `localhost:${port}` };
  headers["x-forwarded-for"] = clientIp(req);
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "http";

  const upstream = proxyRequest(
    {
      hostname: "127.0.0.1",
      port: ogannesPort,
      path: targetPath,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      const adminLoginPath = stripped === "/api/admin/login" || stripped === "/api/admin/setup";
      if (adminLoginPath && proxyRes.statusCode && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
        appendAdminSeenCookie(responseHeaders);
      }
      res.writeHead(proxyRes.statusCode || 502, responseHeaders);
      proxyRes.pipe(res);
    },
  );

  upstream.on("error", () => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Ogannes service is starting. Refresh in a few seconds.");
  });
  req.pipe(upstream);
}

function startOgannes() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ogannesDir,
    env: { ...process.env, PORT: String(ogannesPort) },
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  child.on("exit", (code, signal) => {
    console.error(`Ogannes service exited: ${code ?? signal}`);
    process.exitCode = 1;
  });
  process.on("exit", () => child.kill());
  process.on("SIGINT", () => {
    child.kill();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    child.kill();
    process.exit(143);
  });
}

startOgannes();

app.prepare().then(() => {
  createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${port}`}`);
    if (url.pathname.startsWith("/ogannes")) {
      proxyOgannes(req, res, url);
      return;
    }
    if (shouldProtectMain(req, url.pathname)) {
      sendWrongSite(res);
      return;
    }
    handle(req, res);
  }).listen(port, hostname, () => {
    console.log(`Main site: http://localhost:${port}`);
    console.log(`Ogannes: http://localhost:${port}/ogannes`);
  });
});
