import { Simulation, STEPS_PER_SECOND } from './core/simulation.ts';
import type { Snapshot } from './core/world.ts';
import { Engine } from './core/engine.ts';
import { Recorder, replay, compare } from './core/replay.ts';
import type { Recording } from './core/replay.ts';
import { Keyboard } from './systems/input.ts';
import { render } from './systems/render.ts';
import type { Palette } from './systems/render.ts';
import { createInspector } from './tools/panel.ts';
import { findNearest } from './tools/inspect.ts';
import { ChunkCache, CHUNK_SIZE, chunkCoordOf } from './world/chunk.ts';
import { TerrainPainter } from './systems/terrain-painter.ts';
import { createCamera, follow, screenToWorld } from './world/camera.ts';
import { biomeAt } from './world/terrain.ts';

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

let simulation = new Simulation(SEED);
let recorder: Recorder | null = null;
let lastRecording: Recording | null = null;
let saved: Snapshot | null = null;
let savedNote = 'aucun';

// Le décor : un cache d'une fonction, pas un état du jeu. On peut le vider
// sans rien perdre, il se recalcule à l'identique.
const chunks = new ChunkCache(SEED);
const painter = new TerrainPainter();
// Échelle 2,4 : on voit environ trois mille unités de large, soit plusieurs
// reliefs à la fois. À l'échelle 1 le monde se réduisait à un seul biome.
const camera = createCamera(simulation.spawn.x, simulation.spawn.y, 2.4);
const keyboard = new Keyboard();

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return { ink: read('--ink', '#0f141c'), accent: read('--accent', '#22409e') };
}

let palette = readPalette();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  palette = readPalette();
});

let viewport = { width: 0, height: 0 };
function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas!.getBoundingClientRect();
  viewport = { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
  canvas!.width = Math.round(viewport.width * dpr);
  canvas!.height = Math.round(viewport.height * dpr);
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function setVerdict(text: string, tone: 'neutre' | 'ok' | 'alerte'): void {
  verdict!.textContent = text;
  verdict!.dataset['tone'] = tone;
}

function playerPosition(): { x: number; y: number } {
  const transform = simulation.stores.transform.get(1);
  return transform ? { x: transform.x, y: transform.y } : simulation.spawn;
}

/** Démarre un enregistrement sur un monde neuf, moteur en marche. */
function startRecording(): void {
  engine.resume();
  simulation = new Simulation(SEED);
  recorder = new Recorder(SEED);
  saved = null;
  savedNote = 'aucun';
  inspector.select(null);
  camera.x = simulation.spawn.x;
  camera.y = simulation.spawn.y;
  setVerdict('enregistrement en cours — rejouez avec R', 'neutre');
}

/** Arrête l'enregistrement, le rejoue à part, et compare les deux états finaux. */
function stopAndVerify(): void {
  if (!recorder) return;
  const recording = recorder.finish();
  recorder = null;
  lastRecording = recording;

  const result = compare(simulation.snapshot(), replay(recording));
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
      recorder?.capture(input);
      simulation.step(input);
    },
    render(alpha) {
      // La caméra suit avec le temps réel : elle appartient à l'affichage, pas
      // à la simulation, et ne peut donc pas fausser un rejeu.
      const target = playerPosition();
      follow(camera, target.x, target.y, 1 / 60);
      render(ctx!, {
        stores: simulation.stores,
        chunks,
        painter,
        camera,
        viewport,
        palette,
        alpha,
        highlight: inspector.selected(),
      });
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

canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  const point = screenToWorld(camera, viewport, event.clientX - rect.left, event.clientY - rect.top);
  inspector.select(findNearest(simulation.stores, point.x, point.y));
});

function refreshOverlay(): void {
  const stats = engine.getStats();
  const position = playerPosition();
  inspector.refresh();
  overlay!.textContent = [
    engine.isPaused ? '⏸ en pause' : `${stats.fps.toFixed(0)} i/s`,
    `${position.x.toFixed(0)}, ${position.y.toFixed(0)}`,
    `morceau ${chunkCoordOf(position.x)}, ${chunkCoordOf(position.y)}`,
    biomeAt(SEED, position.x, position.y),
    `${chunks.size} en mémoire · ${chunks.generationCount} calculés`,
    recorder ? `● ${recorder.frameCount} pas` : `${simulation.world.entityCount} entités`,
  ].join('   ·   ');
}

/** Surface d'inspection, première pierre de l'outillage — et appui des tests. */
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
  camera,
  chunks,
  painter,
  engine,
  inspector,
  replay,
  compare,
  CHUNK_SIZE,
};

keyboard.attach();
resize();
window.addEventListener('resize', resize, { passive: true });
setVerdict('appuyez sur R pour enregistrer une session', 'neutre');
engine.start();
setInterval(refreshOverlay, 250);
refreshOverlay();
