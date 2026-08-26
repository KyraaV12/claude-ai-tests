import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, PLAYER } from '../src/core/simulation.ts';
import type { InputFrame } from '../src/core/simulation.ts';
import { Recorder, replay, compare } from '../src/core/replay.ts';
import { biomeAt, isWater } from '../src/world/terrain.ts';
import { buildTarget, BUILD_COOLDOWN_STEPS, BUILD_SIZE } from '../src/systems/build.ts';

const SEED = 20260826;
const IDLE: InputFrame = { x: 0, y: 0, build: false };
const BUILD: InputFrame = { x: 0, y: 0, build: true };

function structures(simulation: Simulation): number {
  return simulation.stores.structure.size;
}

function blocs(simulation: Simulation): number {
  return simulation.stores.inventory.get(PLAYER)!.blocs;
}

/** Avance jusqu'à ce que la pose soit de nouveau permise. */
function waitCooldown(simulation: Simulation): void {
  for (let i = 0; i < BUILD_COOLDOWN_STEPS; i++) simulation.step(IDLE);
}

test('poser crée une entité et consomme un bloc', () => {
  const simulation = new Simulation(SEED);
  const before = blocs(simulation);

  simulation.step(BUILD);

  assert.equal(structures(simulation), 1);
  assert.equal(blocs(simulation), before - 1);
  assert.equal(simulation.lastBuild?.placed, true);
});

test('la construction est posée devant le joueur, pas sur lui', () => {
  const simulation = new Simulation(SEED);
  const target = buildTarget(simulation.stores, PLAYER)!;
  simulation.step(BUILD);

  const placed = [...simulation.stores.structure.entries()][0]![0];
  const transform = simulation.stores.transform.get(placed)!;
  assert.ok(Math.abs(transform.x - target.x) < 1e-9 && Math.abs(transform.y - target.y) < 1e-9);

  const player = simulation.stores.transform.get(PLAYER)!;
  assert.ok(Math.hypot(transform.x - player.x, transform.y - player.y) > BUILD_SIZE);
});

test('maintenir la touche ne sème pas une construction par pas', () => {
  const simulation = new Simulation(SEED);
  for (let i = 0; i < BUILD_COOLDOWN_STEPS; i++) simulation.step(BUILD);

  // Sans temps d'attente, ce serait une construction à chaque pas.
  assert.equal(structures(simulation), 1);
});

test('le temps d attente écoulé et après s être déplacé, on peut reposer', () => {
  const simulation = new Simulation(SEED);
  simulation.step({ x: 1, y: 0, build: true });

  // Se déplacer est nécessaire : immobile, la seconde pose viserait le même
  // point et se heurterait à la première. C'est le comportement voulu.
  for (let i = 0; i < 30; i++) simulation.step({ x: 1, y: 0, build: false });
  simulation.step({ x: 1, y: 0, build: true });

  assert.equal(structures(simulation), 2);
});

test('immobile, on ne peut pas empiler au même endroit', () => {
  const simulation = new Simulation(SEED);
  simulation.step(BUILD);
  waitCooldown(simulation);
  simulation.step(BUILD);

  assert.equal(structures(simulation), 1);
});

test('la direction du regard décide de l endroit', () => {
  const north = new Simulation(SEED);
  north.step({ x: 0, y: -1, build: false });
  const up = buildTarget(north.stores, PLAYER)!;

  const east = new Simulation(SEED);
  east.step({ x: 1, y: 0, build: false });
  const right = buildTarget(east.stores, PLAYER)!;

  assert.ok(up.y < north.stores.transform.get(PLAYER)!.y, 'viser le nord doit poser au nord');
  assert.ok(right.x > east.stores.transform.get(PLAYER)!.x, 'viser l est doit poser à l est');
});

test('on ne pose pas deux constructions au même endroit', () => {
  const simulation = new Simulation(SEED);
  simulation.step(BUILD);
  waitCooldown(simulation);
  simulation.step(BUILD); // même position visée, joueur immobile

  assert.equal(structures(simulation), 1);
  assert.equal(simulation.lastBuild?.placed, false);
  assert.equal(simulation.lastBuild?.placed === false && simulation.lastBuild.reason, 'place occupée');
});

test('on ne pose rien sans ressource', () => {
  const simulation = new Simulation(SEED);
  simulation.stores.inventory.get(PLAYER)!.blocs = 0;

  simulation.step(BUILD);

  assert.equal(structures(simulation), 0);
  assert.equal(simulation.lastBuild?.placed === false && simulation.lastBuild.reason, 'sans ressource');
});

test('on ne bâtit pas sur l eau', () => {
  // La simulation lit le terrain — une fonction pure de la graine — sans jamais
  // l'écrire. Le refus est donc reproductible et n'entame pas le déterminisme.
  const simulation = new Simulation(SEED);
  const player = simulation.stores.transform.get(PLAYER)!;

  // On déplace le joueur au bord d'une étendue d'eau et on vise dedans.
  let found = false;
  for (let angle = 0; angle < 360 && !found; angle += 5) {
    for (let distance = 200; distance < 4000 && !found; distance += 40) {
      const x = Math.cos((angle * Math.PI) / 180) * distance;
      const y = Math.sin((angle * Math.PI) / 180) * distance;
      if (!isWater(biomeAt(SEED, x, y))) continue;
      player.x = x;
      player.y = y;
      found = true;
    }
  }
  assert.ok(found, 'aucune eau trouvée autour du départ');

  simulation.stores.controlled.get(PLAYER)!.buildCooldown = 0;
  simulation.step(BUILD);

  assert.equal(structures(simulation), 0);
  assert.equal(simulation.lastBuild?.placed === false && simulation.lastBuild.reason, 'sur l eau');
});

test('les constructions survivent à un aller-retour par instantané', () => {
  const simulation = new Simulation(SEED);
  simulation.step(BUILD);
  const snapshot = simulation.snapshot();
  const built = structures(simulation);

  simulation.world.restore(snapshot);

  assert.equal(structures(simulation), built);
  assert.equal(JSON.stringify(simulation.snapshot()), JSON.stringify(snapshot));
});

test('une session avec constructions se rejoue à l identique', () => {
  // Le vrai test de la tranche : une action discrète, et non plus seulement une
  // direction, doit traverser l'enregistrement sans rien perdre.
  const frames: InputFrame[] = [];
  for (let i = 0; i < 400; i++) {
    const turning = Math.floor(i / 40) % 4;
    frames.push({
      x: turning === 0 ? 1 : turning === 2 ? -1 : 0,
      y: turning === 1 ? 1 : turning === 3 ? -1 : 0,
      build: i % 15 === 0,
    });
  }

  const live = new Simulation(SEED);
  const recorder = new Recorder(SEED);
  for (const frame of frames) {
    recorder.capture(frame);
    live.step(frame);
  }

  assert.ok(structures(live) > 3, `trop peu de constructions posées : ${structures(live)}`);

  const result = compare(live.snapshot(), replay(recorder.finish()));
  assert.ok(result.identical, `divergence en ${result.firstDifference}`);
});

test('une construction en moins fait diverger le rejeu', () => {
  // Contrôle négatif : si retirer une pose ne changeait rien, le test
  // précédent ne prouverait pas grand-chose.
  const frames: InputFrame[] = [];
  for (let i = 0; i < 120; i++) frames.push({ x: 1, y: 0, build: i % 15 === 0 });

  const reference = replay({ seed: SEED, frames });
  const withoutOne = replay({ seed: SEED, frames: frames.map((f, i) => (i === 30 ? { ...f, build: false } : f)) });

  assert.equal(compare(reference, withoutOne).identical, false);
});
