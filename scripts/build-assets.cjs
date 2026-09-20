const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const output = resolve('out/assets');
mkdirSync(output, { recursive: true });
const svg = readFileSync(resolve('icon.svg'), 'utf8');
const png = size => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
const images = new Map([16, 24, 32, 48, 64, 128, 256, 512, 1024].map(size => [size, png(size)]));
writeFileSync(join(output, 'icon.png'), images.get(1024));
writeFileSync(join(output, 'tray.png'), images.get(32));

// PNG-backed ICO entries (supported by modern Windows) generated on every CI OS.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16, image = images.get(size);
  header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
writeFileSync(join(output, 'icon.ico'), Buffer.concat([header, ...sizes.map(size => images.get(size))]));

const chunks = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(([size, tag]) => {
  const image = images.get(size), chunk = Buffer.alloc(8);
  chunk.write(tag, 0, 'ascii'); chunk.writeUInt32BE(image.length + 8, 4);
  return Buffer.concat([chunk, image]);
});
const icns = Buffer.alloc(8); icns.write('icns', 0, 'ascii'); icns.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
writeFileSync(join(output, 'icon.icns'), Buffer.concat([icns, ...chunks]));
console.log('Generated app, tray, Windows, and macOS icons from icon.svg');
