import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.ts';
import { createStores, transformAt } from '../src/core/components.ts';
import type { Stores } from '../src/core/components.ts';
import { resolveCollisions } from '../src/systems/collision.ts';
import type { Bounds } from '../src/systems/movement.ts';

const BOUNDS: Bounds = { width: 1000, height: 600 };

function scene(): { world: World; stores: Stores } {
  const world = new World();
  return { world, stores: createStores(world) };
}

function put(
  world: World,
  stores: Stores,
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius = 10,
  mass = 1,
): number {
  const entity = world.create();
  stores.transform.set(entity, transformAt(x, y));
  stores.velocity.set(entity, { x: vx, y: vy });
  stores.body.set(entity, { radius, mass });
  return entity;
}

function momentum(stores: Stores): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const [entity, velocity] of stores.velocity.entries()) {
    const mass = stores.body.get(entity)?.mass ?? 0;
    x += velocity.x * mass;
    y += velocity.y * mass;
  }
  return { x, y };
}

test('deux corps éloignés ne s influencent pas', () => {
  const { world, stores } = scene();
  const a = put(world, stores, 100, 100, 5, 0);
  put(world, stores, 400, 100, 0, 0);

  resolveCollisions(stores, BOUNDS);

  assert.deepEqual(stores.velocity.get(a), { x: 5, y: 0 });
});

test('un choc conserve la quantité de mouvement', () => {
  const { world, stores } = scene();
  put(world, stores, 100, 100, 40, 0, 10, 2);
  put(world, stores, 115, 100, -10, 0, 10, 3);

  const before = momentum(stores);
  resolveCollisions(stores, BOUNDS);
  const after = momentum(stores);

  assert.ok(Math.abs(after.x - before.x) < 1e-9, `px ${before.x} -> ${after.x}`);
  assert.ok(Math.abs(after.y - before.y) < 1e-9, `py ${before.y} -> ${after.y}`);
});

test('un choc frontal inverse bien les vitesses', () => {
  const { world, stores } = scene();
  const a = put(world, stores, 100, 100, 20, 0, 10, 1);
  const b = put(world, stores, 118, 100, -20, 0, 10, 1);

  resolveCollisions(stores, BOUNDS);

  assert.ok(stores.velocity.get(a)!.x < 0, 'a doit repartir vers la gauche');
  assert.ok(stores.velocity.get(b)!.x > 0, 'b doit repartir vers la droite');
});

test('le chevauchement est résorbé', () => {
  const { world, stores } = scene();
  const a = put(world, stores, 100, 100, 0, 0, 10, 1);
  const b = put(world, stores, 105, 100, 0, 0, 10, 1);

  resolveCollisions(stores, BOUNDS);

  const ta = stores.transform.get(a)!;
  const tb = stores.transform.get(b)!;
  assert.ok(Math.hypot(tb.x - ta.x, tb.y - ta.y) >= 20 - 1e-9, 'les corps doivent être décollés');
});

test('un corps lourd est moins déplacé qu un léger', () => {
  const { world, stores } = scene();
  const heavy = put(world, stores, 100, 100, 0, 0, 10, 100);
  const light = put(world, stores, 105, 100, 0, 0, 10, 1);

  resolveCollisions(stores, BOUNDS);

  const movedHeavy = Math.abs(stores.transform.get(heavy)!.x - 100);
  const movedLight = Math.abs(stores.transform.get(light)!.x - 105);
  assert.ok(movedLight > movedHeavy * 10, `léger ${movedLight} vs lourd ${movedHeavy}`);
});

test('deux corps qui s éloignent déjà ne sont pas rappelés', () => {
  const { world, stores } = scene();
  const a = put(world, stores, 100, 100, -30, 0, 10, 1);
  const b = put(world, stores, 115, 100, 30, 0, 10, 1);

  resolveCollisions(stores, BOUNDS);

  // Le chevauchement est corrigé, mais les vitesses ne doivent pas s'inverser.
  assert.equal(stores.velocity.get(a)!.x, -30);
  assert.equal(stores.velocity.get(b)!.x, 30);
});

test('la collision voit à travers les bords repliés', () => {
  const { world, stores } = scene();
  const a = put(world, stores, 5, 300, -10, 0, 10, 1);
  const b = put(world, stores, BOUNDS.width - 5, 300, 10, 0, 10, 1);

  resolveCollisions(stores, BOUNDS);

  // Ils sont à 10 unités l'un de l'autre en passant par le bord, donc en contact.
  assert.ok(stores.velocity.get(a)!.x > -10, 'a doit avoir été freiné ou repoussé');
  assert.ok(stores.velocity.get(b)!.x < 10, 'b doit avoir été freiné ou repoussé');
});

test('des corps exactement superposés se séparent sans produire de NaN', () => {
  const { world, stores } = scene();
  const a = put(world, stores, 200, 200, 0, 0, 10, 1);
  const b = put(world, stores, 200, 200, 0, 0, 10, 1);

  resolveCollisions(stores, BOUNDS);

  for (const entity of [a, b]) {
    const t = stores.transform.get(entity)!;
    const v = stores.velocity.get(entity)!;
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y), 'position non finie');
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y), 'vitesse non finie');
  }
  const ta = stores.transform.get(a)!;
  const tb = stores.transform.get(b)!;
  assert.ok(Math.hypot(tb.x - ta.x, tb.y - ta.y) > 0, 'ils doivent avoir été séparés');
});
