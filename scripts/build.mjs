import { build } from 'esbuild';
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'dist';

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Les fichiers statiques d'abord : le bundle vient ensuite se poser à côté.
await cp('web', OUT, { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  outfile: join(OUT, 'game', 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
});

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
