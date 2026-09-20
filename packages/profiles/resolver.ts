import type { Config, Profile } from '../shared/schema';

export function applicationProfile(config: Config, foreground: string): Profile | undefined {
  if (!config.settings.autoSwitch || !foreground) return undefined;
  const executable = foreground.split(/[\\/]/).pop()!.toLowerCase();
  return config.profiles.find(p => p.kind === 'application' && p.match.split(',').some(match => match.trim().toLowerCase() === executable));
}
export function resolveMapping(config: Config, controlId: string, foreground: string) {
  const layers = [applicationProfile(config, foreground), config.profiles.find(p => p.id === config.activeProfile), config.profiles.find(p => p.kind === 'global')];
  return resolveLayers(layers, controlId);
}
export function effectiveProfile(config: Config, foreground: string): Profile {
  return applicationProfile(config, foreground) ?? config.profiles.find(p => p.id === config.activeProfile)!;
}
// Editor previews never change the actual active profile or foreground application.
export function resolvePreview(config: Config, controlId: string, selected: Profile) {
  const global = config.profiles.find(p => p.kind === 'global');
  return resolveLayers(selected.kind === 'global' ? [selected] : selected.kind === 'user' ? [selected, global] : [selected, config.profiles.find(p => p.id === config.activeProfile), global], controlId);
}
function resolveLayers(layers: (Profile | undefined)[], controlId: string) {
  for (const profile of layers) {
    const mapping = profile?.mappings.find(m => m.controlId === controlId);
    // A disabled override intentionally blocks inherited mappings.
    if (mapping) return { mapping, profile: profile! };
  }
  return undefined;
}
