/**
 * Settings & accessibility (§28). Persisted to localStorage and applied
 * globally via a class on <html> that the HUD/menu CSS keys off, so toggles
 * take effect immediately without re-mounting anything.
 *
 *  - reducedMotion: disables HUD pulses / spinners / feed fade (§28, default off)
 *  - muteChat: hides chat + defaults ON in public FFA (§28)
 *  - colorblind: emphasizes the archetype *patterns* (always-safe by default)
 *  - sfxVolume / musicVolume: 0–100 (audio is a content pass; honoured when added)
 */

export interface Settings {
  reducedMotion: boolean;
  muteChat: boolean;
  colorblind: boolean;
  sfxVolume: number;
  musicVolume: number;
}

const KEY = "flock.settings";
const DEFAULTS: Settings = {
  reducedMotion: false,
  muteChat: true, // mute-all-chat default ON in public FFA (§28)
  colorblind: true, // colorblind patterns always-on by default (§30)
  sfxVolume: 80,
  musicVolume: 60,
};

let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export function getSettings(): Settings {
  return current;
}

export function saveSettings(next: Partial<Settings>): Settings {
  current = { ...current, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  applySettings();
  return current;
}

/** Reflect settings onto <html> classes the CSS reads. Call once at boot. */
export function applySettings(): void {
  const el = document.documentElement;
  el.classList.toggle("fk-reduced-motion", current.reducedMotion);
  el.classList.toggle("fk-colorblind", current.colorblind);
  el.classList.toggle("fk-mute-chat", current.muteChat);
}
