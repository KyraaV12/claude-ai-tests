import type { Entity } from '../core/world.ts';
import type { Stores } from '../core/components.ts';
import type { Camera, Viewport } from '../world/camera.ts';
import { visibleChunks, worldToScreen } from '../world/camera.ts';
import { CHUNK_SIZE } from '../world/chunk.ts';
import type { ChunkCache } from '../world/chunk.ts';
import type { TerrainPainter } from './terrain-painter.ts';

const PROP_COLORS = { arbre: '#274C31', rocher: '#6E7275' };

export interface Palette {
  ink: string;
  accent: string;
}

export interface Scene {
  stores: Stores;
  chunks: ChunkCache;
  painter: TerrainPainter;
  camera: Camera;
  viewport: Viewport;
  palette: Palette;
  /** Avancement du rendu entre le dernier pas de simulation et le suivant. */
  alpha: number;
  highlight: Entity | null;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export function render(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { camera, viewport, chunks, stores, palette, alpha } = scene;

  ctx.clearRect(0, 0, viewport.width, viewport.height);
  drawTerrain(ctx, scene);

  // Le décor d'abord, les entités ensuite : ce qui bouge passe devant.
  const range = visibleChunks(camera, viewport, CHUNK_SIZE);
  for (let cy = range.minY; cy <= range.maxY; cy++) {
    for (let cx = range.minX; cx <= range.maxX; cx++) {
      for (const prop of chunks.get(cx, cy).props) {
        const point = worldToScreen(camera, viewport, prop.x, prop.y);
        ctx.beginPath();
        ctx.arc(point.x, point.y, prop.radius / camera.scale, 0, Math.PI * 2);
        ctx.fillStyle = PROP_COLORS[prop.kind];
        ctx.fill();
      }
    }
  }

  for (const [entity, transform] of stores.transform.entries()) {
    const sprite = stores.sprite.get(entity);
    const body = stores.body.get(entity);
    if (!sprite || !body) continue;

    const point = worldToScreen(
      camera,
      viewport,
      lerp(transform.previousX, transform.x, alpha),
      lerp(transform.previousY, transform.y, alpha),
    );
    const radius = body.radius / camera.scale;

    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${sprite.hue} 72% 58%)`;
    ctx.fill();

    if (stores.controlled.has(entity)) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.ink;
      ctx.stroke();
    }

    // La sélection de l'inspecteur porte un anneau, à l'écart du corps : sans
    // lui, choisir une entité dans la liste ne dirait pas laquelle c'est ici.
    if (entity === scene.highlight) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 7, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.accent;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/**
 * Recopie l'image de chaque morceau visible, à l'échelle de la caméra.
 *
 * Le lissage du navigateur adoucit les frontières entre biomes : à cette
 * résolution, des carrés nets se liraient comme un défaut plutôt que comme un
 * parti pris. Un demi-pixel de recouvrement évite les fentes entre morceaux.
 */
function drawTerrain(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { camera, viewport, chunks, painter } = scene;
  const range = visibleChunks(camera, viewport, CHUNK_SIZE);
  const chunkOnScreen = CHUNK_SIZE / camera.scale;

  // Lissage à la qualité par défaut : « high » multiplie le coût de chaque
  // agrandissement, et à plus de cent morceaux par image la différence se paie
  // en fluidité sans se voir à l'écran.
  ctx.imageSmoothingEnabled = true;

  for (let cy = range.minY; cy <= range.maxY; cy++) {
    for (let cx = range.minX; cx <= range.maxX; cx++) {
      const chunk = chunks.get(cx, cy);
      const corner = worldToScreen(camera, viewport, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
      ctx.drawImage(painter.imageFor(chunk), corner.x, corner.y, chunkOnScreen + 0.5, chunkOnScreen + 0.5);
    }
  }
}
