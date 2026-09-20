process.env.BOO_SUBMIT_PLAYIMG = '1';
process.env.BOO_INPUT_SUBMIT_OUT = process.env.BOO_PLAYIMG_SUBMIT_OUT || 'artifacts/preview-events-r9/playimg-browser';
require('./preview-input-submit-browser.test');
