import { Simulation, WORLD_BOUNDS, STEPS_PER_SECOND } from './core/simulation.ts';
import type { Snapshot } from './core/world.ts';
import { Engine } from './core/engine.ts';
import { Recorder, replay, compare } from './core/replay.ts';
import type { Recording } from './core/replay.ts';
import { Keyboard } from './systems/input.ts';
import { render } from './systems/render.ts';
import type { Palette } from './systems/render.ts';
import { createInspector } from './tools/panel.ts';
import { findNearest, toWorldPoint } from './tools/inspect.ts';

const SEED = 20260826;

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
const overlay = document.getElementById('overlay');
const verdict = document.getElementById('verdict');
const inspectorHost = document.getElementById('inspector');
if (!canvas || !overlay || !verdict || !inspectorHost) {
  throw new Error('Le gabarit doit contenir #scene, #overlay, #verdict et #inspector');
}

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D indisponible dans ce navigateur');

let simulation = new Simulation(SEED, WORLD_BOUNDS);
let recorder: Recorder | null = null;
let lastRecording: Recording | null = null;
let saved: Snapshot | null = null;
let savedNote = 'aucun';

const keyboard = new Keyboard();

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    surface: read('--surface', '#f9fafc'),
    grid: read('--grid', '#c6d0de'),
    ink: read('--ink', '#0f141c'),
    outline: read('--line-strong', '#b7c1ce'),
    accent: read('--accent', '#22409e'),
  };
}

let palette = readPalette();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  palette = readPalette();
});

let cssSize = { width: 0, height: 0 };
function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas!.getBoundingClientRect();
  cssSize = { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
  canvas!.width = Math.round(cssSize.width * dpr);
  canvas!.height = Math.round(cssSize.height * dpr);
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function setVerdict(text: string, tone: 'neutre' | 'ok' | 'alerte'): void {
  verdict!.textContent = text;
  verdict!.dataset['tone'] = tone;
}

/**
 * Démarre un enregistrement sur un monde neuf.
 *
 * Repartir de zéro est ce qui rend la comparaison possible : le rejeu n'a que
 * la graine et les entrées, il doit donc partir du même état initial que la
 * session enregistrée.
 */
function startRecording(): void {
  // Enregistrer depuis un moteur en pause donnerait une session vide.
  engine.resume();
  simulation = new Simulation(SEED, WORLD_BOUNDS);
  recorder = new Recorder(SEED);
  saved = null;
  savedNote = 'aucun';
  inspector.select(null);
  setVerdict('enregistrement en cours — rejouez avec R', 'neutre');
}

/** Arrête l'enregistrement, le rejoue à part, et compare les deux états finaux. */
function stopAndVerify(): void {
  if (!recorder) return;
  const recording = recorder.finish();
  recorder = null;
  lastRecording = recording;

  const live = simulation.snapshot();
  const replayed = replay(recording, WORLD_BOUNDS);
  const result = compare(live, replayed);

  const size = JSON.stringify(recording).length;
  if (result.identical) {
    setVerdict(
      `${recording.frames.length} pas rejoués depuis ${size} octets d'entrées — état final identique`,
      'ok',
    );
  } else {
    setVerdict(`divergence au premier écart : ${result.firstDifference}`, 'alerte');
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  // Les raccourcis de l'outil ne doivent pas s'appliquer pendant qu'on édite.
  if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;

  if (event.code === 'Space') {
    event.preventDefault();
    if (engine.isPaused) engine.resume();
    else engine.pause();
    inspector.refresh();
  } else if (event.code === 'Period') {
    if (!engine.isPaused) engine.pause();
    engine.stepOnce(1);
    inspector.refresh();
  } else if (event.code === 'KeyR') {
    if (recorder) stopAndVerify();
    else startRecording();
  } else if (event.code === 'KeyO') {
    saved = simulation.snapshot();
    savedNote = `${JSON.stringify(saved).length} octets`;
  } else if (event.code === 'KeyP' && saved) {
    simulation.world.restore(saved);
  }
});

const engine = new Engine(
  {
    fixedUpdate() {
      const input = keyboard.axis();
      // L'entrée est capturée avant d'être consommée : ce qui est enregistré
      // est exactement ce que la simulation a reçu, pas une approximation.
      recorder?.capture(input);
      simulation.step(input);
    },
    render(alpha) {
      render(ctx!, simulation.stores, alpha, WORLD_BOUNDS, palette, cssSize, inspector.selected());
    },
  },
  STEPS_PER_SECOND,
);

const inspector = createInspector({
  container: inspectorHost,
  getWorld: () => simulation.world,
  getStores: () => simulation.stores,
  engine,
});

// Cliquer dans l'aire de jeu sélectionne ce qu'on désigne.
canvas.addEventListener('pointerdown', (event) => {
  const point = toWorldPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), WORLD_BOUNDS);
  inspector.select(findNearest(simulation.stores, point.x, point.y, WORLD_BOUNDS));
});

function refreshOverlay(): void {
  const stats = engine.getStats();
  inspector.refresh();
  overlay!.textContent = [
    engine.isPaused ? '⏸ en pause' : `${stats.fps.toFixed(0)} i/s`,
    `t = ${simulation.elapsedSeconds.toFixed(1)} s`,
    `${simulation.world.entityCount} entités`,
    recorder ? `● ${recorder.frameCount} pas enregistrés` : 'enregistrement : arrêté',
    `instantané : ${savedNote}`,
  ].join('   ·   ');
}

/**
 * Surface d'inspection : le monde, la simulation et le dernier enregistrement,
 * atteignables depuis la console. C'est la première pierre de l'inspecteur, et
 * ce sur quoi s'appuient les tests de bout en bout.
 */
(window as unknown as Record<string, unknown>)['t0'] = {
  get simulation() {
    return simulation;
  },
  get world() {
    return simulation.world;
  },
  get stores() {
    return simulation.stores;
  },
  get saved() {
    return saved;
  },
  get lastRecording() {
    return lastRecording;
  },
  engine,
  inspector,
  replay,
  compare,
};

keyboard.attach();
resize();
window.addEventListener('resize', resize, { passive: true });
setVerdict('appuyez sur R pour enregistrer une session', 'neutre');
engine.start();
setInterval(refreshOverlay, 250);
refreshOverlay();
