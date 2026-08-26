import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, WORLD_BOUNDS } from '../src/core/simulation.ts';
import { World } from '../src/core/world.ts';
import { createStores, transformAt } from '../src/core/components.ts';
import type { Stores } from '../src/core/components.ts';
import {
  componentsOf,
  describeEntity,
  findNearest,
  listEntities,
  parseFieldInput,
  setField,
  toWorldPoint,
} from '../src/tools/inspect.ts';

function scene(): { world: World; stores: Stores } {
  const world = new World();
  return { world, stores: createStores(world) };
}

test('la liste des entités suit l ordre de création', () => {
  const { world } = scene();
  const a = world.create();
  const b = world.create();
  assert.deepEqual(listEntities(world), [a, b]);
});

test('une entité détruite disparaît de la liste', () => {
  const { world } = scene();
  const a = world.create();
  const b = world.create();
  world.destroy(a);
  assert.deepEqual(listEntities(world), [b]);
});

test('componentsOf ne nomme que les composants réellement portés', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(0, 0));
  stores.body.set(entity, { radius: 5, mass: 1 });

  assert.deepEqual(componentsOf(stores, entity), ['transform', 'body']);
});

test('describeEntity ne retient que les champs numériques', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.body.set(entity, { radius: 5, mass: 2 });

  const [body] = describeEntity(stores, entity);
  assert.equal(body?.name, 'body');
  assert.deepEqual(body?.fields, [
    { name: 'radius', value: 5 },
    { name: 'mass', value: 2 },
  ]);
});

test('setField écrit la valeur dans le composant vivant', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(10, 10));

  assert.equal(setField(stores, entity, 'transform', 'x', 42), true);
  assert.equal(stores.transform.get(entity)?.x, 42);
});

test('setField refuse une valeur non finie', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(10, 10));

  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(setField(stores, entity, 'transform', 'x', bad), false, `${bad} accepté`);
  }
  // Un NaN glissé dans une position contaminerait tout au pas suivant.
  assert.equal(stores.transform.get(entity)?.x, 10);
});

test('setField refuse un champ ou un composant inconnu', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(0, 0));

  assert.equal(setField(stores, entity, 'transform', 'inconnu', 1), false);
  assert.equal(setField(stores, entity, 'inventaire', 'x', 1), false);
  assert.equal(setField(stores, 999, 'transform', 'x', 1), false);
});

test('findNearest désigne l entité sous le point', () => {
  const { world, stores } = scene();
  const near = world.create();
  stores.transform.set(near, transformAt(100, 100));
  stores.body.set(near, { radius: 10, mass: 1 });
  const far = world.create();
  stores.transform.set(far, transformAt(500, 500));
  stores.body.set(far, { radius: 10, mass: 1 });

  assert.equal(findNearest(stores, 105, 100, WORLD_BOUNDS), near);
});

test('findNearest ne renvoie rien quand le point est loin de tout', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(100, 100));
  stores.body.set(entity, { radius: 10, mass: 1 });

  assert.equal(findNearest(stores, 500, 500, WORLD_BOUNDS), null);
});

test('findNearest voit à travers les bords repliés', () => {
  const { world, stores } = scene();
  const entity = world.create();
  stores.transform.set(entity, transformAt(5, 300));
  stores.body.set(entity, { radius: 10, mass: 1 });

  // Cliquer juste avant le bord droit doit désigner ce qu'on voit apparaître.
  assert.equal(findNearest(stores, WORLD_BOUNDS.width - 5, 300, WORLD_BOUNDS), entity);
});

test('findNearest préfère la plus proche quand deux se chevauchent', () => {
  const { world, stores } = scene();
  const a = world.create();
  stores.transform.set(a, transformAt(100, 100));
  stores.body.set(a, { radius: 10, mass: 1 });
  const b = world.create();
  stores.transform.set(b, transformAt(112, 100));
  stores.body.set(b, { radius: 10, mass: 1 });

  assert.equal(findNearest(stores, 111, 100, WORLD_BOUNDS), b);
});

test('toWorldPoint annule la mise à l échelle et le centrage', () => {
  // Canevas plus large que le monde : des bandes apparaissent à gauche et à droite.
  const rect = { left: 0, top: 0, width: 2000, height: 600 };
  const centre = toWorldPoint(1000, 300, rect, WORLD_BOUNDS);

  assert.ok(Math.abs(centre.x - WORLD_BOUNDS.width / 2) < 1e-9, `x = ${centre.x}`);
  assert.ok(Math.abs(centre.y - WORLD_BOUNDS.height / 2) < 1e-9, `y = ${centre.y}`);
});

test('toWorldPoint tient compte de la position du canevas dans la page', () => {
  const rect = { left: 40, top: 20, width: 1000, height: 600 };
  const point = toWorldPoint(40, 20, rect, WORLD_BOUNDS);

  assert.ok(Math.abs(point.x) < 1e-9 && Math.abs(point.y) < 1e-9, `${point.x}, ${point.y}`);
});

test('l inspecteur voit toutes les entités d une simulation réelle', () => {
  const simulation = new Simulation(1, WORLD_BOUNDS);
  const entities = listEntities(simulation.world);

  assert.equal(entities.length, 25);
  assert.deepEqual(componentsOf(simulation.stores, entities[0]!), [
    'transform',
    'velocity',
    'body',
    'sprite',
    'controlled',
  ]);
});

test('un champ vidé pour être retapé n écrit rien', () => {
  // Number('') vaut 0 : sans distinction, effacer un champ mettrait la valeur à zéro.
  assert.deepEqual(parseFieldInput(''), { kind: 'empty' });
  assert.deepEqual(parseFieldInput('   '), { kind: 'empty' });
});

test('une saisie incomplète est refusée, pas convertie', () => {
  for (const raw of ['abc', '-', '1e', '--3', 'NaN']) {
    assert.deepEqual(parseFieldInput(raw), { kind: 'invalid' }, `« ${raw} » mal interprété`);
  }
});

test('une saisie numérique valide est acceptée', () => {
  assert.deepEqual(parseFieldInput('42'), { kind: 'value', value: 42 });
  assert.deepEqual(parseFieldInput(' -3.5 '), { kind: 'value', value: -3.5 });
  assert.deepEqual(parseFieldInput('1e3'), { kind: 'value', value: 1000 });
});
