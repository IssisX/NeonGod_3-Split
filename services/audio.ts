
import { SoundType } from '../types';
import { Utils } from '../utils';

// --- AUDIO CONFIG ---
const VOICE_COUNT = 16; // Max concurrent SFX
const POOL_SIZE = 32;   // Music sequencer pool

class SynthVoice {
    ctx: AudioContext;
    osc: OscillatorNode;
    noise: AudioBufferSourceNode | null = null;
    filter: BiquadFilterNode;
    gain: GainNode;
    panner: PannerNode;
    active: boolean = false;
    noiseBuffer: AudioBuffer;

    constructor(ctx: AudioContext, dest: AudioNode, noiseBuffer: AudioBuffer) {
        this.ctx = ctx;
        this.noiseBuffer = noiseBuffer;

        // Graph: Osc -> Filter -> Gain -> Panner -> Dest
        this.osc = ctx.createOscillator();
        this.filter = ctx.createBiquadFilter();
        this.gain = ctx.createGain();
        this.panner = ctx.createPanner();

        // Panner Setup (HRTF for 3D)
        this.panner.panningModel = 'HRTF';
        this.panner.distanceModel = 'inverse';
        this.panner.refDistance = 600;
        this.panner.maxDistance = 4000;
        this.panner.rolloffFactor = 0.5;

        // Defaults
        this.gain.gain.value = 0;
        this.osc.start(); // Keep running, just gate the gain (Zero-alloc strategy)

        // Routing
        this.osc.connect(this.filter);
        this.filter.connect(this.gain);
        this.gain.connect(this.panner);
        this.panner.connect(dest);
    }

    trigger(t: number, params: any, x?: number, y?: number) {
        // 1. Position
        if (x !== undefined && y !== undefined) {
            this.panner.positionX.setValueAtTime(x, t);
            this.panner.positionY.setValueAtTime(y, t);
            this.panner.positionZ.setValueAtTime(0, t);
        } else {
            // Center if global
            this.panner.positionX.setValueAtTime(0, t);
            this.panner.positionY.setValueAtTime(0, t);
            this.panner.positionZ.setValueAtTime(100, t); // Slight depth
        }

        // 2. Oscillator Setup
        const type = params.type || 'sine';
        if (this.osc.type !== type) this.osc.type = type;

        // Frequency Envelope
        if (params.freq) {
            this.osc.frequency.cancelScheduledValues(t);
            this.osc.frequency.setValueAtTime(params.freq.start, t);
            if (params.freq.end) {
                this.osc.frequency.exponentialRampToValueAtTime(params.freq.end, t + params.dur);
            }
        }

        // 3. Noise Layer (Optional)
        if (params.noise) {
            // Create buffer source (lightweight compared to full graph)
            const n = this.ctx.createBufferSource();
            n.buffer = this.noiseBuffer;
            
            // Noise Filter
            const nf = this.ctx.createBiquadFilter();
            nf.type = params.noise.filterType || 'lowpass';
            nf.frequency.setValueAtTime(params.noise.filterFreq || 1000, t);
            if (params.noise.filterSweep) {
                nf.frequency.linearRampToValueAtTime(params.noise.filterSweep, t + params.dur);
            }

            const ng = this.ctx.createGain();
            ng.gain.setValueAtTime(params.noise.gain || 0.5, t);
            ng.gain.exponentialRampToValueAtTime(0.01, t + params.dur);

            n.connect(nf).connect(ng).connect(this.panner);
            n.start(t);
            n.stop(t + params.dur);
        }

        // 4. Amp Envelope
        this.gain.gain.cancelScheduledValues(t);
        this.gain.gain.setValueAtTime(params.vol, t);
        this.gain.gain.exponentialRampToValueAtTime(0.001, t + params.dur);
    }
}

export class AudioService {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  limiter: DynamicsCompressorNode | null = null;
  
  // Busses
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;

  // Resources
  noiseBuffer: AudioBuffer | null = null;
  voices: SynthVoice[] = [];
  voiceIdx = 0;

  // Music State
  isPlaying = false;
  tempo = 120;
  beat = 0;
  nextNoteTime = 0;
  intensity = 0;

  init() {
    if (this.ctx) return;
    
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive', sampleRate: 44100 });
    
    // Master Chain: Limiter -> Destination
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.ratio.value = 12;
    this.limiter.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.limiter);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.4;
    this.musicBus.connect(this.master);

    // Generate White Noise Buffer (3s is enough)
    const bufSize = this.ctx.sampleRate * 3;
    this.noiseBuffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    // Allocate Voice Pool
    for (let i = 0; i < VOICE_COUNT; i++) {
        this.voices.push(new SynthVoice(this.ctx, this.sfxBus, this.noiseBuffer));
    }

    this.isPlaying = true;
    this.scheduleMusic();
  }

  // --- API ---

  setIntensity(val: number) { this.intensity = Utils.lerp(this.intensity, val, 0.1); }
  setTempoMultiplier(val: number) { this.tempo = 120 * val; }
  
  updateListener(x: number, y: number) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      // Smooth transition to prevent zipper noise
      this.ctx.listener.positionX.setTargetAtTime(x, t, 0.1);
      this.ctx.listener.positionY.setTargetAtTime(y, t, 0.1);
      this.ctx.listener.positionZ.setTargetAtTime(500, t, 0.1);
  }

  play(type: SoundType, x?: number, y?: number) {
      if (!this.ctx || this.ctx.state === 'suspended') {
          this.ctx?.resume();
          return;
      }

      // Round-robin allocation
      const voice = this.voices[this.voiceIdx];
      this.voiceIdx = (this.voiceIdx + 1) % VOICE_COUNT;
      
      const t = this.ctx.currentTime;

      // --- PROCEDURAL SOUND DEFINITIONS ---
      switch (type) {
          case 'shoot':
              voice.trigger(t, {
                  type: 'triangle',
                  freq: { start: 300, end: 50 },
                  vol: 0.7,
                  dur: 0.15,
                  noise: { gain: 0.4, filterFreq: 2000, filterSweep: 100 }
              }, x, y);
              break;

          case 'shoot_shotgun':
              voice.trigger(t, {
                  type: 'square',
                  freq: { start: 150, end: 20 },
                  vol: 1.0,
                  dur: 0.4,
                  noise: { gain: 1.2, filterFreq: 1500, filterSweep: 50, filterType: 'lowpass' }
              }, x, y);
              break;

          case 'shoot_railgun':
              voice.trigger(t, {
                  type: 'sawtooth',
                  freq: { start: 2000, end: 500 },
                  vol: 0.6,
                  dur: 0.3
              }, x, y);
              // Second Layer (Electrical Zap)
              const v2 = this.voices[(this.voiceIdx + 1) % VOICE_COUNT];
              v2.trigger(t, {
                  type: 'square',
                  freq: { start: 100, end: 800 },
                  vol: 0.4,
                  dur: 0.2
              }, x, y);
              break;

          case 'shoot_void':
              voice.trigger(t, {
                  type: 'sine',
                  freq: { start: 50, end: 200 }, // Reverse sweep
                  vol: 0.8,
                  dur: 0.5
              }, x, y);
              break;

          case 'hit':
              voice.trigger(t, {
                  type: 'square',
                  freq: { start: 200, end: 100 },
                  vol: 0.5,
                  dur: 0.1
              }, x, y);
              break;

          case 'explosion':
              voice.trigger(t, {
                  type: 'sawtooth',
                  freq: { start: 100, end: 10 },
                  vol: 1.2,
                  dur: 0.6,
                  noise: { gain: 1.5, filterFreq: 800, filterSweep: 50 }
              }, x, y);
              break;

          case 'dash':
              voice.trigger(t, {
                  type: 'triangle',
                  freq: { start: 600, end: 1200 },
                  vol: 0.3,
                  dur: 0.2
              }, x, y);
              break;

          case 'levelup':
              // Major Arpeggio
              [0, 4, 7, 12].forEach((note, i) => {
                  setTimeout(() => {
                      const v = this.voices[(this.voiceIdx + i) % VOICE_COUNT];
                      v.trigger(this.ctx!.currentTime, {
                          type: 'sine',
                          freq: { start: 440 * Math.pow(2, note/12), end: 440 * Math.pow(2, note/12) },
                          vol: 0.4,
                          dur: 0.5
                      });
                  }, i * 50);
              });
              break;
              
          case 'warp_charge':
              voice.trigger(t, {
                  type: 'sawtooth',
                  freq: { start: 50, end: 800 }, // Riser
                  vol: 0.5,
                  dur: 2.0
              }, x, y);
              break;
              
          case 'warp_jump':
              voice.trigger(t, {
                  type: 'square',
                  freq: { start: 1000, end: 50 }, // Drop
                  vol: 1.0,
                  dur: 1.5,
                  noise: { gain: 1.0, filterFreq: 5000, filterSweep: 100 }
              }, x, y);
              break;
              
          case 'glitch_start':
              voice.trigger(t, { type: 'sawtooth', freq: { start: 100, end: 5000 }, vol: 0.5, dur: 0.2 }, x, y);
              break;
      }
  }

  // --- MUSIC SEQUENCER (GENERIC TECHNO) ---

  scheduleMusic() {
      if (!this.ctx || !this.isPlaying) return;

      const lookahead = 0.1;
      const secondsPerBeat = 60.0 / this.tempo;
      const secondsPer16th = secondsPerBeat / 4;

      while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
          this.playDrumStep(this.nextNoteTime, this.beat);
          this.nextNoteTime += secondsPer16th;
          this.beat = (this.beat + 1) % 64; 
      }
      
      // Low-res timer is fine for scheduling
      setTimeout(() => this.scheduleMusic(), 25);
  }

  playDrumStep(t: number, step: number) {
      if (!this.ctx || !this.musicBus) return;

      // Kick (4/4)
      if (step % 4 === 0) {
          this.playSynthKick(t);
      }

      // Hat (Offbeats)
      if (step % 2 === 0) { // 8th notes
          this.playSynthHat(t, step % 4 === 2); // Open hat on offbeat
      }

      // Bass (Sidechained to kick implicitly by timing)
      if (this.intensity > 0.3) {
          if (step % 4 === 2) { // Offbeat bass
              this.playSynthBass(t, 55); // A1
          }
      }
      
      // Arp (High Intensity)
      if (this.intensity > 0.6 && step % 2 === 0) {
          const scale = [0, 3, 7, 10, 12];
          const note = scale[Math.floor(Math.random() * scale.length)];
          this.playSynthArp(t, 440 * Math.pow(2, (note - 12)/12));
      }
  }

  // --- MUSIC INSTRUMENTS (Dedicated, not from Pool) ---

  playSynthKick(t: number) {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
      gain.gain.setValueAtTime(1.0, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
      
      osc.connect(gain).connect(this.musicBus!);
      osc.start(t); osc.stop(t + 0.3);
  }

  playSynthHat(t: number, open: boolean) {
      const n = this.ctx!.createBufferSource();
      n.buffer = this.noiseBuffer;
      const f = this.ctx!.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 8000;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + (open ? 0.1 : 0.04));
      
      n.connect(f).connect(g).connect(this.musicBus!);
      n.start(t); n.stop(t + 0.2);
  }

  playSynthBass(t: number, freq: number) {
      const osc = this.ctx!.createOscillator();
      osc.type = 'sawtooth';
      const f = this.ctx!.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(100, t + 0.2);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.linearRampToValueAtTime(0, t + 0.2);
      
      osc.connect(f).connect(g).connect(this.musicBus!);
      osc.frequency.value = freq;
      osc.start(t); osc.stop(t + 0.2);
  }

  playSynthArp(t: number, freq: number) {
      const osc = this.ctx!.createOscillator();
      osc.type = 'square';
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
      
      // Simple Stereo spread
      const p = this.ctx!.createPanner();
      p.positionX.value = Math.random() * 10 - 5;
      
      osc.connect(g).connect(p).connect(this.musicBus!);
      osc.frequency.value = freq;
      osc.start(t); osc.stop(t + 0.15);
  }
}

export const audio = new AudioService();
