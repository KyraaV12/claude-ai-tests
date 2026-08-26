import type { Entity } from '../core/world.ts';

/**
 * Le lissage des corrections, à l'affichage seulement.
 *
 * Quand l'état d'autorité arrive, le client rejoue ses demandes puis reprend
 * son avance. Le nombre de pas rejoués varie d'un état à l'autre, donc la
 * position extrapolée des *autres* personnages varie aussi : ils sautent d'un
 * pas ou trois, dix fois par seconde. À l'œil, c'est une saccade régulière.
 *
 * La réponse n'est pas de toucher à la simulation — elle doit rester exacte,
 * sinon le déterminisme, le rejeu et les empreintes s'effondrent. On garde
 * donc un **décalage purement visuel** par entité : au moment de la
 * correction, on l'encaisse dans le décalage pour que l'image ne bouge pas,
 * puis on le laisse fondre. Le personnage rejoint sa vraie place en une
 * fraction de seconde, sans jamais sauter.
 *
 * Une fois le décalage nul, l'affichage est de nouveau exactement la
 * simulation : il n'y a ni retard permanent ni molesse ajoutée au mouvement.
 */

export interface Offset {
  x: number;
  y: number;
}

/**
 * Temps de fonte du décalage, en secondes.
 *
 * Calibré en mesurant les saccades de 50 à 200 ms de latence : en deçà de
 * 0,2 s la correction reste visible, au-delà un personnage qui change de
 * direction traîne derrière lui-même. Il faut plusieurs fois la cadence des
 * états — sinon la correction suivante arrive avant que la précédente ait
 * fondu, et le décalage ajoute lui-même de la vitesse à l'image.
 */
const TAU_SECONDS = 0.22;

/** En deçà, le décalage ne se voit plus : on l'oublie plutôt que de le suivre. */
const NEGLIGIBLE = 0.05;

/**
 * Vitesse maximale de rattrapage, en unités par seconde.
 *
 * Sans plafond, un gros décalage se paie d'un élan : la décroissance
 * exponentielle rend l'image plus rapide au début qu'un personnage ne peut
 * courir, et l'on voit un élastique. Un peu plus que la vitesse de course
 * suffit à rattraper sans que cela se remarque comme un mouvement impossible.
 */
const MAX_CATCHUP = 600;

/**
 * Au-delà, ce n'est plus une correction mais une téléportation — reprise d'une
 * sauvegarde, réapparition, entité déplacée de force. Lisser cela ferait
 * traverser l'écran au personnage à toute allure ; on coupe net.
 */
const TOO_FAR = 1200;

export class Smoothing {
  private readonly offsets = new Map<Entity, Offset>();

  /**
   * Encaisse une correction : `dx`, `dy` sont ce dont l'entité a bougé sans
   * que rien ne l'ait fait bouger. On stocke l'opposé, de sorte que l'image
   * reste où elle était.
   */
  record(entity: Entity, dx: number, dy: number): void {
    if (Math.hypot(dx, dy) > TOO_FAR) {
      this.offsets.delete(entity);
      return;
    }
    const current = this.offsets.get(entity);
    const x = (current?.x ?? 0) - dx;
    const y = (current?.y ?? 0) - dy;
    if (Math.hypot(x, y) < NEGLIGIBLE) this.offsets.delete(entity);
    else this.offsets.set(entity, { x, y });
  }

  /** Fait fondre les décalages. Appelé au rythme de l'affichage, pas de la simulation. */
  decay(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;
    const factor = Math.exp(-deltaSeconds / TAU_SECONDS);
    const budget = MAX_CATCHUP * deltaSeconds;

    for (const [entity, offset] of this.offsets) {
      const length = Math.hypot(offset.x, offset.y);
      // Ce que la décroissance voudrait rembourser à cette image, plafonné.
      const paid = Math.min(length * (1 - factor), budget);
      const keep = length > 0 ? (length - paid) / length : 0;
      offset.x *= keep;
      offset.y *= keep;
      if (Math.hypot(offset.x, offset.y) < NEGLIGIBLE) this.offsets.delete(entity);
    }
  }

  offsetOf(entity: Entity): Offset | undefined {
    return this.offsets.get(entity);
  }

  get size(): number {
    return this.offsets.size;
  }

  clear(): void {
    this.offsets.clear();
  }
}
