// Tiny static file server for previewing a generated output folder.
// Usage: node server/static-preview.js  (serves PREVIEW_DIR on PREVIEW_PORT)
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(process.env.PREVIEW_DIR || path.join(__dirname, '..', 'output', '_eng-lead-pro-new'));
const PORT = process.env.PREVIEW_PORT || 4599;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff' };

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(DIR, '.' + (p.startsWith('/') ? p : '/' + p));
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`static preview on http://localhost:${PORT} (serving ${DIR})`));
