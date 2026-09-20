import { WebAudioSynth } from '../../../../packages/synth/engine';
const synth = new WebAudioSynth();
window.deck.onAudio(message => {
  if (message.type === 'midi') synth.event(message.event);
  if (message.type === 'settings') synth.configure(message.settings);
  if (message.type === 'panic') synth.panic();
});
window.deck.audioReady();
