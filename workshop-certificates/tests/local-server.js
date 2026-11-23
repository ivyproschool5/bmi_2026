/* Local test server: serves ../site and exposes Code.gs (running on fake Google services) at /api.
 * Usage: node tests/local-server.js [port]   then open http://localhost:<port>/admin.html */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBackend } = require('./fake-google');

function start(port) {
  const backend = loadBackend();
  backend.sandbox.setup();
  const adminKey = backend.props.ADMIN_KEY;
  const siteDir = path.join(__dirname, '..', 'site');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api') {
      const finish = (out) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(out.content);
      };
      if (req.method === 'GET') {
        return finish(backend.sandbox.doGet({ parameter: Object.fromEntries(url.searchParams) }));
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const type = (req.headers['content-type'] || '').split(';')[0];
        const parameter = type === 'application/x-www-form-urlencoded' ? Object.fromEntries(new URLSearchParams(body)) : {};
        finish(backend.sandbox.doPost({ parameter, postData: { type, contents: body } }));
      });
      return;
    }
    if (url.pathname === '/__dump') {
      const dump = {};
      backend.ss.sheets.forEach((s) => { dump[s.name] = s.data; });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ adminKey, tz: backend.ss.tz, sheets: dump }));
    }
    if (url.pathname === '/config.js') {
      const cfg = fs.readFileSync(path.join(siteDir, 'config.js'), 'utf8')
        .replace("API_URL: ''", `API_URL: 'http://localhost:${port}/api'`);
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(cfg);
    }
    let file = path.normalize(path.join(siteDir, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(siteDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, backend, adminKey })));
}

if (require.main === module) {
  const port = Number(process.argv[2] || 8787);
  start(port).then(({ adminKey }) => {
    console.log(`Local server on http://localhost:${port}  (admin key: ${adminKey})`);
  });
}

module.exports = { start };
