import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, ComponentStore } from '../src/core/world.ts';
import { createStores, transformAt } from '../src/core/components.ts';
import { createRandom } from '../src/core/random.ts';

test('les identifiants d entités ne sont pas réutilisés après destruction', () => {
  const world = new World();
  const first = world.create();
  world.destroy(first);
  const second = world.create();
  assert.notEqual(first, second);
});

test('détruire une entité retire tous ses composants', () => {
  const world = new World();
  const stores = createStores(world);
  const entity = world.create();
  stores.transform.set(entity, transformAt(1, 2));
  stores.velocity.set(entity, { x: 3, y: 4 });

  world.destroy(entity);

  assert.equal(stores.transform.has(entity), false);
  assert.equal(stores.velocity.has(entity), false);
  assert.equal(world.entityCount, 0);
});

test('un aller-retour par instantané rend exactement le même état', () => {
  const world = new World();
  const stores = createStores(world);
  const entity = world.create();
  stores.transform.set(entity, transformAt(10, 20));
  stores.velocity.set(entity, { x: 1, y: -1 });

  const snapshot = world.snapshot();
  const before = JSON.stringify(snapshot);

  stores.transform.set(entity, transformAt(999, 999));
  world.create();
  world.restore(snapshot);

  assert.equal(JSON.stringify(world.snapshot()), before);
  assert.deepEqual(stores.transform.get(entity), transformAt(10, 20));
});

test('un instantané est détaché du monde qui l a produit', () => {
  const world = new World();
  const stores = createStores(world);
  const entity = world.create();
  const transform = stores.transform.set(entity, transformAt(0, 0));

  const snapshot = world.snapshot();
  transform.x = 500; // mutation directe, comme le fait un système

  const captured = snapshot.components['transform']?.[0]?.[1] as { x: number };
  assert.equal(captured.x, 0);
});

test('deux mondes identiques produisent le même JSON', () => {
  const build = (): World => {
    const world = new World();
    const stores = createStores(world);
    const random = createRandom(1234);
    for (let i = 0; i < 5; i++) {
      const entity = world.create();
      stores.transform.set(entity, transformAt(random() * 100, random() * 100));
    }
    return world;
  };
  assert.equal(JSON.stringify(build().snapshot()), JSON.stringify(build().snapshot()));
});

test('restaurer un instantané contenant un stockage inconnu échoue franchement', () => {
  const world = new World();
  createStores(world);
  const snapshot = world.snapshot();
  snapshot.components['inventaire'] = [[1, {}]];
  assert.throws(() => world.restore(snapshot), /inventaire/);
});

test('enregistrer deux fois le même nom de stockage échoue', () => {
  const world = new World();
  world.register(new ComponentStore<number>('doublon'));
  assert.throws(() => world.register(new ComponentStore<number>('doublon')), /doublon/);
});

test('une graine donnée produit toujours la même suite', () => {
  const a = createRandom(42);
  const b = createRandom(42);
  const first = Array.from({ length: 8 }, () => a());
  const second = Array.from({ length: 8 }, () => b());
  assert.deepEqual(first, second);
  assert.ok(first.every((value) => value >= 0 && value < 1));
  assert.notDeepEqual(first, Array.from({ length: 8 }, createRandom(43)));
});
