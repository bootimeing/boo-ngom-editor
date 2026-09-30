// Credentials arrive only through stdin. No argv password, process launch, conversion, or cache writes.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { inspectPakStructure } = require('../../out/utils/pak-structure');

function verifyRunningBridge() {
  const configuredPort = Number(process.env.BOO_PAK_BRIDGE_PORT || '');
  const port = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535 ? configuredPort : 8765;
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, response => {
      const parts = []; let length = 0;
      response.on('error', () => reject(Error('离线引擎健康响应失败，未发送素材密码')));
      response.on('data', part => {
        length += part.length;
        if (length > 65536) { response.destroy(); reject(Error('离线引擎健康响应异常，未发送素材密码')); }
        else parts.push(part);
      });
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(parts));
          if (response.statusCode !== 200 || value.ok !== true || value.engine !== 'offline'
            || value.gmProcessRequired !== false || !Array.isArray(value.formats)
            || !value.formats.includes('GEEPAK2') || !value.formats.includes('GEEPAK3')) throw Error();
          resolve();
        } catch { reject(Error('目标不是兼容的PAK离线引擎，未发送素材密码')); }
      });
    });
    request.on('error', () => reject(Error('现有PAK离线引擎不可用，未发送素材密码')));
    request.on('timeout', () => request.destroy());
  });
}

async function main() {
  if (process.argv.length !== 2) throw Error('仅接受 stdin JSON，不接受命令行密码参数');
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Error('结构检查输入过大');
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw Error('输入必须是有效 JSON；未输出输入内容'); }
  if (!input || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 100
    || !input.files.every(file => typeof file === 'string' && file.length > 0)
    || typeof input.password !== 'string' || typeof input.reportFile !== 'string' || !input.reportFile) {
    throw Error('需要 files（1..100个路径）、password、reportFile；密码不写入报告');
  }
  const reportFile = path.resolve(input.reportFile);
  if (fs.existsSync(reportFile)) throw Error('报告目标已存在，拒绝覆盖');
  const root = path.resolve(__dirname, '../..');
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(),
    boundary: 'Structural inspection only; image pixels and client rendering are not verified.', files: [] };
  for (const file of input.files) {
    try {
      const result = await inspectPakStructure({ extensionPath: root, pakPath: file, password: input.password,
        maxReportSlots: input.maxReportSlots,
        ensureBridge: input.useRunningBridge === true ? verifyRunningBridge : undefined });
      report.files.push({ status: result.issues.length ? 'structural-issues' : 'inspected', ...result });
    } catch (error) {
      let message = error instanceof Error ? error.message : '结构检查失败';
      if (input.password) message = message.split(input.password).join('[REDACTED]');
      report.files.push({ fileName: path.basename(file), status: 'not-inspected', reason: message });
    }
  }
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  // Exclusive creation also guards against a race or an accidentally selected source file.
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ reportFile, files: report.files.map(file => ({
    fileName: file.fileName, status: file.status, profileId: file.profileId, totals: file.totals,
  })) }, null, 2));
  if (report.files.some(file => file.status !== 'inspected')) process.exitCode = 2;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
