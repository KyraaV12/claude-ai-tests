import type { Entity } from '../core/world.ts';
import type { Stores, Transform, Velocity, Body } from '../core/components.ts';
import type { Bounds } from './movement.ts';
import { shortestDelta } from './movement.ts';

/**
 * Collisions entre disques.
 *
 * Comparaison de toutes les paires : avec quelques dizaines de corps, les
 * ~300 tests par pas ne coûtent rien. Une phase large (grille, quadtree)
 * viendra quand un profilage le réclamera — et l'interface de ce module
 * n'aura pas à changer pour l'accueillir.
 *
 * L'ordre de parcours suit l'ordre d'insertion des composants, identique d'une
 * exécution à l'autre : deux simulations aux mêmes entrées résolvent les mêmes
 * collisions dans le même ordre, et finissent dans le même état.
 */

interface Colliding {
  entity: Entity;
  transform: Transform;
  velocity: Velocity;
  body: Body;
}

function gather(stores: Stores): Colliding[] {
  const out: Colliding[] = [];
  for (const [entity, transform] of stores.transform.entries()) {
    const velocity = stores.velocity.get(entity);
    const body = stores.body.get(entity);
    if (velocity && body) out.push({ entity, transform, velocity, body });
  }
  return out;
}

/**
 * Sépare les corps qui se chevauchent et échange leurs quantités de mouvement.
 *
 * Le choc est parfaitement élastique : la quantité de mouvement totale est
 * conservée. C'est vérifié par un test — s'il casse, c'est que la réponse a
 * cessé d'être symétrique, et une simulation qui perd de l'énergie ne se
 * réplique pas.
 */
export function resolveCollisions(stores: Stores, bounds: Bounds): void {
  const bodies = gather(stores);

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;

      // Le monde se replie sur lui-même : deux corps de part et d'autre d'un
      // bord sont voisins, et l'écart le plus court peut passer par le bord.
      const dx = shortestDelta(b.transform.x - a.transform.x, bounds.width);
      const dy = shortestDelta(b.transform.y - a.transform.y, bounds.height);

      const distance = Math.hypot(dx, dy);
      const contact = a.body.radius + b.body.radius;
      if (distance >= contact) continue;

      // Corps exactement superposés : aucune normale ne s'impose. On en choisit
      // une stable plutôt que de diviser par zéro.
      const nx = distance > 0 ? dx / distance : 1;
      const ny = distance > 0 ? dy / distance : 0;

      separate(a, b, nx, ny, contact - (distance > 0 ? distance : 0));
      exchangeMomentum(a, b, nx, ny);
    }
  }
}

/** Écarte les deux corps le long de la normale, au prorata inverse des masses. */
function separate(a: Colliding, b: Colliding, nx: number, ny: number, overlap: number): void {
  const total = a.body.mass + b.body.mass;
  const shareA = b.body.mass / total;
  const shareB = a.body.mass / total;

  a.transform.x -= nx * overlap * shareA;
  a.transform.y -= ny * overlap * shareA;
  b.transform.x += nx * overlap * shareB;
  b.transform.y += ny * overlap * shareB;
}

function exchangeMomentum(a: Colliding, b: Colliding, nx: number, ny: number): void {
  const relative = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny;
  // Déjà en train de s'éloigner : les réunir ferait vibrer le contact.
  if (relative > 0) return;

  const impulse = (-2 * relative) / (1 / a.body.mass + 1 / b.body.mass);
  a.velocity.x -= (impulse * nx) / a.body.mass;
  a.velocity.y -= (impulse * ny) / a.body.mass;
  b.velocity.x += (impulse * nx) / b.body.mass;
  b.velocity.y += (impulse * ny) / b.body.mass;
}
