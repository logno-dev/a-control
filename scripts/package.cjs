const { spawnSync } = require('node:child_process');
function packageEnvironment(environment) {
  const result = { ...environment };
  // GitHub supplies absent secrets as empty strings. electron-builder treats an
  // empty CSC_LINK as a certificate file path (the working directory), not absent.
  for (const name of ['CSC_LINK', 'CSC_NAME', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD',
    'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (typeof result[name] === 'string' && !result[name].trim()) delete result[name];
  }
  return result;
}
module.exports = { packageEnvironment };
if (require.main === module) {
  const args = process.argv.slice(2);
  const environment = packageEnvironment(process.env);
  const mac = args.includes('--mac') || (!args.some(arg => ['--win', '--linux'].includes(arg)) && process.platform === 'darwin');
  // Without a Developer ID certificate, bind the bundle to its own Info.plist.
  if (mac && !environment.CSC_LINK && !environment.CSC_NAME && !args.some(arg => arg.includes('mac.identity'))) args.push('--config.mac.identity=-');
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...args], { stdio: 'inherit', env: environment });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
}
