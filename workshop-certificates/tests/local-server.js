/* Local test server: serves ../site and runs the real backend (api/_lib/logic.js) on an in-memory store.
 * Usage: node tests/local-server.js [port]   then open http://localhost:<port>/admin.html */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('../api/_lib/logic');
const { memoryStore } = require('../api/_lib/store');

function start(port, opts) {
  opts = opts || {};
  const store = memoryStore();
  const adminKey = opts.adminKey || 'local-test-key';
  const siteDir = path.join(__dirname, '..', 'site');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let fields = Object.fromEntries(url.searchParams);
        if (req.method === 'POST') {
          const form = Object.fromEntries(new URLSearchParams(body));
          if (form.payload) { try { Object.assign(fields, JSON.parse(form.payload)); } catch (e) { /* ignore */ } }
        }
        const out = await handle(store, req.method, fields, { adminKey });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (url.pathname === '/__dump') {
      const dump = {};
      for (const [k, v] of store.data) dump[k] = JSON.parse(v.body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(dump));
    }
    const file = path.normalize(path.join(siteDir, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(siteDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, store, adminKey })));
}

if (require.main === module) {
  const port = Number(process.argv[2] || 8787);
  start(port).then(({ adminKey }) => console.log(`Local server on http://localhost:${port}  (admin key: ${adminKey})`));
}

module.exports = { start };
