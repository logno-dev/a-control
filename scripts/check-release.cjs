const { version } = require('../package.json');
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${version}`) {
  console.error(`Release tag ${tag} does not match package.json version v${version}`);
  process.exit(1);
}
console.log(`Building MIDI Deck ${version}`);
