// Eenvoudige Node-server voor lokaal testen of hosting buiten Vercel (Node 18+).
// Start: ANTHROPIC_API_KEY=... node server.js  ->  http://localhost:3000
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const chat = require("./api/chat.js");
const PORT = process.env.PORT || 3000;
const page = fs.readFileSync(path.join(__dirname, "public", "index.html"));
const pageGz = zlib.gzipSync(page);
http.createServer((req, res) => {
  if (req.url.startsWith("/api/chat")) {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 100000) req.destroy(); });
    req.on("end", () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      res.status = c => { res.statusCode = c; return res; };
      res.json = o => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
      chat(req, res).catch(e => { console.error(e); if (!res.headersSent) res.status(500).json({ code: "upstream_error" }); else res.end(); });
    });
    return;
  }
  if (req.url === "/" || req.url.startsWith("/?") || req.url === "/index.html") {
    const gz = /gzip/.test(req.headers["accept-encoding"] || "");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...(gz ? { "Content-Encoding": "gzip" } : {}) });
    res.end(gz ? pageGz : page); return;
  }
  res.writeHead(404); res.end("Niet gevonden");
}).listen(PORT, () => console.log(`Handleiding draait op http://localhost:${PORT}`));
