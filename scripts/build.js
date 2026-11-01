// Build estático: copia somente arquivos públicos para dist/, injeta as tags de PWA
// e carimba a versão do service worker (cada deploy invalida o cache antigo do PWA).
// Sem dependências: roda no build da Vercel sem npm install.
import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const out = join(root, 'dist');
const EXCLUDE = new Set(['dist', 'node_modules', '.git', '.github', '.vercel', 'supabase', 'tests', 'scripts', 'docs', 'paginas', 'test-results']);
const EXCLUDE_FILES = new Set(['package.json', 'package-lock.json', 'vercel.json', '.gitignore', '.gitattributes', 'README.md', 'teste.css']);

export const PWA_HEAD = [
  '<meta name="theme-color" content="#0b1220">',
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="icon" href="/icons/favicon-32.png" sizes="32x32">',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="BarberSaaS">',
].join('');

function version() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || (() => { try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })();
  return `${new Date().toISOString().slice(0, 10)}-${(sha || Date.now().toString(36)).slice(0, 8)}`;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (dir === root && (EXCLUDE.has(name) || EXCLUDE_FILES.has(name))) continue;
    if (name.startsWith('.') && dir === root) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files); else files.push(p);
  }
  return files;
}

export function build() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const v = version();
  const files = walk(root);
  for (const f of files) {
    const rel = relative(root, f);
    const dest = join(out, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    if (extname(f) === '.html') {
      writeFileSync(dest, readFileSync(f, 'utf8').replace('<!-- pwa-head -->', PWA_HEAD));
    } else if (rel === 'sw.js') {
      writeFileSync(dest, readFileSync(f, 'utf8').replace(/const VERSION = "[^"]*";/, `const VERSION = "${v}";`));
    } else {
      cpSync(f, dest);
    }
  }
  if (!existsSync(join(out, 'dashboard', 'index.html'))) throw new Error('build incompleto');
  console.log(`build ok: ${files.length} arquivos em dist/ (sw ${v})`);
  return { files: files.length, version: v };
}

if (process.argv[1]?.endsWith('build.js')) build();
