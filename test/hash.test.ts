import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../src/bench/hash.ts';

test('les vecteurs de référence de la norme sont respectés', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('l implémentation coïncide avec celle de Node sur des entrées variées', () => {
  // Elle est écrite à la main pour être identique en Node et dans le
  // navigateur ; encore faut-il qu'elle soit juste.
  const cases = ['a', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'éàü漢字🙂', JSON.stringify({ a: [1, 2, 3], b: null })];
  for (const value of cases) {
    assert.equal(sha256(value), createHash('sha256').update(value, 'utf8').digest('hex'), `écart sur ${value.slice(0, 20)}`);
  }
});

test('deux entrées voisines donnent des empreintes sans rapport', () => {
  const a = sha256('état 183 entités');
  const b = sha256('état 184 entités');
  assert.notEqual(a, b);
  // Une empreinte de régression doit signaler le moindre écart, pas l'atténuer.
  const common = [...a].filter((c, i) => c === b[i]).length;
  assert.ok(common < 20, `trop de caractères communs : ${common}/64`);
});
