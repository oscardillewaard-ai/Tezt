// Draait alle testbestanden na elkaar en stopt met code 1 als er iets faalt.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = ['t-engine', 't-plan', 't-session', 't-midi', 't-songs', 't-sync', 't-compat', 't-layout'];
const only = process.argv.slice(2);
let failed = 0;
for (const f of files.filter(x => !only.length || only.includes(x))){
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, f + '.mjs')], { stdio: 'inherit', timeout: 600000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`-- ${f}: ${ok ? 'ok' : 'MISLUKT'} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
console.log(failed ? `\n${failed} testbestand(en) mislukt.` : '\nAlle testbestanden geslaagd.');
process.exit(failed ? 1 : 0);
