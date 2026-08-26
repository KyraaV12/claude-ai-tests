import type { Axis } from './input.ts';
import type { Entity } from '../core/world.ts';
import type { Stores } from '../core/components.ts';
import { vectorLength } from '../core/trig.ts';

/**
 * Déplacement dans un monde sans bords.
 *
 * Il n'y a plus de repli : le monde est ouvert, une entité peut s'éloigner
 * indéfiniment. Ce qui la retient est le décor et le jeu, pas une bordure.
 */

/**
 * Traduit la direction demandée en accélération, puis borne la vitesse.
 *
 * Agit sur une entité désignée, et non sur toutes les entités pilotées : dès
 * qu'un monde compte plusieurs joueurs, chacun a sa propre demande.
 */
export function applyControl(stores: Stores, entity: Entity, axis: Axis, dt: number): void {
  const control = stores.controlled.get(entity);
  const velocity = stores.velocity.get(entity);
  if (control && velocity) {

    if (axis.x !== 0 || axis.y !== 0) {
      velocity.x += axis.x * control.acceleration * dt;
      velocity.y += axis.y * control.acceleration * dt;
      // La direction est retenue : à l'arrêt, on doit encore savoir où poser.
      control.facingX = axis.x;
      control.facingY = axis.y;
    } else {
      const decay = Math.max(0, 1 - control.damping * dt);
      velocity.x *= decay;
      velocity.y *= decay;
    }

    const speed = vectorLength(velocity.x, velocity.y);
    if (speed > control.maxSpeed) {
      const scale = control.maxSpeed / speed;
      velocity.x *= scale;
      velocity.y *= scale;
    }
  }
}

/**
 * Intègre les vitesses.
 *
 * La position précédente est conservée avant d'avancer : c'est elle que le
 * rendu interpole, et sans elle l'affichage saccaderait entre deux pas.
 */
export function integrate(stores: Stores, dt: number): void {
  for (const [entity, transform] of stores.transform.entries()) {
    transform.previousX = transform.x;
    transform.previousY = transform.y;

    const velocity = stores.velocity.get(entity);
    if (!velocity) continue;

    transform.x += velocity.x * dt;
    transform.y += velocity.y * dt;
  }
}
