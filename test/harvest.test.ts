import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, PLAYER } from '../src/core/simulation.ts';
import type { Tick } from '../src/core/simulation.ts';
import { Recorder, replay, compare } from '../src/core/replay.ts';
import { CHUNK_SIZE, generateChunk } from '../src/world/chunk.ts';
import {
  HARVEST_COOLDOWN_STEPS,
  HARVEST_REACH,
  YIELD,
  harvestedKeys,
  nearestProp,
  propKey,
  tryHarvest,
} from '../src/systems/harvest.ts';

const SEED = 20260826;

/** L'entité du joueur local. Son identifiant n'est plus 1 : le décor est créé avant. */
function entityOf(simulation: Simulation): number {
  const entity = simulation.entityOf(PLAYER);
  if (entity === null) throw new Error('le joueur local est introuvable');
  return entity;
}
const IDLE: Tick = [{ player: PLAYER, x: 0, y: 0, build: false, harvest: false }];
const HARVEST: Tick = [{ player: PLAYER, x: 0, y: 0, build: false, harvest: true }];

/** Place le joueur sur un élément de décor et rend ses coordonnées. */
function standOnAProp(simulation: Simulation): { cx: number; cy: number; index: number } {
  for (let cy = -4; cy <= 4; cy++) {
    for (let cx = -4; cx <= 4; cx++) {
      const chunk = generateChunk(SEED, cx, cy);
      if (chunk.props.length === 0) continue;
      const prop = chunk.props[0]!;
      const transform = simulation.stores.transform.get(entityOf(simulation))!;
      transform.x = prop.x;
      transform.y = prop.y;
      return { cx, cy, index: 0 };
    }
  }
  throw new Error('aucun décor trouvé autour du départ');
}

test('la portée tient dans un anneau de morceaux', () => {
  // nearestProp n'explore qu'un anneau ; si la portée dépassait la taille d'un
  // morceau, des éléments proches deviendraient invisibles.
  assert.ok(HARVEST_REACH < CHUNK_SIZE, `portée ${HARVEST_REACH} contre morceau ${CHUNK_SIZE}`);
});

test('récolter enlève l élément et rapporte des blocs', () => {
  const simulation = new Simulation(SEED);
  standOnAProp(simulation);
  const before = simulation.stores.inventory.get(entityOf(simulation))!.blocs;

  simulation.step(HARVEST);

  assert.equal(simulation.lastHarvest?.harvested, true);
  assert.equal(simulation.stores.harvested.size, 1);
  const gained = simulation.lastHarvest?.harvested === true ? simulation.lastHarvest.gained : 0;
  assert.equal(simulation.stores.inventory.get(entityOf(simulation))!.blocs, before + gained);
  assert.ok(Object.values(YIELD).includes(gained), `gain inattendu : ${gained}`);
});

test('le générateur produit toujours l élément récolté', () => {
  // C'est le test qui garde la frontière : récolter n'écrit pas dans le monde
  // dérivé, cela ajoute une exception à sa lecture. Si ce test cassait, le
  // terrain aurait cessé d'être une fonction pure de la graine.
  const simulation = new Simulation(SEED);
  const target = standOnAProp(simulation);
  const before = generateChunk(SEED, target.cx, target.cy).props.length;

  simulation.step(HARVEST);

  assert.equal(generateChunk(SEED, target.cx, target.cy).props.length, before);
  assert.equal(harvestedKeys(simulation.stores).size, 1);
});

test('l élément récolté disparaît de la lecture du monde', () => {
  const simulation = new Simulation(SEED);
  standOnAProp(simulation);
  const transform = simulation.stores.transform.get(entityOf(simulation))!;

  const found = nearestProp(simulation.stores, SEED, transform.x, transform.y)!;
  assert.ok(found, 'un élément devrait être à portée avant la récolte');

  simulation.step(HARVEST);

  const key = propKey(found.cx, found.cy, found.index);
  assert.ok(harvestedKeys(simulation.stores).has(key));
  const after = nearestProp(simulation.stores, SEED, transform.x, transform.y);
  assert.ok(after === null || propKey(after.cx, after.cy, after.index) !== key);
});

test('on ne récolte pas deux fois le même élément', () => {
  const simulation = new Simulation(SEED);
  standOnAProp(simulation);

  simulation.step(HARVEST);
  const first = simulation.stores.harvested.size;
  for (let i = 0; i < HARVEST_COOLDOWN_STEPS; i++) simulation.step(IDLE);
  simulation.step(HARVEST);

  // Un second élément peut être à portée ; ce qui compte est qu'aucune
  // exception ne soit enregistrée deux fois pour la même coordonnée.
  const keys = harvestedKeys(simulation.stores);
  assert.equal(keys.size, simulation.stores.harvested.size, 'une exception est en double');
  assert.ok(simulation.stores.harvested.size >= first);
});

test('maintenir la touche ne récolte pas une fois par pas', () => {
  const simulation = new Simulation(SEED);
  standOnAProp(simulation);
  for (let i = 0; i < HARVEST_COOLDOWN_STEPS; i++) simulation.step(HARVEST);

  assert.equal(simulation.stores.harvested.size, 1);
});

test('loin de tout, la récolte est refusée', () => {
  const simulation = new Simulation(SEED);
  const transform = simulation.stores.transform.get(entityOf(simulation))!;
  // Un point choisi pour n'avoir aucun décor à portée.
  let placed = false;
  for (let distance = 500; distance < 40000 && !placed; distance += 137) {
    if (nearestProp(simulation.stores, SEED, distance, -distance) === null) {
      transform.x = distance;
      transform.y = -distance;
      placed = true;
    }
  }
  assert.ok(placed, 'aucun point désert trouvé');

  simulation.step(HARVEST);

  assert.equal(simulation.stores.harvested.size, 0);
  assert.equal(
    simulation.lastHarvest?.harvested === false && simulation.lastHarvest.reason,
    'rien à portée',
  );
});

test('tryHarvest respecte le temps d attente', () => {
  const simulation = new Simulation(SEED);
  standOnAProp(simulation);
  simulation.stores.controlled.get(entityOf(simulation))!.harvestCooldown = 5;

  const outcome = tryHarvest(simulation.world, simulation.stores, SEED, entityOf(simulation));

  assert.equal(outcome.harvested, false);
  assert.equal(outcome.harvested === false && outcome.reason, 'attente');
});

test('les exceptions survivent à un aller-retour par instantané', () => {
  const simulation = new Simulation(SEED);
  standOnAProp(simulation);
  simulation.step(HARVEST);

  const snapshot = simulation.snapshot();
  const keys = harvestedKeys(simulation.stores);
  simulation.world.restore(snapshot);

  assert.deepEqual(harvestedKeys(simulation.stores), keys);
  assert.equal(JSON.stringify(simulation.snapshot()), JSON.stringify(snapshot));
});

test('une session de récolte se rejoue à l identique', () => {
  const frames: Tick[] = [];
  for (let i = 0; i < 500; i++) {
    const leg = Math.floor(i / 50) % 4;
    frames.push([
      {
        player: PLAYER,
        x: leg === 0 ? 1 : leg === 2 ? -1 : 0,
        y: leg === 1 ? 1 : leg === 3 ? -1 : 0,
        build: i % 40 === 0,
        harvest: i % 9 === 0,
      },
    ]);
  }

  const live = new Simulation(SEED);
  const recorder = new Recorder(SEED, live.players());
  for (const frame of frames) {
    recorder.capture(frame);
    live.step(frame);
  }

  assert.ok(live.stores.harvested.size > 2, `trop peu de récoltes : ${live.stores.harvested.size}`);
  const result = compare(live.snapshot(), replay(recorder.finish()));
  assert.ok(result.identical, `divergence en ${result.firstDifference}`);
});

test('une récolte en moins fait diverger le rejeu', () => {
  const frames: Tick[] = [];
  for (let i = 0; i < 200; i++) {
    frames.push([{ player: PLAYER, x: 1, y: 0, build: false, harvest: i % 9 === 0 }]);
  }
  const players = [PLAYER];

  // On repère la trame qui récolte réellement. Beaucoup de demandes tombent
  // pendant le temps d'attente : en retirer une n'y changerait rien, et le
  // contrôle négatif ne prouverait alors rien du tout.
  const probe = new Simulation(SEED);
  let effective = -1;
  for (let i = 0; i < frames.length; i++) {
    const before = probe.stores.harvested.size;
    probe.step(frames[i]!);
    if (probe.stores.harvested.size > before) {
      effective = i;
      break;
    }
  }
  assert.ok(effective >= 0, 'aucune récolte effective dans la session témoin');

  const reference = replay({ seed: SEED, players, frames });
  const altered = replay({
    seed: SEED,
    players,
    frames: frames.map((tick, i) => (i === effective ? [{ ...tick[0]!, harvest: false }] : tick)),
  });

  assert.equal(compare(reference, altered).identical, false);
});

test('retirer une demande sans effet ne change rien', () => {
  // La contrepartie : une demande tombée pendant le temps d'attente est un
  // non-événement, et le rejeu doit le confirmer.
  const frames: Tick[] = [];
  for (let i = 0; i < 60; i++) {
    frames.push([{ player: PLAYER, x: 0, y: 0, build: false, harvest: i === 0 || i === 1 }]);
  }
  const players = [PLAYER];

  const reference = replay({ seed: SEED, players, frames });
  const withoutSecond = replay({
    seed: SEED,
    players,
    frames: frames.map((tick, i) => (i === 1 ? [{ ...tick[0]!, harvest: false }] : tick)),
  });

  assert.equal(compare(reference, withoutSecond).identical, true);
});

test('récolter donne de quoi bâtir', () => {
  // La boucle du jeu : peu de blocs au départ, la récolte les reconstitue.
  const simulation = new Simulation(SEED);
  const start = simulation.stores.inventory.get(entityOf(simulation))!.blocs;
  assert.ok(start < 20, `le départ doit être maigre, reçu ${start}`);

  standOnAProp(simulation);
  simulation.step(HARVEST);

  assert.ok(simulation.stores.inventory.get(entityOf(simulation))!.blocs > start);
});
