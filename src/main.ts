import { Simulation, STEPS_PER_SECOND, PLAYER } from './core/simulation.ts';
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
import { ChannelTransport } from './net/channel-transport.ts';
import { Host } from './net/host.ts';
import { Client } from './net/client.ts';

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

/**
 * Le pair local : hôte ou client, décidé au chargement.
 *
 * L'identifiant de joueur est tiré au sort ici, hors simulation — il désigne
 * une connexion, pas un état du monde. Il entre ensuite dans la simulation par
 * `addPlayer`, qui en dérive une position de départ : la reproductibilité tient
 * donc à la suite des identifiants, pas au hasard.
 */
type Role = 'solo' | 'hôte' | 'client';
let role: Role = 'solo';
let host: Host | null = null;
let client: Client | null = null;
const localPlayer = 1 + Math.floor(Math.random() * 1_000_000);

let simulation = new Simulation(SEED, [PLAYER]);
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

function activePlayer(): number {
  return role === 'solo' ? PLAYER : localPlayer;
}

function playerEntity(): number | null {
  return simulation.entityOf(activePlayer());
}

function playerPosition(): { x: number; y: number } {
  const entity = playerEntity();
  const transform = entity === null ? undefined : simulation.stores.transform.get(entity);
  return transform ? { x: transform.x, y: transform.y } : simulation.spawn;
}

function inventoryOfPlayer() {
  const entity = playerEntity();
  return entity === null ? undefined : simulation.stores.inventory.get(entity);
}

function controlOfPlayer() {
  const entity = playerEntity();
  return entity === null ? undefined : simulation.stores.controlled.get(entity);
}

/**
 * Ce que les dernières tentatives ont donné, dit au joueur.
 *
 * Une réussite de récolte prime sur un refus de pose : c'est l'événement le
 * plus récent qui intéresse, et gagner du bois répond souvent au refus.
 */
function actionStatus(): string {
  const blocs = inventoryOfPlayer()?.blocs ?? 0;
  const harvest = simulation.lastHarvest;
  const build = simulation.lastBuild;

  if (harvest?.harvested && controlOfPlayer()!.harvestCooldown > 0) {
    return `${blocs} blocs — +${harvest.gained} (${harvest.kind})`;
  }
  if (harvest && !harvest.harvested && harvest.reason !== 'attente') {
    return `${blocs} blocs — ${harvest.reason}`;
  }
  if (build && !build.placed && build.reason !== 'attente') {
    return `${blocs} blocs — ${build.reason}`;
  }
  return `${blocs} blocs`;
}

/** Démarre un enregistrement sur un monde neuf, moteur en marche. */
function startRecording(): void {
  if (client) {
    setVerdict('enregistrement indisponible côté client : l autorité réécrit l état', 'alerte');
    return;
  }
  engine.resume();
  simulation = new Simulation(SEED, [activePlayer()]);
  if (host) host.simulation.restore(simulation.snapshot(), 0);
  recorder = new Recorder(SEED, simulation.players());
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
      const axis = keyboard.axis();
      // L'action de pose fait partie de l'entrée : un geste hors de la trame
      // ne serait pas enregistré, et le rejeu divergerait sans explication.
      const input = {
        x: axis.x,
        y: axis.y,
        build: keyboard.isPressed('KeyE'),
        harvest: keyboard.isPressed('KeyF'),
      };

      if (host) {
        host.setLocalInput(input);
        host.advance();
        recorder?.capture(host.lastTick);
      } else if (client) {
        // Pas d'enregistrement côté client : sa simulation est réécrite par
        // l'autorité, un rejeu local ne prouverait rien.
        client.setLocalInput(input);
        client.advance();
      } else {
        const tick = [{ player: PLAYER, ...input }];
        recorder?.capture(tick);
        simulation.step(tick);
      }
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
    actionStatus(),
    `${chunks.size} morceaux · ${simulation.stores.harvested.size} récoltés`,
    networkStatus(),
    recorder ? `● ${recorder.frameCount} pas` : `${simulation.world.entityCount} entités`,
  ].join('   ·   ');
}

function networkStatus(): string {
  const players = simulation.players().length;
  if (role === 'solo') return 'solo';
  if (client) {
    const lead = client.simulation.stepCount;
    return `client · ${players} joueurs · ${client.selfCorrections} corrections · pas ${lead}`;
  }
  return `hôte · ${players} joueurs`;
}

/**
 * Élection : on demande l'état ; si personne ne répond, on devient l'hôte.
 *
 * Aucun serveur n'est disponible sur un site statique. `BroadcastChannel` ne
 * franchit pas le navigateur — c'est un banc d'essai du netcode, pas du
 * multijoueur par Internet. Le transport étant une interface, un WebSocket se
 * substituerait ici sans toucher au reste.
 */
function electRole(): void {
  const scout = new ChannelTransport();
  let decided = false;

  scout.onMessage((message) => {
    if (decided || message.kind !== 'state') return;
    decided = true;
    scout.close();
    client = new Client(SEED, new ChannelTransport(), localPlayer);
    simulation = client.simulation;
    role = 'client';
    setVerdict('client — l état vient de l hôte, vos demandes sont prédites puis confirmées', 'neutre');
  });

  scout.send({ kind: 'hello' });

  window.setTimeout(() => {
    if (decided) return;
    decided = true;
    scout.close();
    host = new Host(SEED, new ChannelTransport(), localPlayer);
    simulation = host.simulation;
    role = 'hôte';
    setVerdict('hôte — ouvrez un second onglet pour faire entrer un joueur', 'neutre');
  }, 400);
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
  get role() {
    return role;
  },
  get host() {
    return host;
  },
  get client() {
    return client;
  },
  localPlayer,
  replay,
  compare,
  CHUNK_SIZE,
};

keyboard.attach();
resize();
window.addEventListener('resize', resize, { passive: true });
setVerdict('appuyez sur R pour enregistrer une session', 'neutre');
electRole();
engine.start();
setInterval(refreshOverlay, 250);
refreshOverlay();
