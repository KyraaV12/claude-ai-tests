import { World } from './core/world.ts';
import type { Snapshot } from './core/world.ts';
import { createStores, transformAt } from './core/components.ts';
import { Engine } from './core/engine.ts';
import { createRandom } from './core/random.ts';
import { Keyboard } from './systems/input.ts';
import { applyControl, integrate } from './systems/movement.ts';
import type { Bounds } from './systems/movement.ts';
import { render } from './systems/render.ts';
import type { Palette } from './systems/render.ts';

const BOUNDS: Bounds = { width: 1000, height: 600 };
const SEED = 20260826;
const DRIFTER_COUNT = 24;

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
const overlay = document.getElementById('overlay');
if (!canvas || !overlay) throw new Error('Le gabarit de la page ne contient pas #scene et #overlay');

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D indisponible dans ce navigateur');

const world = new World();
const stores = createStores(world);
const keyboard = new Keyboard();
const random = createRandom(SEED);

function spawnWorld(): void {
  const player = world.create();
  stores.transform.set(player, transformAt(BOUNDS.width / 2, BOUNDS.height / 2));
  stores.velocity.set(player, { x: 0, y: 0 });
  stores.sprite.set(player, { radius: 14, hue: 212 });
  stores.controlled.set(player, { acceleration: 900, maxSpeed: 320, damping: 2.4 });

  for (let i = 0; i < DRIFTER_COUNT; i++) {
    const entity = world.create();
    stores.transform.set(entity, transformAt(random() * BOUNDS.width, random() * BOUNDS.height));
    stores.velocity.set(entity, { x: (random() - 0.5) * 90, y: (random() - 0.5) * 90 });
    stores.sprite.set(entity, { radius: 4 + random() * 7, hue: 150 + random() * 60 });
  }
}

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    surface: read('--surface', '#f9fafc'),
    grid: read('--grid', '#c6d0de'),
    ink: read('--ink', '#0f141c'),
    outline: read('--line-strong', '#b7c1ce'),
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

// Un instantané pris à la demande, pour éprouver la sérialisation dès T0.
let saved: Snapshot | null = null;
let savedNote = 'aucun';

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyO') {
    saved = world.snapshot();
    savedNote = `${JSON.stringify(saved).length} octets`;
  } else if (event.code === 'KeyP' && saved) {
    world.restore(saved);
  }
});

const engine = new Engine(
  {
    fixedUpdate(dt) {
      applyControl(stores, keyboard.axis(), dt);
      integrate(stores, dt, BOUNDS);
    },
    render(alpha) {
      render(ctx!, stores, alpha, BOUNDS, palette, cssSize);
    },
  },
  60,
);

function refreshOverlay(): void {
  const stats = engine.getStats();
  overlay!.textContent = [
    `${stats.fps.toFixed(0)} i/s`,
    `${stats.stepsLastFrame} pas`,
    `t = ${(stats.totalSteps / 60).toFixed(1)} s`,
    `${world.entityCount} entités`,
    `instantané : ${savedNote}`,
  ].join('   ·   ');
}

/**
 * Surface d'inspection : tout l'état du jeu, atteignable depuis la console du
 * navigateur (`t0.world.snapshot()`, `t0.stores.transform.get(1)`).
 *
 * C'est délibéré, et c'est la première pierre de l'inspecteur : un outil qui
 * lit l'état d'un jeu doit d'abord pouvoir y accéder. Les tests de bout en
 * bout s'appuient sur la même surface.
 */
(window as unknown as Record<string, unknown>)['t0'] = {
  world,
  stores,
  engine,
  snapshot: () => world.snapshot(),
  /** L'instantané retenu par la touche O, ou null tant qu'aucun n'a été pris. */
  get saved(): Snapshot | null {
    return saved;
  },
};

spawnWorld();
keyboard.attach();
resize();
window.addEventListener('resize', resize, { passive: true });
engine.start();
setInterval(refreshOverlay, 250);
refreshOverlay();
