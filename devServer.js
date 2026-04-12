const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 3000;

const MIME = {
  '.html':'text/html','.js':'application/javascript','.mjs':'application/javascript',
  '.css':'text/css','.json':'application/json','.wasm':'application/wasm',
  '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon',
  '.data':'application/octet-stream','.bin':'application/octet-stream',
};

http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/ui_nungil.html';
  const fp = path.join(__dirname, url);

  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(fp).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';

    // ★ SharedArrayBuffer 필수 헤더
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Content-Type', ct);
    res.writeHead(200);
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n  눈길 EyeDID Dev Server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  COOP: same-origin / COEP: credentialless\n`);
});