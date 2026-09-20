const { createHash } = require('node:crypto');
const { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
function createChecksums(directory) {
  const files = readdirSync(directory).filter(file => /\.(exe|dmg|zip|blockmap)$/.test(file)).sort();
  if (!files.length) throw new Error('No release assets found');
  // GitHub replaces spaces in uploaded asset names with dots. Normalize before
  // hashing/uploading so downloaded files match the names in the manifest.
  const assets = files.map(file => ({ source: file, name: file.replaceAll(' ', '.') }));
  if (new Set(assets.map(asset => asset.name)).size !== assets.length || assets.some(asset => asset.source !== asset.name && existsSync(join(directory, asset.name)))) throw new Error('Release asset filename collision');
  for (const asset of assets) if (asset.source !== asset.name) renameSync(join(directory, asset.source), join(directory, asset.name));
  writeFileSync(join(directory, 'SHA256SUMS.txt'), assets.map(({ name }) => `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}`).join('\n') + '\n');
  return assets.length;
}
module.exports = { createChecksums };
if (require.main === module) console.log(`Generated checksums for ${createChecksums(process.argv[2])} assets`);
