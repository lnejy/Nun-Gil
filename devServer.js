const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// ── .env 파일 로드 (dotenv 없이 직접 파싱) ─────────────
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const EYEDID_LICENSE_KEY = process.env.EYEDID_LICENSE_KEY || '';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

http.createServer((req, res) => {

  // 🔑 클라이언트 설정 API — EyeDID 라이선스 키 전달
  if (req.url === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      eyedidLicenseKey: EYEDID_LICENSE_KEY,
    }));
    return;
  }

  let url = req.url.split('?')[0];

  if (url === '/') {
    res.writeHead(302, { Location: '/ui/start.html' });
    res.end();
    return;
  }

  const fp = path.join(__dirname, url);

  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404');
      return;
    }

    const ext = path.extname(fp).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';

    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

    res.setHeader('Content-Type', ct);
    res.writeHead(200);
    res.end(data);
  });

}).listen(PORT, () => {
  console.log(`\n눈길 EyeDID Dev Server`);
  console.log(`http://localhost:${PORT}`);
  console.log(`COOP: same-origin / COEP: credentialless`);
  console.log(`EYEDID_LICENSE_KEY: ${EYEDID_LICENSE_KEY ? '✅ 설정됨' : '❌ 없음 (.env 확인)'}\n`);
});
