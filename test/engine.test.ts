import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.ts';
import type { Scheduler } from '../src/core/engine.ts';

/** Un ordonnanceur piloté à la main : les images n'arrivent que si on les demande. */
function fakeScheduler(): { scheduler: Scheduler; advance(ms: number): void } {
  let pending: ((nowMs: number) => void) | null = null;
  let handle = 0;
  let time = 0;
  return {
    scheduler: {
      request(callback) {
        pending = callback;
        return ++handle;
      },
      cancel() {
        pending = null;
      },
      now() {
        return time;
      },
    },
    advance(ms) {
      time += ms;
      const callback = pending;
      pending = null;
      callback?.(time);
    },
  };
}

function counted(): { hooks: { fixedUpdate(): void; render(a: number): void }; updates: number[]; renders: number[] } {
  const updates: number[] = [];
  const renders: number[] = [];
  return {
    hooks: {
      fixedUpdate() {
        updates.push(1);
      },
      render(alpha: number) {
        renders.push(alpha);
      },
    },
    updates,
    renders,
  };
}

test('une image de 1/60 s produit un pas', () => {
  const clock = fakeScheduler();
  const { hooks, updates } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();

  clock.advance(1000 / 60);

  assert.equal(updates.length, 1);
});

test('en pause, le monde n avance plus mais continue d être dessiné', () => {
  const clock = fakeScheduler();
  const { hooks, updates, renders } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();
  clock.advance(1000 / 60);

  engine.pause();
  const before = updates.length;
  const rendersBefore = renders.length;
  clock.advance(500);

  assert.equal(updates.length, before, 'aucun pas ne doit être exécuté');
  assert.ok(renders.length > rendersBefore, 'le rendu doit continuer');
});

test('le rendu en pause n interpole pas', () => {
  const clock = fakeScheduler();
  const { hooks, renders } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();
  clock.advance(10); // laisse un reste dans l'accumulateur
  engine.pause();
  clock.advance(16);

  // Ce qui est affiché doit être l'état exact qu'on inspecte, pas un intermédiaire.
  assert.equal(renders[renders.length - 1], 0);
});

test('le pas-à-pas exécute exactement le nombre demandé', () => {
  const clock = fakeScheduler();
  const { hooks, updates } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();
  engine.pause();

  engine.stepOnce();
  clock.advance(16);
  assert.equal(updates.length, 1);

  engine.stepOnce(10);
  clock.advance(16);
  assert.equal(updates.length, 11);
});

test('les pas demandés ne se rejouent pas à l image suivante', () => {
  const clock = fakeScheduler();
  const { hooks, updates } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();
  engine.pause();

  engine.stepOnce(3);
  clock.advance(16);
  clock.advance(16);

  assert.equal(updates.length, 3);
});

test('le pas-à-pas est ignoré quand le moteur tourne', () => {
  const clock = fakeScheduler();
  const { hooks, updates } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();

  engine.stepOnce(50);
  clock.advance(1000 / 60);

  assert.equal(updates.length, 1, 'seul le pas dû au temps écoulé doit avoir lieu');
});

test('reprendre après une longue pause ne déclenche pas de rattrapage', () => {
  const clock = fakeScheduler();
  const { hooks, updates } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();
  engine.pause();

  clock.advance(30_000); // une demi-minute passée à inspecter
  engine.resume();
  clock.advance(1000 / 60);

  // Le temps de la pause n'appartient pas à la simulation.
  assert.equal(updates.length, 1);
});

test('une pause redondante est sans effet sur les pas demandés', () => {
  const clock = fakeScheduler();
  const { hooks, updates } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();
  engine.pause();
  engine.stepOnce(5);
  engine.pause(); // déjà en pause : ne doit rien annuler
  clock.advance(16);

  assert.equal(updates.length, 5);
  assert.equal(engine.isPaused, true);
});

test('reprendre annule les pas demandés et non consommés', () => {
  const clock = fakeScheduler();
  const { hooks, updates } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();
  engine.pause();
  engine.stepOnce(5);

  // Reprise avant la prochaine image : les cinq pas n'ont jamais eu lieu et ne
  // doivent pas ressurgir à la pause suivante.
  engine.resume();
  engine.pause();
  clock.advance(16);

  assert.equal(updates.length, 0);
});

test('arrêter le moteur cesse de demander des images', () => {
  const clock = fakeScheduler();
  const { hooks, renders } = counted();
  const engine = new Engine(hooks, 60, clock.scheduler);
  engine.start();
  clock.advance(16);
  engine.stop();
  const before = renders.length;
  clock.advance(16);

  assert.equal(renders.length, before);
  assert.equal(engine.isRunning, false);
});
