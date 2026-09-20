const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHILD_TIMEOUT_MS = 180000;
const CHILD_KILL_GRACE_MS = 5000;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
const STRICT_TIMEOUT_ENV = 'BOO_NPC_DIALOG_STRICT_TIMEOUT_MS';

function resolveChildTimeoutMs(environment = process.env) {
  const rawValue = environment[STRICT_TIMEOUT_ENV];
  if (rawValue === undefined) return CHILD_TIMEOUT_MS;

  if (!/^[1-9]\d*$/u.test(rawValue)) {
    throw new Error(
      `${STRICT_TIMEOUT_ENV} must be a positive integer from 1 to ${MAX_TIMER_DELAY_MS} milliseconds; received ${JSON.stringify(rawValue)}`,
    );
  }

  const timeoutMs = Number(rawValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${STRICT_TIMEOUT_ENV} must be a positive integer from 1 to ${MAX_TIMER_DELAY_MS} milliseconds; received ${JSON.stringify(rawValue)}`,
    );
  }
  return timeoutMs;
}

function browserCandidate(root, ...parts) {
  return root ? path.join(root, ...parts) : undefined;
}

function findRequiredBrowser() {
  const candidates = [
    process.env.BOO_BROWSER_EXECUTABLE,
    process.env.BOO_CHROMIUM_PATH,
    browserCandidate(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    browserCandidate(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    browserCandidate(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    browserCandidate(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    browserCandidate(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    browserCandidate(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  return candidates.length > 0 ? path.resolve(candidates[0]) : undefined;
}

const tests = [
  'preview-inactive-write-inputs.test.js',
  'preview-indirect-write-inputs.test.js',
  'preview-indirect-write-browser.test.js',
  'preview-inactive-write-browser.test.js',
  'preview-script-constants.test.js',
  'preview-script-constants-provider.test.js',
  'preview-script-constants-browser.test.js',
  'preview-constant-display.test.js',
  'preview-constant-display-provider.test.js',
  'preview-constant-display-browser.test.js',
  'preview-execution-composition.test.js',
  'preview-execution-budget.test.js',
  'preview-execution-composition-browser.test.js',
  'preview-script-events.test.js',
  'preview-script-events-provider.test.js',
  'preview-script-events-browser.test.js',
  'preview-script-gestures.test.js',
  'preview-script-gestures-provider.test.js',
  'preview-script-gestures-browser.test.js',
  'preview-client-legacy.test.js',
  'preview-client-legacy-provider.test.js',
  'preview-client-legacy-browser.test.js',
  'preview-script-source.test.js',
  'preview-script-program.test.js',
  'preview-script-model.test.js',
  'preview-script-edits.test.js',
  'preview-script-provider.test.js',
  'preview-script-browser.test.js',
  'preview-client-atlas.test.js',
  'preview-client-atlas-provider.test.js',
  'preview-client-atlas-browser.test.js',
  'preview-return-values.test.js',
  'preview-return-values-provider.test.js',
  'preview-return-values-browser.test.js',
  'preview-menu-submit.test.js',
  'preview-client-text.test.js',
  'preview-popup-input.test.js',
  'preview-popup-input-provider.test.js',
  'preview-popup-input-browser.test.js',
  'preview-client-text-browser.test.js',
  'preview-menu-submit-provider.test.js',
  'preview-local-container-id.test.js',
  'preview-control-values.test.js',
  'preview-completion-call.test.js',
  'preview-completion-call-provider.test.js',
  'preview-completion-call-browser.test.js',
  'preview-control-submit.test.js',
  'preview-control-submit-provider.test.js',
  'preview-control-submit-browser.test.js',
  'preview-gee-submit.test.js',
  'preview-gee-submit-provider.test.js',
  'preview-gee-submit-browser.test.js',
  'preview-say-container.test.js',
  'preview-say-container-browser.test.js',
  'preview-say-template.test.js',
  'preview-say-template-browser.test.js',
  'preview-say-call.test.js',
  'preview-say-call-provider.test.js',
  'preview-say-call-browser.test.js',
  'preview-say-trace.test.js',
  'preview-say-trace-browser.test.js',
  'preview-double-click.test.js',
  'preview-progress-range.test.js',
  'preview-progress-range-browser.test.js',
  'preview-playimg-submit-browser.test.js',
  'preview-double-click-provider.test.js',
  'preview-double-click-browser.test.js',
  'preview-imgex-compat.test.js',
  'preview-imgex-compat-browser.test.js',
  'preview-engine-submit-browser.test.js',
  'preview-engine-click.test.js',
  'preview-input-submit.test.js',
  'preview-input-submit-provider.test.js',
  'preview-input-submit-browser.test.js',
  'preview-call-path.test.js',
  'preview-call-path-provider.test.js',
  'preview-call-path-browser.test.js',
  'preview-selected-call.test.js',
  'preview-selected-call-provider.test.js',
  'preview-selected-call-browser.test.js',
  'preview-fidelity-semantics.test.js',
  'preview-resolved-size.test.js',
  'preview-resolved-image.test.js',
  'preview-condition-scenarios.test.js',
  'preview-equipment.test.js',
  'preview-equipment-browser.test.js',
  'preview-gee-inputs.test.js',
  'preview-equipment-layout.test.js',
  'preview-equipment-layout-browser.test.js',
  'preview-gee-inputs-browser.test.js',
  'preview-gee-equipment-slot-browser.test.js',
  'preview-gee-dynamic-equipment-browser.test.js',
  'preview-fidelity-repair-browser.test.js',
  'preview-command-outputs.test.js',
  'preview-percent.test.js',
  'preview-parameter-snapshots.test.js',
  'preview-remaining-audit.test.js',
  'preview-collection-shadows.test.js',
  'preview-excel.test.js',
  'preview-excel-provider.test.js',
  'preview-excel-integration.test.js',
  'preview-excel-browser.test.js',
  'preview-csv-functions.test.js',
  'preview-csv-cache-provider.test.js',
  'preview-csv-cache-browser.test.js',
  'preview-completion-browser.test.js',
  'preview-variable-contracts.test.js',
  'preview-collections.test.js',
  'preview-collections-integration.test.js',
  'preview-scoped-variables.test.js',
  'preview-inputs-integration.test.js',
  'preview-inputs-expanded-browser.test.js',
  'preview-inputs.test.js',
  'preview-inputs-provider.test.js',
  'preview-inputs-browser.test.js',
  'preview-input-surface-scope.test.js',
  'preview-global-values.test.js',
  'preview-input-surface-scope-provider.test.js',
  'preview-input-surface-scope-browser.test.js',
  'npc-dialog-ui-compact-browser.test.js',
  'npc-dialog-strict-runner.test.js',
  'act-ui-preview.test.js',
  'all-text-surface-contract.test.js',
  'addbutton-action-preview.test.js',
  'addbutton-provider.test.js',
  'adddlg-companion.test.js',
  'adddlg-provider.test.js',
  'bignum-text.test.js',
  'dialog-background-preview.test.js',
  'dynamic-text-canvas-usability.test.js',
  'flow-link-runtime-action.test.js',
  'gee-adddlg-provider.test.js',
  'gee-adddlg.test.js',
  'gom-addbuttonex-coordinate-edit.test.js',
  'img-strict-runtime.test.js',
  'imgnum-customitem-runtime.test.js',
  'input-local-validation.test.js',
  'item-tooltip.test.js',
  'itembox-constraints.test.js',
  'itemshow-idx-provenance-invalidation.test.js',
  'itemshow-idx-looks-provider.test.js',
  'item-light-preview.test.js',
  'itemshow-cache-gate.test.js',
  'itemshow-tooltip-provider.test.js',
  'listview-strict-runtime.test.js',
  'menuitem-local-selection.test.js',
  'menuitem-strict-assets-provider.test.js',
  'menuitem-strict-assets.test.js',
  'mtext-flow-dynamic-provenance.test.js',
  'npc-dialog-dynamic-source-safety.test.js',
  'progress-strict-runtime.test.js',
  'real-rank-canvas-usability.test.js',
  'rtext-scroll.test.js',
  'runtime-action-preview.test.js',
  'statement-schema-disambiguation.test.js',
  'static-image-title.test.js',
  'strict-control-fields-and-states.test.js',
  'strict-control-states-provider.test.js',
  'textatlas-provider-gate.test.js',
  'textatlas-strict-runtime.test.js',
  'uimodel-controls.test.js',
  'window-background-coordinate-bindings.test.js',
  'act-ui-preview-browser.test.js',
  'all-text-surface-contract-browser.test.js',
  'addbutton-action-preview-browser.test.js',
  'adddlg-window-browser.test.js',
  'animation-controls-browser.test.js',
  'bignum-text-browser.test.js',
  'dialog-background-preview-browser.test.js',
  'dialog-origin-composition-browser.test.js',
  'dynamic-text-canvas-usability-browser.test.js',
  'flow-link-runtime-action-browser.test.js',
  'gee-adddlg-browser.test.js',
  'gom-addbuttonex-coordinate-edit-browser.test.js',
  'gom-main-dialog-content-origin-browser.test.js',
  'img-strict-runtime-browser.test.js',
  'imgnum-customitem-runtime-browser.test.js',
  'input-local-validation-browser.test.js',
  'item-controls-browser.test.js',
  'itembox-constraints-browser.test.js',
  'itemshow-idx-looks-browser.test.js',
  'legacy-coordinate-bias-browser.test.js',
  'listview-strict-runtime-browser.test.js',
  'listview-composition-browser.test.js',
  'menuitem-local-selection-browser.test.js',
  'menuitem-strict-assets-browser.test.js',
  'mtext-flow-dynamic-provenance-browser.test.js',
  'npc-dialog-dynamic-source-safety-browser.test.js',
  'p1-controls-browser.test.js',
  'progress-strict-runtime-browser.test.js',
  'real-rank-canvas-usability-browser.test.js',
  'rtext-scroll-browser.test.js',
  'runtime-action-preview-browser.test.js',
  'static-image-title-browser.test.js',
  'strict-control-states-browser.test.js',
  'text-coordinate-bias-contract-browser.test.js',
  'textatlas-strict-runtime-browser.test.js',
  'window-background-coordinate-bindings-browser.test.js',
];

function runStrictChild(file, environment, options = {}) {
  const spawnChild = options.spawnChild || spawn;
  const timeoutMs = options.timeoutMs ?? CHILD_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? CHILD_KILL_GRACE_MS;
  return new Promise(resolve => {
    const stdout = [];
    const stderr = [];
    let spawnError;
    const child = spawnChild(process.execPath, [path.join(__dirname, file)], {
      cwd: path.resolve(__dirname, '..'),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let timedOut = false;
    let settled = false;
    let hardSettled = false;
    let killReturned;
    let killError;
    let hardSettleTimer;

    const finish = (status, signal, forcedHardSettle = false) => {
      if (settled) return;
      settled = true;
      hardSettled = forcedHardSettle;
      clearTimeout(timeoutTimer);
      clearTimeout(hardSettleTimer);

      // A child that did not emit `close` may still own live process/pipe handles.
      // Detach those handles so the strict-suite process itself cannot hang forever.
      if (hardSettled) {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref?.();
      }

      const output = Buffer.concat([...stdout, ...stderr]).toString('utf8');
      const skipLines = output.split(/\r?\n/u)
        .filter(line => /\bSKIP(?:PED)?\b/iu.test(line));
      resolve({
        status,
        signal,
        error: spawnError,
        skipLines,
        timedOut,
        hardSettled,
        killReturned,
        killError,
      });
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        killReturned = child.kill('SIGKILL');
      } catch (error) {
        killError = error;
      }
      if (!settled) {
        hardSettleTimer = setTimeout(() => {
          finish(null, null, true);
        }, killGraceMs);
      }
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdout.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr.push(chunk);
      process.stderr.write(chunk);
    });
    child.once('error', error => {
      spawnError = error;
    });
    child.once('close', (status, signal) => {
      finish(status, signal, false);
    });
  });
}

async function main() {
  const failures = [];
  const childTimeoutMs = resolveChildTimeoutMs(process.env);
  const browserExecutable = findRequiredBrowser();
  if (!browserExecutable) {
    throw new Error('real Edge/Chrome is required; SKIP is not accepted');
  }
  console.log(`npc-dialog-strict-suite.js: required-browser=${browserExecutable}`);
  console.log(`npc-dialog-strict-suite.js: child-timeout-ms=${childTimeoutMs}`);

  const strictEnvironment = {
    ...process.env,
    BOO_BROWSER_EXECUTABLE: browserExecutable,
    BOO_CHROMIUM_PATH: browserExecutable,
    BOO_REQUIRE_REAL_BROWSER: '1',
  };

  for (const [index, file] of tests.entries()) {
    console.log(`[npc-dialog-strict ${index + 1}/${tests.length}] ${file}`);
    const result = await runStrictChild(file, strictEnvironment, { timeoutMs: childTimeoutMs });
    if (result.error || result.status !== 0 || result.skipLines.length > 0 || result.timedOut) {
      const failure = {
        file,
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
        ...(result.timedOut ? { timedOut: true } : {}),
        ...(result.hardSettled ? {
          hardSettled: true,
          matrixAborted: true,
          remainingTestsNotStarted: tests.length - index - 1,
        } : {}),
        ...(typeof result.killReturned === 'boolean' ? { killReturned: result.killReturned } : {}),
        ...(result.killError ? { killError: result.killError.message } : {}),
        ...(result.skipLines.length > 0 ? { skipLines: result.skipLines } : {}),
      };
      failures.push(failure);
      if (result.hardSettled) {
        console.error(
          `npc-dialog-strict-suite.js: ABORT remaining matrix; ${file} did not emit close within ${CHILD_KILL_GRACE_MS}ms after timeout`,
        );
        break;
      }
    }
  }

  if (failures.length > 0) {
    console.error(`npc-dialog-strict-suite.js: FAIL (${failures.length}/${tests.length})`);
    for (const failure of failures) console.error(JSON.stringify(failure));
    process.exitCode = 1;
  } else {
    console.log(`npc-dialog-strict-suite.js: PASS (${tests.length}/${tests.length})`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`npc-dialog-strict-suite.js: FAIL (${error?.stack || error})`);
    process.exitCode = 1;
  });
}

module.exports = {
  CHILD_KILL_GRACE_MS,
  CHILD_TIMEOUT_MS,
  MAX_TIMER_DELAY_MS,
  resolveChildTimeoutMs,
  runStrictChild,
};
