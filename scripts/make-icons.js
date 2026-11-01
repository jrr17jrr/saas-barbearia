// Gera os ícones PNG do PWA a partir de icons/icon.svg usando o Chrome headless do puppeteer.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

function findChrome() {
  const base = join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(base)) throw new Error('Chrome do puppeteer não encontrado');
  const v = readdirSync(base).sort().pop();
  for (const p of ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
    if (existsSync(join(base, v, p))) return join(base, v, p);
  }
  throw new Error('executável do Chrome não encontrado');
}
export { findChrome };

if (import.meta.url.endsWith('make-icons.js') && process.argv[1]?.endsWith('make-icons.js')) {
  const svg = readFileSync('icons/icon.svg', 'utf8');
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  const page = await browser.newPage();
  const jobs = [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 0.12], ['apple-touch-icon.png', 180, 0.08], ['favicon-32.png', 32, 0]];
  for (const [name, size, pad] of jobs) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const inner = Math.round(size * (1 - pad * 2));
    const html = `<html><body style="margin:0;background:${pad ? '#0b1220' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `).replace(pad ? 'rx="112"' : '__', pad ? 'rx="0"' : '__')}</div></body></html>`;
    await page.setContent(html);
    writeFileSync(join('icons', name), await page.screenshot({ omitBackground: !pad, type: 'png' }));
    console.log('ok', name);
  }
  await browser.close();
}
