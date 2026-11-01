// Validações estáticas sem dependências externas:
//  1. sintaxe de todos os .js (node --check)
//  2. referências locais em HTML (scripts/estilos/imagens) existem
//  3. nenhuma chave secreta no código versionado
//  4. páginas do painel com tags de PWA, idioma e viewport
//  5. imports de módulos locais existem
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', '.vercel', 'paginas', 'test-results']);
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (SKIP.has(n)) continue;
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p) : files.push(p);
  }
})(root);

const errors = [];
const rel = p => relative(root, p).replace(/\\/g, '/');

// 1. sintaxe JS
for (const f of files.filter(f => extname(f) === '.js')) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { errors.push(`sintaxe: ${rel(f)}\n${e.stderr?.toString().split('\n').slice(0, 4).join('\n')}`); }
}

// 2/4. HTML
const PANEL = ['dashboard', 'agendamentos', 'clientes', 'profissionais', 'servicos', 'horarios', 'lucros', 'chatbot-config', 'editar-link', 'configuracoes', 'dev', 'login', 'redefinir-senha'];
for (const f of files.filter(f => extname(f) === '.html')) {
  const html = readFileSync(f, 'utf8');
  const r = rel(f);
  if (!/<html lang="pt-BR">/i.test(html)) errors.push(`html sem lang pt-BR: ${r}`);
  if (!/name="viewport"/.test(html) && !/http-equiv="refresh"/.test(html)) errors.push(`html sem viewport: ${r}`);
  if (PANEL.some(p => r === `${p}/index.html`) && !html.includes('<!-- pwa-head -->')) errors.push(`página do painel sem <!-- pwa-head -->: ${r}`);
  for (const m of html.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|tel:|javascript:|data:|\/\/)/.test(u) || u === '#' || u.includes('${')) continue;
    let target = u.startsWith('/') ? join(root, decodeURIComponent(u)) : join(dirname(f), decodeURIComponent(u));
    if (u.endsWith('/')) target = join(target, 'index.html');
    if (!existsSync(target)) errors.push(`referência quebrada em ${r}: ${u}`);
  }
}

// 3. segredos
const SECRET_PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'chave secreta Supabase (sb_secret_)'],
  [/service_role["']?\s*[:=]\s*["']eyJ/, 'service_role JWT'],
  [/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJ[^"']*c2VydmljZV9yb2xl/, 'JWT com role service_role'],
  [/VAPID_PRIVATE_KEY\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/, 'chave VAPID privada'],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, 'chave privada PEM'],
];
for (const f of files.filter(f => /\.(js|ts|html|json|sql|toml|md|css)$/.test(f) && !f.endsWith('package-lock.json'))) {
  const txt = readFileSync(f, 'utf8');
  for (const [re, label] of SECRET_PATTERNS) if (re.test(txt)) errors.push(`possível segredo (${label}) em ${rel(f)}`);
}

// 5. imports locais
for (const f of files.filter(f => extname(f) === '.js' && !rel(f).startsWith('scripts/') && !rel(f).startsWith('tests/'))) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/(?:import|from)\s*["'](\/[^"']+)["']/g)) {
    if (!existsSync(join(root, m[1]))) errors.push(`import inexistente em ${rel(f)}: ${m[1]}`);
  }
}

if (errors.length) {
  console.error(`lint: ${errors.length} problema(s)\n` + errors.map(e => ' - ' + e).join('\n'));
  process.exit(1);
}
console.log(`lint ok: ${files.filter(f => extname(f) === '.js').length} JS, ${files.filter(f => extname(f) === '.html').length} HTML verificados, nenhum segredo encontrado`);
