/**
 * La caméra appartient à l'affichage, jamais à la simulation.
 *
 * Elle est lissée avec le temps réel, ce qui la rend non déterministe — et
 * c'est sans conséquence, précisément parce qu'aucun système de simulation ne
 * la lit. La faire entrer dans `Simulation.step()` casserait le rejeu.
 */
export interface Camera {
  x: number;
  y: number;
  /** Unités du monde par pixel affiché, inverse du zoom. */
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export function createCamera(x = 0, y = 0, scale = 1): Camera {
  return { x, y, scale };
}

/**
 * Rapproche la caméra de sa cible d'une fraction dépendant du temps écoulé.
 *
 * L'exponentielle plutôt qu'un pas fixe : le rattrapage garde la même allure
 * que l'écran affiche 30 ou 144 images par seconde.
 */
export function follow(camera: Camera, targetX: number, targetY: number, elapsedSeconds: number, stiffness = 8): void {
  const t = 1 - Math.exp(-stiffness * Math.max(elapsedSeconds, 0));
  camera.x += (targetX - camera.x) * t;
  camera.y += (targetY - camera.y) * t;
}

export function worldToScreen(camera: Camera, viewport: Viewport, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - camera.x) / camera.scale + viewport.width / 2,
    y: (y - camera.y) / camera.scale + viewport.height / 2,
  };
}

export function screenToWorld(camera: Camera, viewport: Viewport, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - viewport.width / 2) * camera.scale + camera.x,
    y: (y - viewport.height / 2) * camera.scale + camera.y,
  };
}

export interface ChunkRange {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Les morceaux touchant l'écran, avec une marge.
 *
 * La marge est ce qui évite de voir apparaître le décor au bord : on calcule
 * un peu au-delà de ce qui est visible.
 */
export function visibleChunks(
  camera: Camera,
  viewport: Viewport,
  chunkSize: number,
  margin = 1,
): ChunkRange {
  const halfWidth = (viewport.width / 2) * camera.scale;
  const halfHeight = (viewport.height / 2) * camera.scale;
  return {
    minX: Math.floor((camera.x - halfWidth) / chunkSize) - margin,
    minY: Math.floor((camera.y - halfHeight) / chunkSize) - margin,
    maxX: Math.floor((camera.x + halfWidth) / chunkSize) + margin,
    maxY: Math.floor((camera.y + halfHeight) / chunkSize) + margin,
  };
}
