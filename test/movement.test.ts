import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.ts';
import { createStores, transformAt } from '../src/core/components.ts';
import type { Stores } from '../src/core/components.ts';
import { wrap, integrate, applyControl } from '../src/systems/movement.ts';
import type { Bounds } from '../src/systems/movement.ts';

const BOUNDS: Bounds = { width: 100, height: 100 };

function scene(): { world: World; stores: Stores } {
  const world = new World();
  return { world, stores: createStores(world) };
}

test('wrap ramène dans les bornes, y compris pour les négatifs', () => {
  assert.equal(wrap(10, 100), 10);
  assert.equal(wrap(100, 100), 0);
  assert.equal(wrap(-1, 100), 99);
  assert.equal(wrap(-101, 100), 99);
  assert.equal(wrap(250, 100), 50);
});

test('la position avance du produit vitesse × temps', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(10, 10));
  stores.velocity.set(entity, { x: 60, y: 0 });

  integrate(stores, 0.5, BOUNDS);

  assert.equal(stores.transform.get(entity)?.x, 40);
});

test('franchir un bord garde le déplacement interpolé continu', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(98, 50));
  stores.velocity.set(entity, { x: 40, y: 0 });

  integrate(stores, 0.1, BOUNDS); // 98 → 102 → replié à 2

  const transform = stores.transform.get(entity)!;
  assert.equal(transform.x, 2);
  // Sans le décalage de la position précédente, on aurait 98 ici, et le rendu
  // ferait traverser tout l'écran à l'entité sur une seule image.
  assert.equal(transform.previousX, -2);
  assert.equal(transform.x - transform.previousX, 4, 'le pas interpolé doit valoir le déplacement réel');
});

test('une entité sans vitesse ne bouge pas', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(30, 30));

  integrate(stores, 1, BOUNDS);

  assert.deepEqual(stores.transform.get(entity), transformAt(30, 30));
});

test('la vitesse est bornée par maxSpeed', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.velocity.set(entity, { x: 0, y: 0 });
  stores.controlled.set(entity, { acceleration: 10000, maxSpeed: 200, damping: 2 });

  applyControl(stores, { x: 1, y: 0 }, 1);

  const velocity = stores.velocity.get(entity)!;
  assert.equal(Math.round(Math.hypot(velocity.x, velocity.y)), 200);
});

test('sans direction demandée, la vitesse retombe vers zéro', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.velocity.set(entity, { x: 100, y: 0 });
  stores.controlled.set(entity, { acceleration: 500, maxSpeed: 200, damping: 2 });

  for (let i = 0; i < 60; i++) applyControl(stores, { x: 0, y: 0 }, 1 / 60);

  assert.ok(Math.abs(stores.velocity.get(entity)!.x) < 20);
});

test('le freinage ne renvoie jamais l entité en arrière', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.velocity.set(entity, { x: 100, y: 0 });
  // damping × dt > 1 : le facteur naïf 1 - damping·dt deviendrait négatif.
  stores.controlled.set(entity, { acceleration: 500, maxSpeed: 200, damping: 50 });

  applyControl(stores, { x: 0, y: 0 }, 0.1);

  assert.equal(stores.velocity.get(entity)!.x, 0);
});
