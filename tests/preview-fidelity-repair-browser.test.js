const path = require('node:path');
process.env.BOO_FIDELITY_EXPECT_SEMANTICS = '1';
process.env.BOO_FIDELITY_EXPECT_SIZE = '1';
process.env.BOO_FIDELITY_EXPECT_IMAGE = '1';
process.env.BOO_FIDELITY_EXPECT_NAVIGATION = '1';
process.env.BOO_FIDELITY_EXPECT_SCENARIOS = '1';
process.env.BOO_FIDELITY_AUDIT_OUT ||= path.resolve('artifacts/ctrl-f12-fidelity-repair-20260908/browser');
require('./preview-fidelity-audit-browser.test');
