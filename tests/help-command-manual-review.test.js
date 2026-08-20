const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const review = require('../tools/data-maintenance/help-command-manual-review');
const {
  paramsFromSyntax,
  validateAndBuild,
} = require('../tools/data-maintenance/apply-manual-help-command-review');

function main() {
  const root = path.resolve(__dirname, '..');
  const coverage = JSON.parse(fs.readFileSync(
    path.join(root, 'data', 'audit-report', 'help-command-coverage-final.json'),
    'utf8'
  ));
  const expected = {
    GOM: { accept: 135, reject: 11 },
    GEE: { accept: 104, reject: 4 },
    '996PC': { accept: 169, reject: 10 },
  };

  for (const engine of Object.keys(expected)) {
    const decisions = validateAndBuild(
      engine,
      coverage.engines[engine],
      review.engines[engine]
    );
    const accepted = decisions.filter(entry => entry.decision === 'accept');
    const rejected = decisions.filter(entry => entry.decision === 'reject');
    assert.equal(accepted.length, expected[engine].accept, `${engine} accepted count`);
    assert.equal(rejected.length, expected[engine].reject, `${engine} rejected count`);
    for (const entry of accepted) {
      assert.ok(entry.evidence.length > 0, `${engine} ${entry.token} must retain evidence`);
      assert.ok(
        entry.catalogEntry.source.page,
        `${engine} ${entry.token} must retain its own help page`
      );
      assert.ok(
        entry.catalogEntry.syntax.toUpperCase().startsWith(entry.token),
        `${engine} ${entry.token} syntax must start with the exact command`
      );
    }
  }

  assert.equal(review.engines['996PC'].syntax['H.CHANGELEVEL'], undefined);
  assert.match(review.engines['996PC'].notes['H.CHANGELEVEL'], /冲突/);
  assert.equal(
    paramsFromSyntax('SENDCUSTOMMSG', review.engines['996PC'].syntax.SENDCUSTOMMSG).length,
    8
  );
  assert.equal(
    paramsFromSyntax('SORTVARSTR', review.engines['996PC'].syntax.SORTVARSTR).length,
    4
  );
  assert.equal(
    paramsFromSyntax('STARTPICKUP', review.engines['996PC'].syntax.STARTPICKUP).length,
    3
  );
  assert.equal(
    paramsFromSyntax('H.RANGEHARM', review.engines.GOM.syntax['H.RANGEHARM']).length,
    10
  );
  assert.equal(
    paramsFromSyntax('H.RANGEHARM', review.engines.GEE.syntax['H.RANGEHARM']).length,
    14
  );
  assert.equal(
    paramsFromSyntax('H.RANGEHARMEX', review.engines.GEE.syntax['H.RANGEHARMEX']).length,
    16
  );
  assert.ok(review.engines['996PC'].reject.SENDMSG6);
  assert.ok(review.engines['996PC'].reject.SHOWFASHION0);
  console.log('Manual help command review tests passed.');
}

main();
