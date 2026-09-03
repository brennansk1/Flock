/**
 * Procedural Web Audio Engine (§30 Audio Stems & SFX Hooks).
 *
 * Zero external audio assets/MP3s required — synthesizes signature cult audio
 * triggers, civic decree fanfares, and high-stakes threat alarms using native
 * Web Audio API oscillators, biquad filters, white-noise generators, and ADSR envelopes.
 * Gracefully degrades to a no-op in headless/test environments or when muted.
 */

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
      masterGain = audioCtx.createGain();
      sfxGain = audioCtx.createGain();
      sfxGain.connect(masterGain);
      masterGain.connect(audioCtx.destination);
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function setSfxVolume(vol: number): void {
  const ctx = getAudioContext();
  if (ctx && sfxGain) {
    sfxGain.gain.setValueAtTime(Math.max(0, Math.min(1, vol / 100)), ctx.currentTime);
  }
}

/** Create white noise buffer for fire crackle, breath, and static. */
function createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, sampleRate * seconds, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * FINAL DAWN: Cathedral Pipe Organ Minor Chord + Crackling Fire Embers.
 * Detuned sawtooth oscillators in a dark minor triad (D minor) with lowpass filter
 * and crackling noise bursts.
 */
export function playFinalDawnTheme(): void {
  const ctx = getAudioContext();
  if (!ctx || !sfxGain) return;
  const now = ctx.currentTime;

  // D minor organ chord (D3: 146.83 Hz, F3: 174.61 Hz, A3: 220.00 Hz, D4: 293.66 Hz)
  const freqs = [146.83, 174.61, 220.0, 293.66];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, now);
    // slight organ vibrato
    osc.detune.setValueAtTime((Math.random() - 0.5) * 8, now);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(350, now + 1.4);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain);

    osc.start(now);
    osc.stop(now + 1.6);
  }

  // Crackling fire noise
  try {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, 1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.setValueAtTime(3.0, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain);

    noise.start(now);
    noise.stop(now + 1.2);
  } catch {}
}

/**
 * RADIANT PATH: Ethereal Wind Chimes + Acoustic Pan Flute.
 * Pure high-frequency sine pings with resonant decay over a warm pentatonic acoustic flute.
 */
export function playRadiantPathTheme(): void {
  const ctx = getAudioContext();
  if (!ctx || !sfxGain) return;
  const dest = sfxGain;
  const now = ctx.currentTime;

  // Wind chime cascade (pentatonic high chimes: E6, G6, A6, B6, D7)
  const chimeFreqs = [1318.5, 1567.98, 1760.0, 1975.53, 2349.32];
  chimeFreqs.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startTime = now + idx * 0.08;

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.06, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.2);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(startTime);
    osc.stop(startTime + 1.2);
  });

  // Acoustic flute fundamental (A4: 440 Hz soft sine with breath)
  const flute = ctx.createOscillator();
  const fluteGain = ctx.createGain();
  flute.type = "sine";
  flute.frequency.setValueAtTime(440, now);
  flute.frequency.exponentialRampToValueAtTime(523.25, now + 0.5); // slide to C5

  fluteGain.gain.setValueAtTime(0, now);
  fluteGain.gain.linearRampToValueAtTime(0.09, now + 0.15);
  fluteGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

  flute.connect(fluteGain);
  fluteGain.connect(sfxGain);

  flute.start(now);
  flute.stop(now + 1.4);
}

/**
 * PROSPERITY CIRCLE: Executive Cash Register "Cha-Ching" + Penthouse Elevator Chime.
 * Metallic bell transient + mechanical drawer click followed by a warm luxury ding.
 */
export function playProsperityCircleTheme(): void {
  const ctx = getAudioContext();
  if (!ctx || !sfxGain) return;
  const now = ctx.currentTime;

  // "Cha" metallic mechanical transient
  const click = ctx.createOscillator();
  const clickGain = ctx.createGain();
  click.type = "triangle";
  click.frequency.setValueAtTime(2200, now);
  click.frequency.exponentialRampToValueAtTime(400, now + 0.04);
  clickGain.gain.setValueAtTime(0.12, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  click.connect(clickGain);
  clickGain.connect(sfxGain);
  click.start(now);
  click.stop(now + 0.05);

  // "Ching" high resonant register bell (B6: 1975.5 Hz + harmonic)
  const bell1 = ctx.createOscillator();
  const bell2 = ctx.createOscillator();
  const bellGain = ctx.createGain();

  bell1.type = "sine";
  bell1.frequency.setValueAtTime(1975.53, now + 0.05);
  bell2.type = "sine";
  bell2.frequency.setValueAtTime(3951.07, now + 0.05);

  bellGain.gain.setValueAtTime(0.15, now + 0.05);
  bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);

  bell1.connect(bellGain);
  bell2.connect(bellGain);
  bellGain.connect(sfxGain);

  bell1.start(now + 0.05);
  bell2.start(now + 0.05);
  bell1.stop(now + 1.1);
  bell2.stop(now + 1.1);
}

/**
 * VISITORS' FELLOWSHIP: Theremin Pitch Glide Sweep + Cosmic Telemetry Bleeps.
 * Portamento sine wave with smooth vibrato and rhythmic scientific telemetry pulses.
 */
export function playVisitorsFellowshipTheme(): void {
  const ctx = getAudioContext();
  if (!ctx || !sfxGain) return;
  const dest = sfxGain;
  const now = ctx.currentTime;

  // Theremin pitch sweep with vibrato (F#4 -> C#5 -> G5)
  const theremin = ctx.createOscillator();
  const vibrato = ctx.createOscillator();
  const vibratoGain = ctx.createGain();
  const thereminGain = ctx.createGain();

  theremin.type = "sine";
  theremin.frequency.setValueAtTime(369.99, now);
  theremin.frequency.exponentialRampToValueAtTime(783.99, now + 0.6);
  theremin.frequency.exponentialRampToValueAtTime(554.37, now + 1.2);

  vibrato.type = "sine";
  vibrato.frequency.setValueAtTime(6.5, now); // 6.5 Hz vibrato
  vibratoGain.gain.setValueAtTime(18, now); // 18 Hz modulation depth

  vibrato.connect(theremin.frequency);

  thereminGain.gain.setValueAtTime(0, now);
  thereminGain.gain.linearRampToValueAtTime(0.1, now + 0.1);
  thereminGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);

  theremin.connect(thereminGain);
  thereminGain.connect(dest);

  vibrato.start(now);
  theremin.start(now);
  vibrato.stop(now + 1.3);
  theremin.stop(now + 1.3);

  // Cosmic telemetry bleeps
  const bleepFreqs = [880, 1320, 1760];
  bleepFreqs.forEach((bf, idx) => {
    const bOsc = ctx.createOscillator();
    const bGain = ctx.createGain();
    const bTime = now + 0.2 + idx * 0.12;

    bOsc.type = "sine";
    bOsc.frequency.setValueAtTime(bf, bTime);

    bGain.gain.setValueAtTime(0.05, bTime);
    bGain.gain.exponentialRampToValueAtTime(0.0001, bTime + 0.08);

    bOsc.connect(bGain);
    bGain.connect(dest);

    bOsc.start(bTime);
    bOsc.stop(bTime + 0.08);
  });
}

/** Play signature theme for the selected archetype. */
export function playFactionTheme(archetype: "dawn" | "radiant" | "circle" | "visitors"): void {
  switch (archetype) {
    case "dawn":
      playFinalDawnTheme();
      break;
    case "radiant":
      playRadiantPathTheme();
      break;
    case "circle":
      playProsperityCircleTheme();
      break;
    case "visitors":
      playVisitorsFellowshipTheme();
      break;
  }
}

/** Stately brass fanfare when enacting a town-wide Civic Decree. */
export function playCivicDecreeSfx(): void {
  const ctx = getAudioContext();
  if (!ctx || !sfxGain) return;
  const dest = sfxGain;
  const now = ctx.currentTime;

  const notes = [261.63, 329.63, 392.0, 523.25]; // C major chord
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startTime = now + idx * 0.06;

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.09, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.8);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(startTime);
    osc.stop(startTime + 0.8);
  });
}

/** Triumphant golden fanfare when unlocking a Municipal Monopoly. */
export function playMonopolyUnlockSfx(): void {
  const ctx = getAudioContext();
  if (!ctx || !sfxGain) return;
  const dest = sfxGain;
  const now = ctx.currentTime;

  // Ascending arpeggio + shimmering ring
  const notes = [392.0, 493.88, 587.33, 783.99, 987.77];
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startTime = now + idx * 0.07;

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.12, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.2);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(startTime);
    osc.stop(startTime + 1.2);
  });
}
