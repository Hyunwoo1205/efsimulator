import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [destination, ...extra] = process.argv.slice(2);
if (!destination || extra.length) throw new Error('Usage: node scripts/export-source.mjs ABSOLUTE_EMPTY_DESTINATION');
const out = resolve(destination);
if (out === root || relative(root, out).startsWith(`..${sep}`) === false) throw new Error('Export destination must be outside the API source tree.');
if (existsSync(out) && readdirSync(out).length) throw new Error('Export destination must be empty; existing work is preserved.');
const excluded = new Set(['.git', 'node_modules', 'dist', '.next', '.vinext', '.wrangler', '.sites-runtime', '.agents', '.codex', 'outputs', 'work', 'prepared', 'coverage']);
const files = [];
function copy(directory, rel = '') {
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    if (excluded.has(entry.name) || ((entry.name.startsWith('.env') || entry.name.startsWith('.dev.vars')) && entry.name !== '.env.example') || entry.name.endsWith('.tsbuildinfo') || entry.name === 'next-env.d.ts') continue;
    const source = resolve(directory, entry.name), name = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new Error(`Refusing special source file: ${name}`);
    if (entry.isDirectory()) {copy(source, name);continue;}
    const bytes = readFileSync(source);
    mkdirSync(dirname(resolve(out, name)),{recursive:true});cpSync(source,resolve(out,name));
    files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}
mkdirSync(out,{recursive:true});copy(root);
const manifest = {kind:'unregistered-sites-source',files,includes_raw_data:false,includes_credentials:false,project_id:JSON.parse(readFileSync(resolve(root,'.openai/hosting.json'))).project_id??null};
writeFileSync(resolve(out,'SOURCE_MANIFEST.json'), JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({directory:out,files:files.length,project_id:manifest.project_id}));
