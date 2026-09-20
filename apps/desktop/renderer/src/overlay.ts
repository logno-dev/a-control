import icon from '../../../../icon.svg?url';
import './overlay.css';
(document.getElementById('icon') as HTMLImageElement).src = icon;
window.deck.subscribe(notice => {
  if (notice.type !== 'overlay') return;
  document.querySelector('.osd')!.classList.toggle('error', notice.label === 'ACTION ERROR');
  document.getElementById('title')!.textContent = notice.text;
  document.getElementById('label')!.textContent = `MIDI DECK · ${notice.label ?? 'ACTIVE PROFILE'}`;
  document.getElementById('detail')!.textContent = notice.detail ?? '';
});
