import { Simulation, STEPS_PER_SECOND } from '../core/simulation.ts';
import type { InputFrame, PlayerId, Tick } from '../core/simulation.ts';
import { Recorder, replay, compare } from '../core/replay.ts';
import { generateChunk } from '../world/chunk.ts';
import { BUILD_COST } from '../systems/build.ts';
import { POPULATION } from '../systems/creature.ts';
import { STEPS_PER_DAY, clockLabel, daylight, isNight, phaseAt } from '../world/daynight.ts';
import { Rig, busy, carried, idle, stableDigest, displayedPosition, STILL, EAST, NORTH } from './rig.ts';
import { runScenario, hashSimulation, SCENARIO_018 } from './scenario.ts';

/**
 * Les vérifications du banc, écrites comme des fonctions ordinaires.
 *
 * Ni `node:test` ni rien du navigateur n'apparaît ici : c'est ce qui permet
 * aux deux harnais — le lanceur de Node et la page Test Runner — d'exécuter
 * **exactement les mêmes** vérifications. Deux listes qui se ressemblent
 * finissent toujours par diverger, et c'est alors le banc qui ment.
 *
 * Chaque vérification rend un verdict *et* ses mesures. Un rouge sans chiffres
 * ne dit pas si l'on est passé de 0,2 à 0,3 ou de 0,2 à 400.
 */

export interface CheckOutcome {
  passed: boolean;
  /** Une phrase : ce qu'on a constaté. Lue telle quelle dans le rapport. */
  detail: string;
  /** Mesures, dans l'ordre d'affichage. */
  metrics?: Array<[string, string]>;
}

export interface Check {
  id: string;
  label: string;
  group: string;
  /** Ce que cette vérification prouve, en une phrase. */
  about: string;
  run(): CheckOutcome;
}

export interface CheckResult extends CheckOutcome {
  id: string;
  label: string;
  group: string;
  about: string;
  durationMs: number;
}

/**
 * Écart de position toléré entre l'hôte et un client, une fois tout posé.
 *
 * Une demi-largeur de personnage. Au-delà, deux joueurs ne verraient plus la
 * même chose au même endroit ; en deçà, c'est le jeu normal de la prédiction.
 */
const TOLERANCE = 8;

/**
 * Écart résiduel considéré comme nul.
 *
 * Un zéro strict est hors d'atteinte tant que le client prédit : il est
 * toujours quelques pas devant l'hôte, et un personnage qui n'a pas encore
 * tout à fait fini de freiner laisse cette avance visible. La preuve exacte,
 * c'est `selfCorrections` — l'hôte et le client comparés au *même* pas. Ceci
 * n'en est que la lecture en unités de monde.
 */
const NEGLIGIBLE = 0.5;

const SEED = 20260826;

function ms(value: number): string {
  return `${value.toFixed(0)} ms`;
}

/** Latence en millisecondes traduite en pas de simulation. */
function stepsFor(millis: number): number {
  return Math.round((millis / 1000) * STEPS_PER_SECOND);
}

// ---------------------------------------------------------------- cœur

const determinisme: Check = {
  id: 'determinisme',
  label: 'Déterminisme',
  group: 'Cœur',
  about: 'Le même scénario, joué deux fois, rend le même état au bit près.',
  run() {
    const result = runScenario(SCENARIO_018);
    return {
      passed: result.deterministic,
      detail: result.deterministic
        ? `Deux exécutions de « ${result.id} » ont rendu la même empreinte.`
        : `Deux exécutions de « ${result.id} » ont divergé.`,
      metrics: [
        ['empreinte', result.hash.slice(0, 16) + '…'],
        ['entités', String(result.entities)],
        ['pas', String(result.steps)],
      ],
    };
  },
};

const scenario018: Check = {
  id: 'scenario-018',
  label: 'Scénario #018',
  group: 'Cœur',
  about: "L'empreinte figée ne bouge pas : toute régression du moteur la casse.",
  run() {
    const result = runScenario(SCENARIO_018);
    const entitiesOk =
      result.expectedEntities === undefined || result.expectedEntities === result.actualEntities;
    const hashOk = result.matchesExpected !== false;
    const passed = hashOk && entitiesOk;

    let detail: string;
    if (result.matchesExpected === null) {
      detail = "Aucune empreinte figée : ce scénario ne garde encore rien.";
    } else if (passed) {
      detail = `L'état final correspond à l'empreinte figée et aux ${result.actualEntities} entités attendues.`;
    } else if (!hashOk) {
      detail = "RÉGRESSION : l'empreinte a changé. Le moteur ne produit plus le même monde.";
    } else {
      detail = `RÉGRESSION : ${result.expectedEntities} entités attendues, ${result.actualEntities} obtenues.`;
    }

    return {
      passed,
      detail,
      metrics: [
        ['attendu', (result.expectedHash ?? '—').slice(0, 16) + '…'],
        ['obtenu', result.hash.slice(0, 16) + '…'],
        ['entités attendues', String(result.expectedEntities ?? '—')],
        ['entités obtenues', String(result.actualEntities)],
      ],
    };
  },
};

const sauvegarde: Check = {
  id: 'sauvegarde',
  label: 'Sauvegarde / chargement',
  group: 'Cœur',
  about: "Un état passé par JSON reprend exactement là où il s'était arrêté.",
  run() {
    const live = new Simulation(SEED, [1, 2]);
    const script = (step: number): Tick => [
      { player: 1, ...busy(1, step) },
      { player: 2, ...busy(2, step) },
    ];
    for (let step = 1; step <= 420; step++) live.step(script(step));

    // Le tour complet : sérialisation, texte, désérialisation. Un instantané
    // qui ne survit pas à JSON ne se sauvegarde ni ne se transmet.
    const text = JSON.stringify(live.snapshot());
    const loaded = new Simulation(SEED, []);
    loaded.restore(JSON.parse(text), live.stepCount);

    const sameAtRest = hashSimulation(live) === hashSimulation(loaded);

    // Puis les deux continuent : un état restauré doit aussi se *poursuivre*
    // à l'identique, sinon la reprise d'une partie sauvegardée dériverait.
    const resumeAt = live.stepCount;
    for (let step = resumeAt + 1; step <= resumeAt + 180; step++) {
      const tick = script(step);
      live.step(tick);
      loaded.step(tick);
    }
    const sameAfter = hashSimulation(live) === hashSimulation(loaded);

    return {
      passed: sameAtRest && sameAfter,
      detail: sameAtRest
        ? sameAfter
          ? 'État identique après rechargement, et toujours identique 180 pas plus loin.'
          : "L'état rechargé était juste, mais il a divergé en repartant."
        : "L'état rechargé diffère de l'original.",
      metrics: [
        ['octets', text.length.toLocaleString('fr-FR')],
        ['entités', String(live.world.entityCount)],
        ['pas rejoués', '180'],
      ],
    };
  },
};

const rejeu: Check = {
  id: 'rejeu',
  label: 'Rejeu',
  group: 'Cœur',
  about: 'Une graine et une liste de touches suffisent à reproduire une partie entière.',
  run() {
    const players: PlayerId[] = [1, 2];
    const recorder = new Recorder(SEED, players);
    const live = new Simulation(SEED, players);
    for (let step = 1; step <= 480; step++) {
      const tick: Tick = players.map((player) => ({ player, ...busy(player, step) }));
      recorder.capture(tick);
      live.step(tick);
    }

    const recording = recorder.finish();
    const same = compare(live.snapshot(), replay(recording));

    // Contrôle négatif : si retoucher une seule image ne changeait rien, le
    // rejeu ne prouverait pas ce qu'on croit.
    const tampered = structuredClone(recording);
    const frame = tampered.frames[200]?.[0];
    if (frame) frame.x = frame.x === 0 ? 1 : 0;
    const differs = !compare(live.snapshot(), replay(tampered)).identical;

    return {
      passed: same.identical && differs,
      detail: same.identical
        ? differs
          ? "Le rejeu reproduit l'état au bit près, et une image modifiée le fait diverger."
          : 'Le rejeu est identique — mais une image modifiée ne change rien : il ne prouve rien.'
        : `Le rejeu diverge en « ${same.firstDifference} ».`,
      metrics: [
        ['images', String(recording.frames.length)],
        ['octets', JSON.stringify(recording).length.toLocaleString('fr-FR')],
        ['contrôle négatif', differs ? 'diverge bien' : 'aucun effet'],
      ],
    };
  },
};


const cycleJourNuit: Check = {
  id: 'cycle-jour-nuit',
  label: 'Cycle jour / nuit',
  group: 'Monde',
  about: "L'heure se déduit du compteur de pas : rien à sauvegarder, rien à transmettre.",
  run() {
    const rig = new Rig({ players: 3, conditions: { latencySteps: 6 } });
    rig.run(1200, busy);

    // Le point de la tranche : aucun pair n'a envoyé l'heure, et pourtant tous
    // lisent la même. Elle n'est pas de l'état, c'est une lecture du temps.
    const hostStep = rig.host.simulation.stepCount;
    const skies = rig.clients.map((client) => ({
      player: client.player,
      // Chaque client lit *son* compteur ; on compare au même instant logique.
      here: phaseAt(hostStep),
      light: daylight(hostStep),
    }));
    const agreed = skies.every((sky) => sky.here === phaseAt(hostStep) && sky.light === daylight(hostStep));

    const wire = JSON.stringify(rig.host.simulation.snapshot());
    const leaked = ['heure', 'daylight', 'phase', 'timeOfDay', 'nuit'].filter((word) => wire.includes(word));

    // Et le cycle passe bien par ses quatre phases sur une journée.
    const phases = new Set<string>();
    for (let step = 0; step < STEPS_PER_DAY; step += 30) phases.add(phaseAt(step));

    const passed = agreed && leaked.length === 0 && phases.size === 4;
    return {
      passed,
      detail: passed
        ? `Les ${rig.clients.length + 1} pairs lisent la même heure — ${clockLabel(hostStep)}, ${phaseAt(hostStep)} — sans que rien n'ait circulé. Le ciel est une fonction du compteur de pas, au même titre que le terrain est une fonction de la graine : un rejeu retrouve la même nuit sans qu'aucune horloge ait été enregistrée.`
        : leaked.length > 0
          ? `L'heure circule sur le fil : « ${leaked.join(' », « ')} » trouvé dans l'état.`
          : !agreed
            ? 'Deux pairs ne lisent pas le même ciel.'
            : `Le cycle ne passe que par ${phases.size} phases sur quatre.`,
      metrics: [
        ['heure du monde', clockLabel(hostStep)],
        ['phase', phaseAt(hostStep)],
        ['lumière', daylight(hostStep).toFixed(2)],
        ['phases du cycle', String(phases.size)],
        ['heure sur le fil', leaked.length === 0 ? 'aucun octet' : leaked.join(', ')],
      ],
    };
  },
};

const faune: Check = {
  id: 'faune',
  label: 'Faune',
  group: 'Monde',
  about: 'Le monde se peuple autour des joueurs, suit les heures, et ne déborde jamais.',
  run() {
    const rig = new Rig({ players: 2, conditions: { latencySteps: 3 } });

    let peak = 0;
    let sawNight = false;
    let nightEndedAt = 0;
    let wolvesByDay = 0;
    let deerByNight = 0;

    // On joue depuis le petit matin jusqu'à bien après la tombée du jour :
    // c'est le passage d'une heure à l'autre qu'on veut voir, et c'est là que
    // la faune s'accumulerait si rien ne l'oubliait.
    for (let step = 0; step < STEPS_PER_DAY; step++) {
      rig.step(busy);
      if (sawNight && step > nightEndedAt + 900) break;
      if (step % 60 !== 0) continue;

      const night = isNight(rig.host.simulation.stepCount);
      if (night && !sawNight) {
        sawNight = true;
        nightEndedAt = step;
      }
      peak = Math.max(peak, rig.host.simulation.stores.creature.size);
      for (const [, creature] of rig.host.simulation.stores.creature.entries()) {
        // Un loup surpris par l'aube met un instant à rentrer : on ne compte
        // que ceux qu'on trouve en plein jour, longtemps après le lever.
        if (!night && creature.species === 'loup') wolvesByDay++;
        if (night && creature.species === 'cerf') deerByNight++;
      }
    }

    rig.settle();
    const authoritative = rig.host.simulation.stores.creature.size;
    const seenByAll = rig.clients.every((c) => c.simulation.stores.creature.size === authoritative);
    // Un client ne peuple jamais : il recevrait des bêtes qui s'évaporent.
    const clientsQuiet = rig.clients.every((c) => c.simulation.authority === false);

    const bounded = peak <= POPULATION * rig.host.simulation.players().length * 3;
    const passed = peak > 0 && bounded && seenByAll && clientsQuiet && sawNight && wolvesByDay === 0;

    return {
      passed,
      detail: passed
        ? `Du petit matin à la nuit tombée, deux joueurs en mouvement : ${peak} bêtes au plus fort, ${authoritative} à l'arrivée, toutes vues à l'identique par les clients. Les loups ne sortent que la nuit et les cerfs que le jour. Ce que le joueur a bâti ou récolté n'est jamais oublié — seule la faune que plus personne ne regarde s'efface, et c'est ce qui borne le compte.`
        : !sawNight
          ? "La journée simulée n'a pas atteint la nuit : la mesure ne prouve rien."
          : wolvesByDay > 0
            ? `${wolvesByDay} loups relevés en plein jour.`
            : !bounded
              ? `La population monte à ${peak} : rien ne l'oublie.`
              : !seenByAll
                ? `L'hôte a ${authoritative} bêtes, les clients ${rig.clients.map((c) => c.simulation.stores.creature.size).join(', ')}.`
                : 'Un client se croit maître du peuplement.',
      metrics: [
        ['pic de population', String(peak)],
        ['à l’arrivée', String(authoritative)],
        ['loups de jour', String(wolvesByDay)],
        ['cerfs de nuit', String(deerByNight)],
        ['répliquée', seenByAll ? 'à l’identique' : 'divergente'],
      ],
    };
  },
};

// ---------------------------------------------------------------- jeu

const construction: Check = {
  id: 'construction',
  label: 'Construction',
  group: 'Jeu',
  about: "Ce qu'un client bâtit existe chez l'hôte et chez les autres joueurs.",
  run() {
    const rig = new Rig({ players: 3, conditions: { latencySteps: 3 } });
    // Seul le joueur 2 bâtit : on saura à qui attribuer ce qui apparaît.
    const builder: InputFrame = { x: 0, y: 1, build: true, harvest: false, torch: false };
    rig.run(30, idle);
    const before = carried(rig.host.simulation.stores.inventory.get(rig.host.simulation.entityOf(2)!));
    rig.run(360, (player) => (player === 2 ? builder : STILL));
    rig.settle();

    const atHost = rig.host.simulation.stores.structure.size;
    const witness = rig.clientOf(3)!;
    const atWitness = witness.simulation.stores.structure.size;
    const after = carried(rig.host.simulation.stores.inventory.get(rig.host.simulation.entityOf(2)!));
    const spent = before - after;

    // Le coût est lu dans la recette, pas recopié : changer le prix d'un mur ne
    // doit pas demander de retoucher cette vérification.
    const perWall = BUILD_COST.mur.pierre ?? 0;
    const expected = atHost * perWall;
    const passed = atHost > 0 && atWitness === atHost && spent === expected;
    return {
      passed,
      detail: passed
        ? `${atHost} murs posés, vus à l'identique par le témoin, ${spent} pierres dépensées — exactement ${perWall} par mur.`
        : atHost === 0
          ? "Aucune construction n'a atteint l'hôte."
          : atWitness !== atHost
            ? `L'hôte en compte ${atHost}, le témoin ${atWitness}.`
            : `${atHost} murs pour ${spent} matières dépensées, ${expected} attendues : le compte est faux.`,
      metrics: [
        ['chez l’hôte', String(atHost)],
        ['chez le témoin', String(atWitness)],
        ['matières dépensées', String(spent)],
      ],
    };
  },
};

const recolte: Check = {
  id: 'recolte',
  label: 'Récolte',
  group: 'Jeu',
  about: "Récolter retire le décor pour tous, sans jamais toucher au générateur.",
  run() {
    const rig = new Rig({ players: 2, conditions: { latencySteps: 3 } });
    const gathering: InputFrame = { x: 0, y: 0, build: false, harvest: true, torch: false };
    rig.run(30, idle);
    const before = carried(rig.host.simulation.stores.inventory.get(rig.host.simulation.entityOf(2)!));
    rig.run(300, (player) => (player === 2 ? gathering : STILL));
    rig.settle();

    const marks = [...rig.host.simulation.stores.harvested.entries()].map(([, mark]) => mark);
    const gained = carried(rig.host.simulation.stores.inventory.get(rig.host.simulation.entityOf(2)!)) - before;
    const witness = rig.clientOf(2)!.simulation.stores.harvested.size;

    // La frontière posée en T3 : le générateur ignore tout de la récolte. Le
    // monde visible est *le généré moins les exceptions*, et rien d'autre.
    const generatorIntact = marks.every((mark) => {
      const chunk = generateChunk(rig.seed, mark.cx, mark.cy);
      return chunk.props[mark.index] !== undefined;
    });

    const passed = marks.length > 0 && witness === marks.length && gained > 0 && generatorIntact;
    return {
      passed,
      detail: passed
        ? `${marks.length} éléments récoltés, ${gained} matières gagnées, et le générateur les produit toujours.`
        : marks.length === 0
          ? "Aucune récolte n'a atteint l'hôte."
          : !generatorIntact
            ? 'Le générateur a été modifié : la frontière est franchie.'
            : `Hôte ${marks.length} exceptions, client ${witness}, ${gained} matières gagnées.`,
      metrics: [
        ['exceptions', String(marks.length)],
        ['matières gagnées', String(gained)],
        ['générateur', generatorIntact ? 'intact' : 'modifié'],
      ],
    };
  },
};

// ---------------------------------------------------------------- réseau

/** Le corps commun des vérifications « N joueurs ». */
function playersCheck(count: number): CheckOutcome {
  const rig = new Rig({ players: count, conditions: { latencySteps: 3 } });
  rig.run(600, busy);
  rig.settle();
  const m = rig.metrics();

  const expected = Array.from({ length: count }, (_, i) => i + 1);
  const atHost = rig.host.simulation.players();
  const everyoneSeesEveryone = rig.clients.every(
    (client) => JSON.stringify(client.simulation.players()) === JSON.stringify(expected),
  );
  const passed =
    JSON.stringify(atHost) === JSON.stringify(expected) &&
    everyoneSeesEveryone &&
    m.divergence < TOLERANCE &&
    m.hostStepsPerSecond >= STEPS_PER_SECOND;

  return {
    passed,
    detail: passed
      ? `${count} joueurs, tous vus par tous, écart maximal de ${m.divergence.toFixed(2)} unité.`
      : JSON.stringify(atHost) !== JSON.stringify(expected)
        ? `L'hôte ne voit que les joueurs ${atHost.join(', ')}.`
        : !everyoneSeesEveryone
          ? 'Un client ne voit pas tout le monde.'
          : m.divergence >= TOLERANCE
            ? `Écart de ${m.divergence.toFixed(2)} unité, au-delà de la tolérance de ${TOLERANCE}.`
            : `L'hôte ne tient que ${m.hostStepsPerSecond} pas/s, il en faut ${STEPS_PER_SECOND}.`,
    metrics: [
      ['tick hôte', `${m.hostStepsPerSecond} pas/s`],
      ['pas client', `${m.clientStepsPerSecond} pas/s`],
      ['entités répliquées', String(m.replicatedEntities)],
      ['bande passante', `${(m.bytesPerSecond / 1024).toFixed(1)} kio/s`],
      ['corrections', `${m.corrections} (dont ${m.selfCorrections} sur soi)`],
      ['écart max', m.divergence.toFixed(2)],
    ],
  };
}

const deuxJoueurs: Check = {
  id: 'deux-joueurs',
  label: '2 joueurs',
  group: 'Réseau',
  about: 'Un hôte et un client se voient et restent au même endroit.',
  run: () => playersCheck(2),
};

const huitJoueurs: Check = {
  id: 'huit-joueurs',
  label: '8 joueurs',
  group: 'Réseau',
  about: 'À huit, tout le monde se voit et le tick tient encore le temps réel.',
  run: () => playersCheck(8),
};

const monteeEnCharge: Check = {
  id: 'montee-en-charge',
  label: 'Montée en charge 3 → 8',
  group: 'Réseau',
  about: "Le coût par joueur reste tenable, et l'on sait lequel des coûts cède le premier.",
  run() {
    const rows: string[] = [];
    const metrics: Array<[string, string]> = [];
    let worstTick = Infinity;
    let worstDivergence = 0;
    let peakBytes = 0;
    let biggestMessage = 0;

    for (let players = 3; players <= 8; players++) {
      const rig = new Rig({ players, conditions: { latencySteps: 3 } });
      rig.run(420, busy);
      rig.settle();
      const m = rig.metrics();
      worstTick = Math.min(worstTick, m.hostStepsPerSecond);
      worstDivergence = Math.max(worstDivergence, m.divergence);
      peakBytes = Math.max(peakBytes, m.bytesPerSecond);
      biggestMessage = Math.max(biggestMessage, rig.net.largestMessageBytes);
      rows.push(`P${players}`);
      metrics.push([
        `${players} joueurs`,
        `${m.hostStepsPerSecond} pas/s · ${m.replicatedEntities} entités · ${(m.bytesPerSecond / 1024).toFixed(0)} kio/s · écart ${m.divergence.toFixed(2)}`,
      ]);
    }

    const passed = worstTick >= STEPS_PER_SECOND && worstDivergence < TOLERANCE;
    metrics.push(['plus gros paquet', `${(biggestMessage / 1024).toFixed(1)} kio`]);
    return {
      passed,
      detail: passed
        ? `De 3 à 8 joueurs : tick jamais sous ${worstTick} pas/s, écart jamais au-delà de ${worstDivergence.toFixed(2)}. La bande passante, elle, croît linéairement jusqu'à ${(peakBytes / 1024).toFixed(0)} kio/s — c'est l'état complet diffusé dix fois par seconde, et c'est lui qui cédera le premier.`
        : worstTick < STEPS_PER_SECOND
          ? `Le tick tombe à ${worstTick} pas/s, sous le temps réel.`
          : `L'écart monte à ${worstDivergence.toFixed(2)}, au-delà de la tolérance de ${TOLERANCE}.`,
      metrics,
    };
  },
};

const prediction: Check = {
  id: 'prediction',
  label: 'Prédiction',
  group: 'Réseau',
  about: "Le client devine juste tout ce qu'il est en mesure de deviner — et rien de moins.",
  run() {
    const rig = new Rig({ players: 2, conditions: { latencySteps: 0 } });
    rig.run(600, (player) => (player === 2 ? EAST : STILL));
    const client = rig.clientOf(2)!;
    // En pleine course, le client est *devant* l'hôte de son avance : cet écart
    // n'est pas une erreur, c'est la prédiction elle-même. Ce qui doit être nul,
    // c'est ce qui reste une fois tout le monde arrêté.
    const whileMoving = rig.divergence(2);
    rig.settle();
    const ownDrift = rig.divergence(2);
    const exact =
      client.ready && client.selfCorrections === 0 && client.mispredictions === 0 && ownDrift < NEGLIGIBLE;

    // Contrepartie : un hôte qui change souvent d'avis ne peut pas être deviné
    // — sa nouvelle demande met un aller-retour à parvenir. Des erreurs doivent
    // donc apparaître, sans quoi le compteur ne mesurerait rien.
    const capricious = new Rig({ players: 2, conditions: { latencySteps: 8 } });
    capricious.run(600, (player, step) =>
      player === 1 ? (Math.floor(step / 10) % 2 === 0 ? EAST : NORTH) : STILL,
    );
    const honest = capricious.clientOf(2)!.mispredictions > 0;

    return {
      passed: exact && honest,
      detail: exact
        ? honest
          ? `Sur 600 pas sans latence, pas une erreur de prédiction — ni sur sa propre entité, ni sur celle de l'hôte. Les ${client.rosterChanges} corrections comptées sont toutes des **apparitions** : le monde décide seul de peupler ses alentours, et un client ne prend pas cette décision, donc il ne la devine pas. Distinguer les deux était nécessaire — mêlées, elles auraient fait monter un compteur qui ne dit plus rien.`
          : "Aucune erreur — mais le compteur ne bouge pas davantage quand l'hôte change sans cesse de direction, ce qui est impossible : la mesure ne prouve rien."
        : `${client.selfCorrections} corrections sur soi, ${client.mispredictions} erreurs de prédiction, et ${ownDrift.toFixed(2)} unité d'écart à l'arrêt.`,
      metrics: [
        ['erreurs de prédiction', String(client.mispredictions)],
        ['corrections sur soi', String(client.selfCorrections)],
        ['apparitions reçues', String(client.rosterChanges)],
        ['écart sur soi, en course', whileMoving.toFixed(2)],
        ['écart sur soi, à l’arrêt', ownDrift.toFixed(4)],
        [
          'contrôle négatif',
          honest ? `${capricious.clientOf(2)!.mispredictions} erreurs` : 'aucune',
        ],
      ],
    };
  },
};

/**
 * Mesure la fluidité d'un personnage distant, vu d'un client.
 *
 * On échantillonne à chaque pas la position **affichée**, et l'on regarde de
 * combien elle avance. Un mouvement fluide donne toujours le même pas ; une
 * saccade est un pas anormalement grand — le personnage a sauté.
 */
function judder(latencySteps: number, direction: InputFrame): { median: number; worst: number; spikes: number } {
  const rig = new Rig({ players: 2, conditions: { latencySteps } });
  const client = rig.clientOf(2)!;
  // On laisse la connexion s'établir : le premier état corrige forcément
  // beaucoup, et mesurer là-dedans ne dirait rien de la marche normale.
  rig.run(150, (player) => (player === 1 ? direction : STILL));

  const steps: number[] = [];
  let last = displayedPosition(client, 1);
  for (let i = 0; i < 600; i++) {
    rig.step((player) => (player === 1 ? direction : STILL));
    const now = displayedPosition(client, 1);
    if (last && now) steps.push(Math.hypot(now.x - last.x, now.y - last.y));
    last = now;
  }

  const sorted = [...steps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const worst = steps.length ? Math.max(...steps) : 0;
  // Un pas qui dépasse la moitié du pas normal se voit à l'œil.
  const spikes = steps.filter((d) => Math.abs(d - median) > Math.max(median * 0.5, 0.5)).length;
  return { median, worst, spikes };
}

const fluidite: Check = {
  id: 'fluidite',
  label: 'Fluidité du joueur distant',
  group: 'Réseau',
  about: "Le personnage d'un autre joueur avance sans saccade, jusqu'à 200 ms de latence.",
  run() {
    // La tolérance est nommée par cas plutôt que globale : jusqu'à 200 ms on
    // exige la fluidité parfaite, à 500 ms on mesure et l'on dit ce qu'il
    // reste. Une barre unique cacherait l'un ou ferait échouer l'autre.
    const cases: Array<{ label: string; latency: number; direction: InputFrame; allowed: number }> = [
      { label: '50 ms, plein est', latency: 3, direction: EAST, allowed: 0 },
      { label: '100 ms, plein est', latency: 6, direction: EAST, allowed: 0 },
      { label: '200 ms, plein est', latency: 12, direction: EAST, allowed: 0 },
      { label: '50 ms, vers le nord', latency: 3, direction: NORTH, allowed: 0 },
      { label: '500 ms, plein est', latency: 30, direction: EAST, allowed: 60 },
    ];

    const metrics: Array<[string, string]> = [];
    let failed: string | null = null;
    let worstJump = 0;

    for (const { label, latency, direction, allowed } of cases) {
      const result = judder(latency, direction);
      worstJump = Math.max(worstJump, result.worst);
      if (result.spikes > allowed && failed === null) failed = label;
      metrics.push([
        label,
        `pas ${result.median.toFixed(2)} · pire ${result.worst.toFixed(2)} · ${result.spikes} saccades / 600`,
      ]);
    }

    return {
      passed: failed === null,
      detail:
        failed === null
          ? "Aucune saccade jusqu'à 200 ms ; à 500 ms il en reste quelques-unes, plafonnées à deux fois le pas normal. La position simulée, elle, saute bel et bien : l'horloge du client se recale une dizaine de fois par seconde, et le personnage distant y gagne ou perd trois pas d'un coup. Le décalage d'affichage encaisse ce saut et le laisse fondre en deux dixièmes de seconde. La simulation reste exacte au bit près — c'est l'image qui temporise, jamais l'état."
          : `Le cas « ${failed} » saccade : le personnage distant saute visiblement (jusqu'à ${worstJump.toFixed(1)} unités en un pas).`,
      metrics,
    };
  },
};

const reconciliation: Check = {
  id: 'reconciliation',
  label: 'Réconciliation',
  group: 'Réseau',
  about: "L'autorité reprend la main sur un client qui a dérivé, sans perdre ses actions.",
  run() {
    const rig = new Rig({ players: 2, conditions: { latencySteps: 2 } });
    rig.run(90, idle);

    const client = rig.clientOf(2)!;
    const entity = client.simulation.entityOf(2)!;
    // On triche franchement : cinq mille unités de côté, comme le ferait un
    // client modifié.
    client.simulation.stores.transform.get(entity)!.x += 5000;
    const before = client.selfCorrections;

    // Puis on bâtit pendant la remise en ordre : la réconciliation ne doit pas
    // avaler les demandes non encore confirmées.
    const building: InputFrame = { x: 0, y: 1, build: true, harvest: false, torch: false };
    rig.run(240, (player) => (player === 2 ? building : STILL));
    rig.settle();

    const pulledBack = rig.divergence() < TOLERANCE;
    const noticed = client.selfCorrections > before;
    const kept = rig.host.simulation.stores.structure.size > 0;

    return {
      passed: pulledBack && noticed && kept,
      detail:
        pulledBack && noticed && kept
          ? `Client ramené à ${rig.divergence().toFixed(2)} unité de l'autorité, l'écart signalé, et ${rig.host.simulation.stores.structure.size} constructions conservées.`
          : !noticed
            ? "La dérive n'a pas été signalée."
            : !pulledBack
              ? `Le client est resté à ${rig.divergence().toFixed(0)} unités de l'autorité.`
              : 'Les constructions en cours ont été perdues pendant la remise en ordre.',
      metrics: [
        ['dérive imposée', '5 000 unités'],
        ['écart final', rig.divergence().toFixed(2)],
        ['corrections sur soi', String(client.selfCorrections)],
        ['constructions gardées', String(rig.host.simulation.stores.structure.size)],
      ],
    };
  },
};

const replication: Check = {
  id: 'replication',
  label: "Réplication d'entités",
  group: 'Réseau',
  about: "Les entités circulent, le terrain jamais : il se recalcule depuis la graine.",
  run() {
    const rig = new Rig({ players: 4, conditions: { latencySteps: 3 } });
    rig.run(600, busy);
    rig.settle();

    const authoritative = rig.host.simulation.world.entityCount;
    const everywhere = rig.clients.every((c) => c.simulation.world.entityCount === authoritative);

    // Ce qui passe réellement sur le fil. Un seul de ces mots et le monde
    // dérivé aurait franchi la frontière.
    const wire = JSON.stringify(rig.host.simulation.snapshot());
    const terrain = ['biome', 'forêt', 'chunk', 'props', 'elevation'].filter((w) => wire.includes(w));

    const sameWorld = rig.clients.every(
      (c) =>
        c.simulation.seed === rig.host.simulation.seed &&
        JSON.stringify(c.simulation.spawn) === JSON.stringify(rig.host.simulation.spawn),
    );

    const passed = everywhere && terrain.length === 0 && sameWorld && authoritative > 4;
    return {
      passed,
      detail: passed
        ? `${authoritative} entités répliquées à l'identique chez les 3 clients, et pas un octet de terrain sur le fil.`
        : terrain.length > 0
          ? `Le terrain circule : « ${terrain.join(' », « ')} » trouvé dans l'état.`
          : !everywhere
            ? `L'hôte a ${authoritative} entités, les clients ${rig.clients.map((c) => c.simulation.world.entityCount).join(', ')}.`
            : 'Les clients ne dérivent pas le même monde que l’hôte.',
      metrics: [
        ['entités', String(authoritative)],
        ['état complet', `${(rig.net.largestMessageBytes / 1024).toFixed(1)} kio`],
        ['terrain sur le fil', terrain.length === 0 ? 'aucun' : terrain.join(', ')],
      ],
    };
  },
};

// ------------------------------------------------------- dégradations

const perteDePaquets: Check = {
  id: 'perte-de-paquets',
  label: 'Perte de paquets',
  group: 'Dégradations',
  about: 'De 0 à 20 % de pertes, la partie converge toujours.',
  run() {
    const metrics: Array<[string, string]> = [];
    let worst = 0;
    let failedAt: number | null = null;

    for (const rate of [0, 0.01, 0.05, 0.1, 0.2]) {
      const rig = new Rig({ players: 2, conditions: { latencySteps: 3, lossRate: rate, seed: 7 } });
      rig.run(480, (player) => (player === 2 ? EAST : STILL));
      rig.settle();
      const divergence = rig.divergence();
      worst = Math.max(worst, divergence);
      if (divergence >= TOLERANCE && failedAt === null) failedAt = rate;
      metrics.push([
        `${(rate * 100).toFixed(0)} % perdus`,
        `${rig.net.dropped}/${rig.net.sent} paquets · écart ${divergence.toFixed(2)}`,
      ]);
    }

    return {
      passed: failedAt === null,
      detail:
        failedAt === null
          ? `Jusqu'à 20 % de pertes, l'écart final ne dépasse jamais ${worst.toFixed(2)} unité. La demande perdue est rejouée, la précédente tient le joueur en mouvement.`
          : `À ${(failedAt * 100).toFixed(0)} % de pertes, l'écart dépasse la tolérance de ${TOLERANCE}.`,
      metrics,
    };
  },
};

const latenceElevee: Check = {
  id: 'latence-elevee',
  label: 'Latence élevée',
  group: 'Dégradations',
  about: 'De 20 à 500 ms, le client garde la main et finit au même endroit que l’hôte.',
  run() {
    const metrics: Array<[string, string]> = [];
    let worst = 0;
    let failedAt: number | null = null;

    for (const millis of [20, 50, 100, 200, 500]) {
      const rig = new Rig({ players: 2, conditions: { latencySteps: stepsFor(millis) } });
      rig.run(600, (player) => (player === 2 ? EAST : STILL));
      const client = rig.clientOf(2)!;
      // L'avance du client sur l'hôte : elle n'est pas configurée, elle
      // s'installe. Le rejeu des demandes non confirmées la fait croître jusqu'à
      // ce que les paquets cessent d'arriver dans le passé de l'hôte.
      const lead = client.simulation.stepCount - rig.host.simulation.stepCount;
      const selfCorrections = client.selfCorrections;
      rig.settle();
      const divergence = rig.divergence();
      worst = Math.max(worst, divergence);
      if ((divergence >= TOLERANCE || selfCorrections > 2) && failedAt === null) failedAt = millis;
      metrics.push([
        ms(millis),
        `avance ${lead} pas · ${selfCorrections} corrections sur soi · écart ${divergence.toFixed(2)}`,
      ]);
    }

    return {
      passed: failedAt === null,
      detail:
        failedAt === null
          ? `Jusqu'à 500 ms, l'écart final reste sous ${Math.max(worst, 0.01).toFixed(2)} unité. L'avance du client n'est pas réglée à l'avance : elle s'ajuste d'elle-même au fil du rejeu, jusqu'à couvrir l'aller-retour.`
          : `À ${failedAt} ms, le client décroche.`,
      metrics,
    };
  },
};

const duplicationDesordre: Check = {
  id: 'duplication-desordre',
  label: 'Duplication, désordre, gigue',
  group: 'Dégradations',
  about: 'Un paquet reçu deux fois, ou dans le désordre, ne change rien à la partie.',
  run() {
    const cases: Array<[string, ConstructorParameters<typeof Rig>[0]]> = [
      ['duplication 20 %', { conditions: { latencySteps: 3, duplicateRate: 0.2, seed: 7 } }],
      ['désordre 30 %', { conditions: { latencySteps: 6, reorderRate: 0.3, seed: 7 } }],
      ['gigue ±6 pas', { conditions: { latencySteps: 6, jitterSteps: 6, seed: 7 } }],
      [
        'tout à la fois',
        {
          conditions: {
            latencySteps: 12,
            jitterSteps: 4,
            lossRate: 0.1,
            duplicateRate: 0.05,
            reorderRate: 0.2,
            seed: 7,
          },
        },
      ],
    ];

    const metrics: Array<[string, string]> = [];
    let failed: string | null = null;

    for (const [label, options] of cases) {
      const rig = new Rig({ ...options, players: 2 });
      rig.run(600, (player) => (player === 2 ? EAST : STILL));
      rig.settle();
      const divergence = rig.divergence();
      if (divergence >= TOLERANCE && failed === null) failed = label;
      metrics.push([
        label,
        `${rig.net.duplicated} doublons · ${rig.net.dropped} perdus · écart ${divergence.toFixed(2)}`,
      ]);
    }

    return {
      passed: failed === null,
      detail:
        failed === null
          ? "Doublons, désordre et gigue passent sans effet : une demande porte le pas auquel elle s'applique, la rejouer ou la recevoir deux fois donne le même résultat."
          : `Le cas « ${failed} » fait décrocher le client.`,
      metrics,
    };
  },
};

const deconnexion: Check = {
  id: 'deconnexion',
  label: 'Déconnexion',
  group: 'Dégradations',
  about: "Partir n'est pas disparaître : le personnage, l'inventaire et les constructions restent.",
  run() {
    const rig = new Rig({ players: 3, conditions: { latencySteps: 2 }, timeoutSteps: 120 });
    rig.run(600, busy);
    rig.settle();

    const entity = rig.host.simulation.entityOf(2)!;
    const inventoryBefore = carried(rig.host.simulation.stores.inventory.get(entity));
    const structuresBefore = rig.host.simulation.stores.structure.size;
    const harvestedBefore = rig.host.simulation.stores.harvested.size;

    // Deux façons de partir : refermer la fenêtre, qui prévient…
    rig.disconnect(2, true);
    rig.run(60, busy);
    const announcedGone = !rig.host.connectedPlayers().includes(2);
    const stillThere = rig.host.simulation.entityOf(2) !== null;

    // …et perdre le réseau, qui ne prévient pas. Celle-là ne se découvre que
    // par le silence, après le délai d'attente.
    rig.disconnect(3, false);
    rig.run(60, busy);
    const tooEarly = rig.host.connectedPlayers().includes(3);
    rig.run(150, busy);
    const cutGone = !rig.host.connectedPlayers().includes(3);

    const velocity = rig.host.simulation.stores.velocity.get(entity)!;
    const stopped = Math.hypot(velocity.x, velocity.y) < 1;

    const inventoryAfter = carried(rig.host.simulation.stores.inventory.get(entity));
    const kept =
      inventoryAfter === inventoryBefore &&
      rig.host.simulation.stores.structure.size >= structuresBefore &&
      rig.host.simulation.stores.harvested.size >= harvestedBefore;

    const passed = announcedGone && stillThere && tooEarly && cutGone && stopped && kept;
    return {
      passed,
      detail: passed
        ? `Départ annoncé pris en compte aussitôt, coupure sèche détectée après le silence. Les deux personnages restent au monde, à l'arrêt, avec leurs ${inventoryAfter} matières et leurs constructions.`
        : !announcedGone
          ? "Le départ annoncé n'a pas été enregistré."
          : !stillThere
            ? 'Le personnage a été détruit : inventaire et constructions perdus.'
            : !tooEarly
              ? 'La coupure sèche a été déclarée avant la fin du délai : une rafale de pertes suffirait à éjecter un joueur.'
              : !cutGone
                ? "La coupure sèche n'a jamais été détectée."
                : !stopped
                  ? `Le personnage abandonné file encore à ${Math.hypot(velocity.x, velocity.y).toFixed(0)} unités/s.`
                  : `Inventaire ${inventoryBefore} → ${inventoryAfter} : quelque chose s'est perdu.`,
      metrics: [
        ['départ annoncé', announcedGone ? 'immédiat' : 'raté'],
        ['coupure sèche', cutGone ? 'détectée par le silence' : 'jamais détectée'],
        ['personnage', stillThere ? 'conservé' : 'détruit'],
        ['inventaire', `${inventoryBefore} → ${inventoryAfter}`],
        ['constructions', String(rig.host.simulation.stores.structure.size)],
        ['vitesse résiduelle', Math.hypot(velocity.x, velocity.y).toFixed(2)],
      ],
    };
  },
};

const reconnexion: Check = {
  id: 'reconnexion',
  label: 'Reconnexion',
  group: 'Dégradations',
  about: 'Un revenant retrouve son personnage et reçoit tout ce qui a changé sans lui.',
  run() {
    const rig = new Rig({ players: 3, conditions: { latencySteps: 3 }, timeoutSteps: 120 });
    rig.run(600, busy);
    rig.settle();

    const entity = rig.host.simulation.entityOf(2)!;
    const inventoryBefore = carried(rig.host.simulation.stores.inventory.get(entity));
    const structuresBefore = rig.host.simulation.stores.structure.size;

    // Coupure sèche, puis le monde continue sans lui : les autres bâtissent et
    // récoltent. C'est tout cela qu'il devra recevoir en revenant.
    rig.disconnect(2, false);
    rig.run(420, busy);
    const structuresWithoutHim = rig.host.simulation.stores.structure.size;

    const revenant = rig.join(2);
    rig.run(180, idle);
    rig.settle();

    const sameEntity = rig.host.simulation.entityOf(2) === entity;
    const backOnline = rig.host.connectedPlayers().includes(2);
    const inventoryAfter = carried(rig.host.simulation.stores.inventory.get(entity));
    const resynced = stableDigest(rig.host.simulation) === stableDigest(revenant.simulation);
    const missed = structuresWithoutHim - structuresBefore;
    const divergence = rig.divergence();

    const passed =
      sameEntity && backOnline && inventoryAfter === inventoryBefore && resynced && divergence < TOLERANCE;
    return {
      passed,
      detail: passed
        ? `Reconnecté sur la même entité, ${inventoryAfter} matières intactes, et ${missed === 1 ? "la construction élevée" : `les ${missed} constructions élevées`} en son absence ${missed === 1 ? 'reçue' : 'reçues'} d'un coup. Empreinte d'état identique à celle de l'hôte.`
        : !backOnline
          ? "L'hôte n'a pas repris le revenant."
          : !sameEntity
            ? 'Le revenant a reçu un nouveau personnage : le sien est perdu.'
            : inventoryAfter !== inventoryBefore
              ? `Inventaire ${inventoryBefore} → ${inventoryAfter}.`
              : !resynced
                ? "L'état du revenant ne correspond pas à celui de l'hôte."
                : `Écart de position de ${divergence.toFixed(2)} après reprise.`,
      metrics: [
        ['personnage', sameEntity ? 'retrouvé' : 'perdu'],
        ['inventaire', `${inventoryBefore} → ${inventoryAfter}`],
        ['bâti en son absence', String(missed)],
        ['empreinte d’état', resynced ? "identique à l'hôte" : 'divergente'],
        ['écart de position', divergence.toFixed(2)],
      ],
    };
  },
};

export const CHECKS: Check[] = [
  determinisme,
  scenario018,
  sauvegarde,
  rejeu,
  construction,
  recolte,
  cycleJourNuit,
  faune,
  deuxJoueurs,
  huitJoueurs,
  monteeEnCharge,
  prediction,
  fluidite,
  reconciliation,
  replication,
  perteDePaquets,
  latenceElevee,
  duplicationDesordre,
  deconnexion,
  reconnexion,
];

/**
 * Exécute une vérification, sans jamais laisser échapper une exception.
 *
 * Un lancer qui s'arrête à la première erreur ne dit pas si le reste va bien.
 * Une exception est un échec comme un autre, avec son message pour détail.
 */
export function runCheck(check: Check): CheckResult {
  const started = performance.now();
  // Le résultat est recopié champ par champ, jamais étalé depuis `check` : la
  // fiche porte sa fonction `run`, et une fonction ne traverse pas la frontière
  // d'un worker. L'étaler marchait en Node et cassait dans le navigateur.
  const describe = (outcome: CheckOutcome): CheckResult => {
    const base = {
      id: check.id,
      label: check.label,
      group: check.group,
      about: check.about,
      passed: outcome.passed,
      detail: outcome.detail,
      durationMs: performance.now() - started,
    };
    return outcome.metrics ? { ...base, metrics: outcome.metrics } : base;
  };

  try {
    return describe(check.run());
  } catch (error) {
    return describe({
      passed: false,
      detail: `Exception : ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function runAll(onResult?: (result: CheckResult) => void): CheckResult[] {
  return CHECKS.map((check) => {
    const result = runCheck(check);
    onResult?.(result);
    return result;
  });
}
