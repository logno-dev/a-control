const { createHash } = require('node:crypto');
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.argv[2];
const files = readdirSync(directory).filter(file => /\.(exe|dmg|zip|blockmap)$/.test(file)).sort();
if (!files.length) throw new Error('No release assets found');
writeFileSync(join(directory, 'SHA256SUMS.txt'), files.map(file => `${createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')}  ${file}`).join('\n') + '\n');
console.log(`Generated checksums for ${files.length} assets`);
