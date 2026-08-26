import { build } from 'esbuild';
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'dist';

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Les fichiers statiques d'abord : le bundle vient ensuite se poser à côté.
await cp('web', OUT, { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: join(OUT, 'game', 'app.js') });

// Le lanceur et son fil de calcul. Deux entrées séparées plutôt qu'une : le
// worker est chargé par `new Worker(new URL('./worker.js', import.meta.url))`,
// donc il lui faut son propre fichier à côté de la page.
await build({ ...common, entryPoints: ['src/bench/main.ts'], outfile: join(OUT, 'bench', 'app.js') });
await build({ ...common, entryPoints: ['src/bench/worker.ts'], outfile: join(OUT, 'bench', 'worker.js') });

async function walk(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path, label)));
    else out.push([label, (await stat(path)).size]);
  }
  return out;
}

console.log(`\n${OUT}/ :`);
for (const [name, size] of (await walk(OUT)).sort()) {
  console.log(`  ${name.padEnd(28)} ${String(size).padStart(8)} octets`);
}
