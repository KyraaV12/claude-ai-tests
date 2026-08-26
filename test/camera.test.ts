import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, follow, worldToScreen, screenToWorld, visibleChunks } from '../src/world/camera.ts';

const VIEWPORT = { width: 800, height: 600 };

test('le point visé par la caméra tombe au centre de l écran', () => {
  const camera = createCamera(1234, -567);
  const point = worldToScreen(camera, VIEWPORT, 1234, -567);

  assert.deepEqual(point, { x: 400, y: 300 });
});

test('écran et monde sont réciproques', () => {
  const camera = createCamera(-900, 320, 1.75);
  for (const [x, y] of [[0, 0], [800, 600], [123, 456]] as const) {
    const world = screenToWorld(camera, VIEWPORT, x, y);
    const back = worldToScreen(camera, VIEWPORT, world.x, world.y);
    assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9, `${x},${y} -> ${back.x},${back.y}`);
  }
});

test('l échelle dilate les distances à l écran', () => {
  const near = worldToScreen(createCamera(0, 0, 1), VIEWPORT, 100, 0);
  const far = worldToScreen(createCamera(0, 0, 2), VIEWPORT, 100, 0);

  // À échelle 2, une unité du monde occupe deux fois moins de pixels.
  assert.equal(near.x - 400, 100);
  assert.equal(far.x - 400, 50);
});

test('la caméra se rapproche de sa cible sans la dépasser', () => {
  const camera = createCamera(0, 0);
  follow(camera, 100, 0, 1 / 60);

  assert.ok(camera.x > 0 && camera.x < 100, `x = ${camera.x}`);
});

test('le suivi ne dépend pas du découpage des images', () => {
  // Une seconde de rattrapage doit produire le même résultat, qu'on la livre
  // d'un bloc ou en soixante fois : sinon la caméra irait plus vite sur un
  // écran rapide.
  const wholeSecond = createCamera(0, 0);
  follow(wholeSecond, 100, 0, 1);

  const sixtyFrames = createCamera(0, 0);
  for (let i = 0; i < 60; i++) follow(sixtyFrames, 100, 0, 1 / 60);

  assert.ok(Math.abs(wholeSecond.x - sixtyFrames.x) < 1e-9, `${wholeSecond.x} vs ${sixtyFrames.x}`);
});

test('un temps écoulé nul laisse la caméra immobile', () => {
  const camera = createCamera(10, 20);
  follow(camera, 999, 999, 0);

  assert.deepEqual({ x: camera.x, y: camera.y }, { x: 10, y: 20 });
});

test('les morceaux visibles couvrent les quatre coins de l écran', () => {
  const camera = createCamera(0, 0);
  const chunkSize = 320;
  const range = visibleChunks(camera, VIEWPORT, chunkSize, 0);

  for (const [sx, sy] of [[0, 0], [VIEWPORT.width, 0], [0, VIEWPORT.height], [VIEWPORT.width, VIEWPORT.height]] as const) {
    const world = screenToWorld(camera, VIEWPORT, sx, sy);
    const cx = Math.floor(world.x / chunkSize);
    const cy = Math.floor(world.y / chunkSize);
    assert.ok(cx >= range.minX && cx <= range.maxX, `coin en x hors plage : ${cx}`);
    assert.ok(cy >= range.minY && cy <= range.maxY, `coin en y hors plage : ${cy}`);
  }
});

test('la marge élargit la plage sans la décentrer', () => {
  const camera = createCamera(0, 0);
  const tight = visibleChunks(camera, VIEWPORT, 320, 0);
  const loose = visibleChunks(camera, VIEWPORT, 320, 2);

  assert.equal(loose.minX, tight.minX - 2);
  assert.equal(loose.maxX, tight.maxX + 2);
  assert.equal(loose.minY, tight.minY - 2);
  assert.equal(loose.maxY, tight.maxY + 2);
});

test('dézoomer fait entrer plus de morceaux dans le champ', () => {
  const range = (scale: number) => {
    const r = visibleChunks(createCamera(0, 0, scale), VIEWPORT, 320, 0);
    return (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
  };
  assert.ok(range(3) > range(1), 'une échelle plus grande doit montrer plus de monde');
});
