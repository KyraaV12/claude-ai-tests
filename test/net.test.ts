import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation.ts';
import type { InputFrame } from '../src/core/simulation.ts';
import { compare } from '../src/core/replay.ts';
import { MemoryNetwork } from '../src/net/memory-transport.ts';
import { Host } from '../src/net/host.ts';
import { Client } from '../src/net/client.ts';

const SEED = 20260826;
const STILL: InputFrame = { x: 0, y: 0, build: false, harvest: false };
const EAST: InputFrame = { x: 1, y: 0, build: false, harvest: false };
const NORTH: InputFrame = { x: 0, y: -1, build: false, harvest: false };

interface Rig {
  net: MemoryNetwork;
  host: Host;
  client: Client;
}

function rig(latencySteps = 0, stateEvery = 6): Rig {
  const net = new MemoryNetwork(latencySteps);
  const host = new Host(SEED, net.connect(), 1, { stateEvery });
  const client = new Client(SEED, net.connect(), 2);
  return { net, host, client };
}

/** Fait tourner l'ensemble : livraison, prédiction du client, pas d'autorité. */
function run(r: Rig, steps: number, hostInput = STILL, clientInput = STILL): void {
  for (let i = 0; i < steps; i++) {
    r.net.advance();
    r.host.setLocalInput(hostInput);
    r.client.setLocalInput(clientInput);
    r.client.advance();
    r.host.advance();
  }
}

/** Laisse tout se poser : plus rien en vol, plus rien à confirmer. */
function settle(r: Rig, steps = 40): void {
  run(r, steps, STILL, STILL);
  r.net.flush();
}

test('le client ne prédit rien avant d avoir reçu un état d autorité', () => {
  const r = rig();
  assert.equal(r.client.ready, false);
  r.client.advance();
  assert.equal(r.client.simulation.stepCount, 0);
});

test('un client qui rejoint reçoit l état et voit les deux joueurs', () => {
  const r = rig();
  run(r, 20);

  assert.equal(r.client.ready, true);
  assert.deepEqual(r.host.simulation.players(), [1, 2]);
  assert.deepEqual(r.client.simulation.players(), [1, 2]);
});

test('sans latence, la prédiction du client ne se trompe jamais', () => {
  // C'est le test qui justifie toute l'architecture : le client applique la
  // même demande au même pas que l'hôte, sur le même code. La réconciliation
  // ne doit donc rien avoir à corriger.
  const r = rig(0);
  run(r, 200, STILL, EAST);

  assert.ok(r.client.lastCorrection, 'aucun état d autorité reçu');
  assert.equal(r.client.corrections, 0, `écart en ${r.client.lastCorrection?.firstDifference}`);
  assert.equal(r.client.selfCorrections, 0);
});

test('quelle que soit la latence, le client ne se voit jamais corrigé', () => {
  // La prédiction ne porte que sur ses propres demandes ; c'est là qu'elle
  // doit être exacte, et elle l'est même quand l'hôte bouge de son côté.
  for (const latency of [0, 2, 4, 8]) {
    const r = rig(latency);
    run(r, 200, NORTH, EAST);
    assert.equal(r.client.selfCorrections, 0, `latence ${latency}`);
  }
});

test('un client ne peut pas prédire les demandes d un autre joueur', () => {
  // Contrepartie honnête : voir l'autre bouger autrement que prévu est normal,
  // et c'est précisément ce que la réconciliation rattrape.
  const moving = rig(2);
  run(moving, 200, NORTH, EAST);
  assert.ok(moving.client.corrections > 0, 'l autre joueur aurait dû être corrigé');

  const idle = rig(2);
  run(idle, 200, STILL, EAST);
  assert.equal(idle.client.corrections, 0, 'hôte immobile : rien ne devait être corrigé');
});

test('le client garde son avance sur l hôte', () => {
  // Sans avance, ses demandes arriveraient datées d'un pas déjà joué et
  // seraient rejetées : la prédiction serait fausse à chaque pas.
  const r = rig(0);
  run(r, 100, STILL, EAST);

  const lead = r.client.simulation.stepCount - r.host.simulation.stepCount;
  assert.ok(lead > 0, `le client devrait être en avance, il est à ${lead}`);
});

test('le client bouge réellement chez l hôte', () => {
  const r = rig(0);
  const before = () => {
    const entity = r.host.simulation.entityOf(2)!;
    return r.host.simulation.stores.transform.get(entity)!.x;
  };
  run(r, 10, STILL, STILL);
  const start = before();
  run(r, 60, STILL, EAST);

  assert.ok(before() > start + 50, `le joueur distant n a pas avancé : ${start} -> ${before()}`);
});

test('avec de la latence, l état converge quand même', () => {
  const r = rig(4);
  run(r, 120, NORTH, EAST);
  settle(r, 60);

  // Le client a été ramené sur l'état de l'hôte au dernier pas confirmé.
  const hostAt = r.host.simulation.stepCount;
  const clientAt = r.client.simulation.stepCount;
  assert.ok(clientAt >= hostAt - 60, `client trop en retard : ${clientAt} contre ${hostAt}`);

  const hostPlayer = r.host.simulation.entityOf(2)!;
  const clientPlayer = r.client.simulation.entityOf(2)!;
  const a = r.host.simulation.stores.transform.get(hostPlayer)!;
  const b = r.client.simulation.stores.transform.get(clientPlayer)!;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 40, `écart de position ${Math.hypot(a.x - b.x, a.y - b.y)}`);
});

test('l autorité reprend la main sur un client corrompu', () => {
  const r = rig(0);
  run(r, 20, STILL, STILL);

  const entity = r.client.simulation.entityOf(2)!;
  r.client.simulation.stores.transform.get(entity)!.x += 5000;

  run(r, 20, STILL, STILL);

  const hostEntity = r.host.simulation.entityOf(2)!;
  const authoritative = r.host.simulation.stores.transform.get(hostEntity)!;
  const local = r.client.simulation.stores.transform.get(r.client.simulation.entityOf(2)!)!;
  assert.ok(Math.abs(local.x - authoritative.x) < 40, `le client n a pas été ramené : ${local.x}`);
  assert.ok(r.client.selfCorrections > 0, 'la correction aurait dû être signalée');
});

test('un paquet perdu ne fige pas le joueur', () => {
  const r = rig(0);
  run(r, 20, STILL, EAST);
  const entity = r.host.simulation.entityOf(2)!;
  const before = r.host.simulation.stores.transform.get(entity)!.x;

  r.net.dropNext = 3; // trois paquets évaporés
  run(r, 20, STILL, EAST);

  // La dernière demande connue est reprise : le joueur continue d'avancer.
  assert.ok(r.host.simulation.stores.transform.get(entity)!.x > before + 20);
});

test('une demande périmée est ignorée', () => {
  const r = rig(0);
  run(r, 30, STILL, STILL);

  const entity = r.host.simulation.entityOf(2)!;
  const before = { ...r.host.simulation.stores.velocity.get(entity)! };

  // Une demande datée d'un pas déjà joué ne doit pas rouvrir le passé.
  r.host.transport.send({ kind: 'input', player: 2, step: 1, input: EAST });
  r.net.advance();
  r.host.advance();

  const after = r.host.simulation.stores.velocity.get(entity)!;
  assert.ok(Math.abs(after.x - before.x) < 1e-9, 'une demande périmée a été appliquée');
});

test('l ordre des demandes dans un pas ne change pas le résultat', () => {
  // Deux hôtes recevant les mêmes paquets dans un ordre différent doivent
  // aboutir au même état : sans le tri par joueur, le réseau déciderait.
  const ascending = new Simulation(SEED, [1, 2]);
  const descending = new Simulation(SEED, [1, 2]);

  for (let i = 0; i < 60; i++) {
    ascending.step([
      { player: 1, ...EAST },
      { player: 2, ...NORTH },
    ]);
    descending.step([
      { player: 2, ...NORTH },
      { player: 1, ...EAST },
    ]);
  }

  assert.equal(JSON.stringify(ascending.snapshot()), JSON.stringify(descending.snapshot()));
});

test('un joueur qui part disparaît des deux côtés', () => {
  const r = rig(0);
  run(r, 20);
  assert.deepEqual(r.host.simulation.players(), [1, 2]);

  r.client.leave();
  r.net.advance();
  r.host.advance();

  assert.deepEqual(r.host.simulation.players(), [1]);
});

test('le réseau ne transporte jamais le terrain', () => {
  // La frontière de T3 paie ici : chaque pair recalcule le monde depuis la
  // graine, et l'état échangé ne contient que des entités.
  const r = rig(0);
  run(r, 12);

  const state = JSON.stringify(r.host.simulation.snapshot());
  for (const word of ['biome', 'forêt', 'chunk', 'props', 'elevation']) {
    assert.ok(!state.includes(word), `« ${word} » ne devrait pas circuler`);
  }
});

test('les deux pairs simulent le même monde sans se l être envoyé', () => {
  const r = rig(0);
  run(r, 30);

  // Les mondes dérivés doivent coïncider bien qu'aucun terrain n'ait transité.
  assert.equal(r.host.simulation.seed, r.client.simulation.seed);
  assert.deepEqual(r.host.simulation.spawn, r.client.simulation.spawn);
});

test('la réconciliation ne perd pas les actions non confirmées', () => {
  const r = rig(2);
  const building: InputFrame = { x: 0, y: 1, build: true, harvest: false };
  run(r, 90, STILL, building);
  settle(r, 60);

  assert.ok(r.host.simulation.stores.structure.size > 0, 'aucune construction n a atteint l hôte');
  const result = compare(r.host.simulation.snapshot(), r.host.simulation.snapshot());
  assert.equal(result.identical, true);
});
