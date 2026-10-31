// Static checks: references, imports, syntax, leftover mock data, and getElementById targets.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const results = [];
const check = (name, pass, info = "") => { results.push(pass); if (!pass || process.env.VERBOSE) console.log(`${pass ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`); };
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name.startsWith(".") || e.name === "node_modules" || e.name === "supabase" || e.name === "tests" ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = walk(root);
const html = files.filter(f => f.endsWith(".html")), js = files.filter(f => f.endsWith(".js"));
const resolveRef = (from, ref) => ref.startsWith("/") ? path.join(root, ref) : path.join(path.dirname(from), ref);
const rel = f => path.relative(root, f).replace(/\\/g, "/");

for (const f of html) {
  const src = fs.readFileSync(f, "utf8");
  for (const [, ref] of src.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    if (/^(https?:|mailto:|data:|about:|javascript:)/.test(ref) || ref === "#") continue;
    let target = resolveRef(f, ref);
    if (ref.endsWith("/")) target = path.join(target, "index.html");
    check(`${rel(f)} → ${ref}`, fs.existsSync(target));
  }
}
for (const f of js) {
  const src = fs.readFileSync(f, "utf8");
  for (const [, ref] of src.matchAll(/(?:import|from)\s*["'](\.{1,2}\/[^"']+|\/[^"']+)["']/g)) check(`${rel(f)} imports ${ref}`, fs.existsSync(resolveRef(f, ref)));
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); check(`syntax ${rel(f)}`, true); }
  catch (e) { check(`syntax ${rel(f)}`, false, String(e.stderr).split("\n").slice(0, 4).join(" ")); }
  check(`no broken regex in ${rel(f)}`, !/[^"'`]:\/\/\/[.,)]/.test(src));
  check(`no localStorage mock data in ${rel(f)}`, !/localStorage\.(get|set)Item\("barberSite"/.test(src));
}
// IDs used by each page script must exist in its HTML (or be created by the script itself).
for (const f of html) {
  const src = fs.readFileSync(f, "utf8");
  const ids = new Set([...src.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  for (const [, ref] of src.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    if (ref.startsWith("/shared/") || ref === "/menu.js") continue;
    const script = resolveRef(f, ref);
    if (!fs.existsSync(script)) continue;
    const code = fs.readFileSync(script, "utf8");
    const created = new Set([...code.matchAll(/id=\\?["']([A-Za-z][\w-]*)\\?["']/g), ...code.matchAll(/\.id=["']([\w-]+)["']/g)].map(m => m[1]));
    const used = new Set([...code.matchAll(/(?:getElementById\(|\$\()["']([A-Za-z][\w-]*)["']\)/g)].map(m => m[1]));
    for (const id of used) check(`${rel(f)}: #${id} exists`, ids.has(id) || created.has(id));
  }
}
const mock = ["Ricardo 👋", "João Pedro", "R$ 980", "R$ 450", "Lucas Ferreira", "Prévia visual: o salvamento"];
for (const f of [...html, ...js]) { const s = fs.readFileSync(f, "utf8"); for (const m of mock) check(`no mock "${m}" in ${rel(f)}`, !s.includes(m)); }
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
for (const i of manifest.icons) check(`manifest icon ${i.src}`, fs.existsSync(path.join(root, i.src)));
const failed = results.filter(x => !x).length;
console.log(`static: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
