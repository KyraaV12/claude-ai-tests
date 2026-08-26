import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, PLAYER } from '../src/core/simulation.ts';
import type { Tick } from '../src/core/simulation.ts';
import { SPECIES, spawn, POPULATION } from '../src/systems/creature.ts';
import type { Species } from '../src/core/components.ts';
import { STEPS_PER_DAY, isNight } from '../src/world/daynight.ts';
import { biomeAt, isWater } from '../src/world/terrain.ts';

const SEED = 20260826;

function walk(dx: number, dy: number): Tick {
  return [{ player: PLAYER, x: dx, y: dy, build: false, harvest: false, torch: false }];
}

function census(simulation: Simulation): Map<Species, number> {
  const counts = new Map<Species, number>();
  for (const [, creature] of simulation.stores.creature.entries()) {
    counts.set(creature.species, (counts.get(creature.species) ?? 0) + 1);
  }
  return counts;
}

/** Fait vivre un monde en promenant le joueur, et rend la simulation. */
function wander(seed: number, steps: number, from = 0): Simulation {
  const simulation = new Simulation(seed);
  for (let i = 0; i < from + steps; i++) {
    const t = i / 400;
    simulation.step(walk(Math.cos(t), Math.sin(t)));
  }
  return simulation;
}

test('la faune est déterministe : deux mondes identiques le restent', () => {
  // Aucune décision ne tire de Math.random(). Si une seule le faisait, le rejeu
  // et la réplication s'effondreraient sans qu'on sache pourquoi.
  const a = new Simulation(4242);
  const b = new Simulation(4242);
  for (let i = 0; i < 2400; i++) {
    const frame = walk(1, 0.3);
    a.step(frame);
    b.step(frame);
  }
  assert.ok(a.stores.creature.size > 0, 'aucune bête : le test ne prouverait rien');
  assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()));
});

test('la population reste bornée, même après une longue traversée', () => {
  // Sans oubli, un monde parcouru longtemps accumule des milliers de bêtes qui
  // pèsent sur chaque pas et sur chaque état transmis.
  const simulation = new Simulation(SEED);
  let peak = 0;
  for (let i = 0; i < STEPS_PER_DAY * 2; i++) {
    simulation.step(walk(1, 0.2));
    peak = Math.max(peak, simulation.stores.creature.size);
  }
  assert.ok(peak > 0, 'le monde est resté vide');
  assert.ok(peak <= POPULATION * 3, `pic de population de ${peak}`);
});

test("ce que le joueur a fait n est jamais oublié, seule la faune s efface", () => {
  const simulation = new Simulation(SEED);
  // Bâtir, récolter, puis s'en aller très loin.
  for (let i = 0; i < 400; i++) {
    simulation.step([
      { player: PLAYER, x: 0, y: 0, build: i % 30 === 0, harvest: i % 30 === 15, torch: false },
    ]);
  }
  const structures = simulation.stores.structure.size;
  const harvested = simulation.stores.harvested.size;
  assert.ok(structures > 0 && harvested > 0, 'rien à conserver : le test ne prouverait rien');

  for (let i = 0; i < 2400; i++) simulation.step(walk(1, 0));

  assert.equal(simulation.stores.structure.size, structures, 'une construction a été oubliée');
  assert.equal(simulation.stores.harvested.size, harvested, 'une récolte a été oubliée');
});

test('les espèces suivent l heure', () => {
  // La nuit amène les loups et les lucioles, le jour les cerfs. C'est ce qui
  // fait que le cycle jour/nuit change le jeu, et non seulement la couleur.
  const day = wander(SEED, 900, 600);
  const dayCensus = census(day);
  assert.ok(!isNight(day.stepCount), 'ce moment devait être de jour');
  assert.equal(dayCensus.get('loup') ?? 0, 0, 'un loup en plein jour');

  // Un monde amené jusqu'à la nuit, puis observé.
  const night = new Simulation(SEED);
  while (!isNight(night.stepCount)) night.step(walk(0, 0));
  for (let i = 0; i < 900; i++) night.step(walk(Math.cos(i / 300), Math.sin(i / 300)));
  const nightCensus = census(night);
  assert.equal(nightCensus.get('cerf') ?? 0, 0, 'un cerf en pleine nuit');
  assert.ok((nightCensus.get('loup') ?? 0) + (nightCensus.get('luciole') ?? 0) > 0, 'nuit déserte');
});

test('un loup vient la nuit, et ignore le joueur le jour', () => {
  const approach = (night: boolean): number => {
    const simulation = new Simulation(SEED);
    if (night) while (!isNight(simulation.stepCount)) simulation.step(walk(0, 0));
    else while (isNight(simulation.stepCount)) simulation.step(walk(0, 0));

    const player = simulation.entityOf(PLAYER)!;
    const at = simulation.stores.transform.get(player)!;
    const wolf = spawn(simulation.world, simulation.stores, 'loup', at.x + 250, at.y);
    const before = simulation.stores.transform.get(wolf)!.x - at.x;
    for (let i = 0; i < 60; i++) simulation.step(walk(0, 0));
    return simulation.stores.transform.get(wolf)!.x - simulation.stores.transform.get(player)!.x - before;
  };

  assert.ok(approach(true) < -30, 'le loup nocturne aurait dû se rapprocher');
  // De jour il flâne : il peut aller dans n'importe quel sens, mais pas droit
  // sur le joueur à pleine allure.
  assert.ok(Math.abs(approach(false)) < 60, 'le loup diurne ne devrait pas foncer');
});

test('un cerf s écarte du joueur', () => {
  const simulation = new Simulation(SEED);
  while (isNight(simulation.stepCount)) simulation.step(walk(0, 0));

  const player = simulation.entityOf(PLAYER)!;
  const at = simulation.stores.transform.get(player)!;
  const deer = spawn(simulation.world, simulation.stores, 'cerf', at.x + 120, at.y);

  const gap = (): number => {
    const here = simulation.stores.transform.get(deer)!;
    const there = simulation.stores.transform.get(player)!;
    return Math.hypot(here.x - there.x, here.y - there.y);
  };
  const before = gap();
  for (let i = 0; i < 60; i++) simulation.step(walk(0, 0));
  assert.ok(gap() > before + 40, `le cerf n a pas fui : ${before.toFixed(0)} → ${gap().toFixed(0)}`);
});

test('rien n apparaît dans l eau', () => {
  const simulation = new Simulation(SEED);
  for (let i = 0; i < 3600; i++) simulation.step(walk(Math.cos(i / 200), Math.sin(i / 200)));

  for (const [entity] of simulation.stores.creature.entries()) {
    const transform = simulation.stores.transform.get(entity)!;
    // Une bête *née* sur terre peut ensuite marcher jusqu'à l'eau ; c'est son
    // point d'attache, non sa position courante, qui dit où elle est apparue.
    const creature = simulation.stores.creature.get(entity)!;
    assert.equal(
      isWater(biomeAt(SEED, creature.homeX, creature.homeY)),
      false,
      `une bête est née dans l eau en ${creature.homeX.toFixed(0)}, ${creature.homeY.toFixed(0)}`,
    );
  }
});

test('une créature revient vers son point d attache', () => {
  // Sans laisse, une marche au hasard finit par emmener toute la faune à
  // l'infini, et le monde se vide derrière le joueur.
  const simulation = new Simulation(SEED);
  const player = simulation.entityOf(PLAYER)!;
  const at = simulation.stores.transform.get(player)!;
  const deer = spawn(simulation.world, simulation.stores, 'cerf', at.x + 4000, at.y + 4000);

  let worst = 0;
  for (let i = 0; i < 2400; i++) {
    simulation.step(walk(0, 0));
    if (!simulation.world.isAlive(deer)) break;
    const here = simulation.stores.transform.get(deer)!;
    const home = simulation.stores.creature.get(deer)!;
    worst = Math.max(worst, Math.hypot(here.x - home.homeX, here.y - home.homeY));
  }
  assert.ok(worst < 1200, `la bête s est éloignée de ${worst.toFixed(0)} de son attache`);
});

test('une simulation sans autorité ne peuple jamais le monde', () => {
  // C'est ce qui évite à un client de voir ses bêtes s'évaporer au premier état
  // reçu : il les reçoit, il ne les invente pas.
  const follower = new Simulation(SEED, [PLAYER], { authority: false });
  for (let i = 0; i < 1200; i++) follower.step(walk(1, 0));
  assert.equal(follower.stores.creature.size, 0);

  const authority = new Simulation(SEED, [PLAYER]);
  for (let i = 0; i < 1200; i++) authority.step(walk(1, 0));
  assert.ok(authority.stores.creature.size > 0, 'l autorité aurait dû peupler');
});

test('une luciole éclaire, un cerf non', () => {
  const simulation = new Simulation(SEED);
  const firefly = spawn(simulation.world, simulation.stores, 'luciole', 0, 0);
  const deer = spawn(simulation.world, simulation.stores, 'cerf', 0, 0);

  assert.equal(simulation.stores.light.get(firefly)?.radius, SPECIES.luciole.light);
  assert.equal(simulation.stores.light.has(deer), false);
});

test('la faune passe par l instantané comme le reste', () => {
  // Une créature est de l'état : elle se sauvegarde, se transmet et se rejoue.
  const live = wander(SEED, 1500);
  assert.ok(live.stores.creature.size > 0);

  const text = JSON.stringify(live.snapshot());
  const loaded = new Simulation(SEED, []);
  loaded.restore(JSON.parse(text), live.stepCount);

  assert.equal(loaded.stores.creature.size, live.stores.creature.size);
  assert.equal(JSON.stringify(loaded.snapshot()), text);
});
