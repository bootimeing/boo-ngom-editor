const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { applyPreviewCollectionCommand: apply, protectPreviewCollectionValue: protectCollection,
  resolvePreviewCollectionDisplayExpression: displayExpression } = require(path.join(runtime, 'out/ui-dialog/preview-collections'));
const { protectPreviewText: protect } = require(path.join(runtime, 'out/ui-dialog/preview-inputs'));

function state(engine = 'GOM') {
  const raw = new Map(), shadow = new Map();
  return { raw, shadow,
    seed(name, value, preview = value) {
      raw.set(name, typeof value === 'string' ? value : JSON.stringify(value));
      shadow.set(name, typeof preview === 'string' ? preview : JSON.stringify(preview));
    },
    run(command, rest) {
      assert.equal(apply(command, rest, name => raw.get(name), (name, value, _deps, preview) => {
        raw.set(name, value); shadow.set(name, preview);
      }, engine, name => shadow.get(name)), true, `${engine} ${command} ${rest}`);
    },
    display(expression) { return displayExpression(expression, name => raw.get(name), name => shadow.get(name), engine); },
  };
}
const source = '<TEXT:源码控件:30:30>', user = '<TEXT:用户文字:1:1>', next = '<TEXT:后加源码:30:60>';
const mixed = engine => {
  const fixture = state(engine);
  fixture.seed('L$mix', [source, user], [source, protect(user)]);
  fixture.seed('S$user', user, protect(user));
  return fixture;
};
function output(fixture, name, raw, preview) {
  assert.deepEqual(fixture.raw.get(name), typeof raw === 'string' ? raw : JSON.stringify(raw), `${name} raw`);
  assert.deepEqual(fixture.shadow.get(name), typeof preview === 'string' ? preview : JSON.stringify(preview), `${name} display`);
}

function run() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    for (const [command, rest, raw, shadow] of [
      ['ADDTOLIST', `L$mix ${next}`, [source, user, next], [source, protect(user), next]],
      ['ADDTOLIST', 'L$mix <$STR(S$user)>', [source, user, user], [source, protect(user), protect(user)]],
      ['INSERTTOLIST', `L$mix ${next} 1`, [source, next, user], [source, next, protect(user)]],
      ['REPLACELISTBYINDEX', `L$mix ${next} 1`, [source, next], [source, next]],
      ['REMOVELISTBYINDEX', 'L$mix 0', [user], [protect(user)]],
      ['REMOVELISTBYCONTENT', `L$mix ${source} 1`, [user], [protect(user)]],
      ['MOV', `L$mix[1] ${next}`, [source, next], [source, next]],
      ['INC', `L$mix[0] <$STR(S$user)>`, [source + user, user], [source + protect(user), protect(user)]],
      ['DEC', `L$mix ${source}`, [user], [protect(user)]],
      ['INC', `L$mix ${next}`, [source, user, next], [source, protect(user), next]],
    ]) {
      const fixture = mixed(engine);
      fixture.run(command, rest);
      output(fixture, 'L$mix', raw, shadow);
    }
    for (const [command, rest, expectedRaw, expectedShadow] of [
      ['REVERSELIST', 'L$mix L$out', [user, source], [protect(user), source]],
      ['EXTRACTLIST', 'L$mix L$out 0 1', [source, user], [source, protect(user)]],
      ['MOV', 'L$out L$mix', [source, user], [source, protect(user)]],
      ['MOV', `L$out [${source},<$STR(S$user)>]`, [source, user], [source, protect(user)]],
    ]) {
      const fixture = mixed(engine);
      fixture.run(command, rest);
      output(fixture, 'L$out', expectedRaw, expectedShadow);
      assert.equal(fixture.display('<$STR(L$out[0])>'), expectedShadow[0]);
    }
    const dec = mixed(engine);
    dec.run('INC', 'L$mix[1] |SOURCE');
    dec.run('DEC', 'L$mix[1] <$STR(S$user)>');
    output(dec, 'L$mix', [source, '|SOURCE'], [source, '|SOURCE']);
    const sorted = state(engine);
    sorted.seed('L$mix', ['<TEXT:Z:1:1>', '<TEXT:A:1:1>'], ['<TEXT:Z:1:1>', protect('<TEXT:A:1:1>')]);
    sorted.run('SORTLIST', 'L$mix L$out 0 1');
    output(sorted, 'L$out', ['<TEXT:A:1:1>', '<TEXT:Z:1:1>'], [protect('<TEXT:A:1:1>'), '<TEXT:Z:1:1>']);
    // Identical raw values with different origins retain per-index identity.
    const duplicate = state(engine);
    duplicate.seed('L$mix', [user, user], [protect(user), user]);
    duplicate.run('REVERSELIST', 'L$mix L$out');
    output(duplicate, 'L$out', [user, user], [user, protect(user)]);
  }
  for (const engine of ['GOM', 'GEE']) {
    const fixture = state(engine);
    fixture.seed('D$mix', { 来源: source, 用户: user }, { 来源: source, 用户: protect(user) });
    fixture.run('MOV', `D$mix[新键] ${next}`);
    assert.equal(fixture.display('<$STR(D$mix[来源])>'), source);
    assert.equal(fixture.display('<$STR(D$mix[用户])>'), protect(user));
    assert.equal(fixture.display('<$STR(D$mix[新键])>'), next);
    fixture.run('GETDICTITEMS', 'D$mix 1 L$out');
    output(fixture, 'L$out', [source, user, next], [source, protect(user), next]);
    fixture.run('DEC', 'D$mix 用户');
    fixture.run('INC', 'D$mix 用户2:<TEXT:新源:1:1>');
    // Dictionary INC has the engine's single-colon pair contract; an ambiguous
    // source value invalidates both channels rather than preserving stale text.
    assert.equal(fixture.raw.get('D$mix'), undefined);
    assert.equal(fixture.shadow.get('D$mix'), undefined);
    const keys = state(engine);
    keys.seed('D$mix', { '<TEXT:用户键:1:1>': '1', 静态键: '2' }, { [protect('<TEXT:用户键:1:1>')]: '1', 静态键: '2' });
    keys.run('GETDICTITEMS', 'D$mix 0 L$out');
    output(keys, 'L$out', ['<TEXT:用户键:1:1>', '静态键'], [protect('<TEXT:用户键:1:1>'), '静态键']);
    keys.run('GETDICTMINVALUE', 'D$mix S$key N$value');
    output(keys, 'S$key', '<TEXT:用户键:1:1>', protect('<TEXT:用户键:1:1>'));
    assert.equal(keys.display('<$STR(D$mix[<TEXT:用户键:1:1>])>'), '1');
  }
  const joined = mixed();
  joined.run('JOINLIST', 'L$mix S$out ,');
  output(joined, 'S$out', `${source},${user}`, `${source},${protect(user)}`);
  joined.run('SPLITTOLIST', 'S$out , L$out');
  output(joined, 'L$out', [source, user], [source, protect(user)]);
  joined.run('CLONELIST', 'L$mix L$clone');
  output(joined, 'L$clone', [source, user], [source, protect(user)]);
  joined.run('CONCATLIST', 'L$mix L$clone L$out');
  output(joined, 'L$out', [source, user, source, user], [source, protect(user), source, protect(user)]);
  joined.run('UNIQUELIST', 'L$out L$unique');
  output(joined, 'L$unique', [source, user], [source, protect(user)]);
  joined.run('SHUFFLELIST', 'L$mix L$unknown');
  assert.equal(joined.raw.get('L$unknown'), undefined);
  assert.equal(joined.shadow.get('L$unknown'), undefined);
  const replaced = mixed();
  replaced.run('REPLACELISTBYCONTENT', `L$mix ${user} ${next} 1`);
  output(replaced, 'L$mix', [source, next], [source, next]);
  assert.equal(protectCollection('list', JSON.stringify([user])), JSON.stringify([protect(user)]));
  assert.equal(protectCollection('dictionary', JSON.stringify({ [user]: user })), JSON.stringify({ [protect(user)]: protect(user) }));
  console.log('preview-collection-shadows.test.js: PASS');
}
if (require.main === module) run();
module.exports = { run };
