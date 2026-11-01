// Servidor estático mínimo para testar o build (dist/) localmente: npm run serve
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

export function serve(dir = 'dist', port = 4173) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(dir, p));
    if (!file.startsWith(normalize(dir))) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); res.end(existsSync(join(dir, '404.html')) ? readFileSync(join(dir, '404.html')) : 'not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

if (process.argv[1]?.endsWith('serve.js')) {
  const { build } = await import('./build.js');
  build();
  await serve();
  console.log('http://127.0.0.1:4173');
}
