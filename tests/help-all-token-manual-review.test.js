const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const review = require('../tools/data-maintenance/help-all-token-manual-review');

function acceptedTokens(engineReview) {
  const accepted = engineReview.accept;
  return [
    ...accepted.commands.check,
    ...accepted.commands.action,
    ...accepted.triggers,
    ...accepted.constants,
    ...accepted.staticLanguage,
  ];
}

function main() {
  const root = path.resolve(__dirname, '..');
  const report = JSON.parse(fs.readFileSync(
    path.join(root, 'data', 'audit-report', 'all-help-english-tokens-final.json'),
    'utf8'
  ));
  const ledger = JSON.parse(fs.readFileSync(
    path.join(root, 'data', 'audit-report', 'help-all-token-manual-review-final.json'),
    'utf8'
  ));

  const expected = {
    GOM: { candidates: 158, acceptedSymbols: 37, rejected: 121 },
    GEE: { candidates: 221, acceptedSymbols: 85, rejected: 136 },
    '996PC': { candidates: 197, acceptedSymbols: 97, rejected: 100 },
  };

  for (const [engine, counts] of Object.entries(expected)) {
    const engineReport = report.engines[engine];
    const engineReview = review.engines[engine];
    const ledgerTokens = new Set(ledger.engines[engine].map(entry => entry.token));
    const accepted = acceptedTokens(engineReview);
    const reviewed = new Set([...accepted, ...engineReview.reject]);

    assert.equal(engineReport.commandReview.length, 0, `${engine} command review must be empty`);
    assert.equal(engineReport.updateContextReview.length, 0, `${engine} update review must be empty`);
    assert.equal(ledgerTokens.size, counts.candidates, `${engine} original candidate count`);
    assert.equal(new Set(accepted).size, counts.acceptedSymbols, `${engine} accepted symbol count`);
    assert.equal(engineReview.reject.length, counts.rejected, `${engine} rejected count`);
    assert.deepEqual(
      [...reviewed].sort(),
      [...ledgerTokens].sort(),
      `${engine} review must cover every candidate and no unrelated token`
    );
    assert.equal(
      engineReview.reject.length,
      new Set(engineReview.reject).size,
      `${engine} reject list contains duplicates`
    );
    for (const token of engineReview.reject) {
      assert.equal(
        new Set(accepted).has(token),
        false,
        `${engine} ${token} cannot be accepted and rejected`
      );
    }
  }

  assert.ok(review.engines.GEE.accept.triggers.includes('HEROGETEXP'));
  assert.ok(review.engines.GEE.accept.constants.includes('HEROGETEXP'));
  console.log('All-help manual token review tests passed.');
}

main();
