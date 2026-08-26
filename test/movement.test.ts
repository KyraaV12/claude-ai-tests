import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.ts';
import { createStores, transformAt } from '../src/core/components.ts';
import type { Stores } from '../src/core/components.ts';
import { integrate, applyControl } from '../src/systems/movement.ts';

function scene(): { world: World; stores: Stores } {
  const world = new World();
  return { world, stores: createStores(world) };
}

test('la position avance du produit vitesse × temps', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(10, 10));
  stores.velocity.set(entity, { x: 60, y: 0 });

  integrate(stores, 0.5);

  assert.equal(stores.transform.get(entity)?.x, 40);
});

test('le monde est ouvert : rien n arrête une entité qui s éloigne', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(0, 0));
  stores.velocity.set(entity, { x: 1000, y: 0 });

  for (let i = 0; i < 600; i++) integrate(stores, 1 / 60);

  assert.ok(stores.transform.get(entity)!.x > 9000, 'aucune bordure ne doit la replier');
});

test('la position précédente suit le pas, pour que le rendu interpole juste', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(98, 50));
  stores.velocity.set(entity, { x: 40, y: 0 });

  integrate(stores, 0.1);

  const transform = stores.transform.get(entity)!;
  assert.equal(transform.previousX, 98);
  assert.equal(transform.x, 102);
});

test('une entité sans vitesse ne bouge pas', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(30, 30));

  integrate(stores, 1);

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
