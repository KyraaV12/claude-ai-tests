/**
 * Pas de temps fixe avec accumulateur.
 *
 * La simulation avance toujours par pas de `dt` secondes, quel que soit le
 * rythme d'affichage. C'est ce qui rend l'état reproductible d'une machine à
 * l'autre — condition nécessaire aux sauvegardes comparables et, plus tard, à
 * la prédiction réseau. Le rendu, lui, interpole entre deux pas.
 */
export interface Tick {
  /** Nombre de pas de simulation à exécuter pour cette image. */
  steps: number;
  /** Reste dans [0, 1) : avancement du rendu entre le dernier pas et le suivant. */
  alpha: number;
}

export class FixedStep {
  readonly dt: number;
  readonly maxStepsPerFrame: number;
  private accumulator = 0;

  constructor(dt: number, maxStepsPerFrame = 5) {
    if (!(dt > 0)) throw new RangeError(`dt doit être strictement positif, reçu ${dt}`);
    if (!(maxStepsPerFrame >= 1)) throw new RangeError(`maxStepsPerFrame doit valoir au moins 1`);
    this.dt = dt;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  /**
   * Consomme le temps écoulé et indique combien de pas exécuter.
   *
   * Le temps ajouté est plafonné à `dt * maxStepsPerFrame` : après une pause
   * (onglet en arrière-plan, point d'arrêt), on abandonne le retard au lieu de
   * tenter de le rattraper. Sans ce plafond, chaque image demanderait plus de
   * pas que la précédente et la boucle s'effondrerait.
   */
  advance(elapsedSeconds: number): Tick {
    const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
    this.accumulator += Math.min(elapsed, this.dt * this.maxStepsPerFrame);
    let steps = 0;
    while (this.accumulator >= this.dt) {
      this.accumulator -= this.dt;
      steps++;
    }
    return { steps, alpha: this.accumulator / this.dt };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
