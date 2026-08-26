import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, PLAYER } from '../src/core/simulation.ts';
import type { InputFrame, Tick } from '../src/core/simulation.ts';
import { Recorder, replay, compare } from '../src/core/replay.ts';
import { createRandom } from '../src/core/random.ts';

const SEED = 4242;

/** Une suite de demandes reproductible, qui change de direction comme un joueur. */
function scriptedInputs(count: number): Tick[] {
  const random = createRandom(7);
  const frames: Tick[] = [];
  let current: InputFrame = { x: 0, y: 0, build: false, harvest: false };
  for (let i = 0; i < count; i++) {
    if (i % 17 === 0) {
      const angle = random() * Math.PI * 2;
      // Une pose de temps en temps : l'action doit être rejouée comme le reste.
      current = { x: Math.cos(angle), y: Math.sin(angle), build: i % 51 === 0, harvest: false };
    }
    frames.push([{ player: PLAYER, ...current }]);
  }
  return frames;
}

test('deux simulations aux mêmes entrées finissent dans le même état', () => {
  const frames = scriptedInputs(600);

  const a = new Simulation(SEED);
  const b = new Simulation(SEED);
  for (const frame of frames) a.step(frame);
  for (const frame of frames) b.step(frame);

  assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()));
});

test('des graines différentes produisent des mondes différents', () => {
  const frames = scriptedInputs(60);
  const a = new Simulation(SEED);
  const b = new Simulation(SEED + 1);
  for (const frame of frames) a.step(frame);
  for (const frame of frames) b.step(frame);

  assert.notEqual(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()));
});

test('rejouer un enregistrement redonne l état de la session enregistrée', () => {
  const frames = scriptedInputs(600);

  const live = new Simulation(SEED);
  const recorder = new Recorder(SEED, live.players());
  for (const frame of frames) {
    recorder.capture(frame);
    live.step(frame);
  }

  const result = compare(live.snapshot(), replay(recorder.finish()));
  assert.ok(result.identical, `divergence en ${result.firstDifference}`);
});

test('l enregistrement copie les entrées au lieu de les référencer', () => {
  const recorder = new Recorder(SEED, [PLAYER]);
  const shared = { player: PLAYER, x: 1, y: 0, build: true, harvest: false };
  recorder.capture([shared]);
  shared.x = -1; // le clavier réutiliserait volontiers le même objet
  shared.build = false;

  assert.deepEqual(recorder.finish().frames[0], [
    { player: PLAYER, x: 1, y: 0, build: true, harvest: false },
  ]);
});

test('un enregistrement pèse bien moins qu une suite d instantanés', () => {
  const frames = scriptedInputs(600);
  const simulation = new Simulation(SEED);
  const recorder = new Recorder(SEED, simulation.players());
  for (const frame of frames) {
    recorder.capture(frame);
    simulation.step(frame);
  }

  const recordingBytes = JSON.stringify(recorder.finish()).length;
  const oneSnapshotBytes = JSON.stringify(simulation.snapshot()).length;

  // 600 instantanés seraient l'alternative naïve pour rejouer une session.
  assert.ok(
    recordingBytes < oneSnapshotBytes * 600,
    `enregistrement ${recordingBytes} vs instantanés ${oneSnapshotBytes * 600}`,
  );
});

test('compare situe le premier écart au lieu de dire seulement « différent »', () => {
  const a = new Simulation(SEED);
  const b = new Simulation(SEED);
  b.stores.transform.get(3)!.x += 0.5;

  const result = compare(a.snapshot(), b.snapshot());

  assert.equal(result.identical, false);
  assert.match(result.firstDifference, /transform/);
  assert.match(result.firstDifference, /\.x$/);
});

test('compare reconnaît deux états identiques', () => {
  const a = new Simulation(SEED);
  const b = new Simulation(SEED);
  const result = compare(a.snapshot(), b.snapshot());

  assert.equal(result.identical, true);
  assert.equal(result.firstDifference, '');
});

test('le temps logique ne dépend que du nombre de pas', () => {
  const simulation = new Simulation(SEED);
  for (let i = 0; i < 90; i++) simulation.step([{ player: PLAYER, x: 0, y: 0, build: false, harvest: false }]);

  assert.equal(simulation.stepCount, 90);
  assert.equal(simulation.elapsedSeconds, 1.5);
});
