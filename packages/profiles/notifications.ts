import type { Config, Profile } from '../shared/schema';
import { effectiveProfile } from './resolver';

export class ProfileChangeNotifier {
  private current?: string;
  private announced?: string;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private notify: (profile: Profile, foreground: string) => void, private delay = 350) {}
  update(config: Config, foreground: string) {
    const profile = effectiveProfile(config, foreground);
    if (this.current === undefined) { this.current = profile.id; this.announced = profile.id; return; }
    if (profile.id === this.current) return;
    this.current = profile.id;
    clearTimeout(this.timer);
    if (profile.id === this.announced) return;
    this.timer = setTimeout(() => {
      this.announced = profile.id;
      this.notify(profile, foreground);
    }, this.delay);
  }
  close() { clearTimeout(this.timer); }
}
