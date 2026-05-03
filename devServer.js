const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// 🔐 환경변수에서 Claude API 키 가져오기
const ANTHROPIC_API_KEY = "api키 넣으세욤"

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

  // 🔥 Claude API 프록시
  if (req.url === '/api/claude' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        if (!ANTHROPIC_API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: { message: 'ANTHROPIC_API_KEY 환경변수가 없습니다.' }
          }));
          return;
        }

        const { prompt } = JSON.parse(body);

        // 🔥 Claude 호출
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
           model: "claude-haiku-4-5-20251001",
            max_tokens: 8000,
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ]
          })
        });

        const data = await response.text();

        res.writeHead(response.status, {
          'Content-Type': 'application/json'
        });
        res.end(data);

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: err.message }
        }));
      }
    });

    return;
  }

  // 📄 기본 라우팅
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

    // 🔐 SharedArrayBuffer 대응 (EyeDID 필요)
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

    res.setHeader('Content-Type', ct);
    res.writeHead(200);
    res.end(data);
  });

}).listen(PORT, () => {
  console.log(`\n눈길 EyeDID Dev Server`);
  console.log(`http://localhost:${PORT}`);
  console.log(`COOP: same-origin / COEP: credentialless\n`);
});