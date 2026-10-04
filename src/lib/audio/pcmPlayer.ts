/**
 * Robust cross-browser PCM & WAV audio player using Web Audio API and HTML5
 * Audio fallback. The player accepts streamed PCM and complete server TTS WAVs.
 */

export class PcmStreamPlayer {
  private audioContext: AudioContext | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private onStateChange?: (isPlaying: boolean) => void;
  private checkEndTimeout: NodeJS.Timeout | null = null;
  private collectedChunks: string[] = [];
  private currentAudioFallback: HTMLAudioElement | null = null;
  private playedAnyPcm = false;

  constructor(onStateChange?: (isPlaying: boolean) => void) {
    this.onStateChange = onStateChange;
  }

  /**
   * Initializes or resumes the AudioContext on user interaction.
   * Note: NEVER force sampleRate in AudioContext constructor as WebKit/Safari throws NotSupportedError.
   */
  public async ensureContext(): Promise<AudioContext | null> {
    try {
      if (!this.audioContext || this.audioContext.state === 'closed') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      return this.audioContext;
    } catch (err) {
      console.warn('AudioContext initialization failed, using HTML5 fallback:', err);
      return null;
    }
  }

  /**
   * Resets playback state for a new turn.
   */
  public reset(): void {
    this.stop();
    this.collectedChunks = [];
    this.playedAnyPcm = false;
    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    } else {
      this.nextStartTime = 0;
    }
  }

  /**
   * Feeds a base64-encoded 16-bit PCM chunk into the streaming queue.
   */
  public async feed(base64Chunk: string): Promise<void> {
    if (!base64Chunk) return;
    this.collectedChunks.push(base64Chunk);

    try {
      const ctx = await this.ensureContext();
      if (!ctx) return;

      // Decode base64 to binary
      const binary = atob(base64Chunk);
      // Ensure even byte length for 16-bit PCM
      const usableLength = binary.length - (binary.length % 2);
      if (usableLength <= 0) return;

      const bytes = new Uint8Array(usableLength);
      for (let i = 0; i < usableLength; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Convert little-endian 16-bit signed PCM to Float32 [-1.0, 1.0]
      const numSamples = usableLength / 2;
      const float32 = new Float32Array(numSamples);
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, usableLength);

      for (let i = 0; i < numSamples; i++) {
        const sample = dataView.getInt16(i * 2, true);
        float32[i] = sample / 32768.0;
      }

      // Raw PCM input is 24kHz; complete Groq WAVs use the fallback player.
      // AudioContext automatically resamples to device output rate (44.1kHz / 48kHz).
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startTime = Math.max(now, this.nextStartTime);
      source.start(startTime);
      this.nextStartTime = startTime + buffer.duration;
      this.playedAnyPcm = true;

      this.activeSources.push(source);

      if (this.onStateChange) {
        this.onStateChange(true);
      }

      if (this.checkEndTimeout) {
        clearTimeout(this.checkEndTimeout);
      }

      const remainingMs = Math.max(0, (this.nextStartTime - now) * 1000);
      this.checkEndTimeout = setTimeout(() => {
        this.activeSources = [];
        if (this.onStateChange) {
          this.onStateChange(false);
        }
      }, remainingMs + 100);
    } catch (err) {
      console.warn('PcmStreamPlayer feed failed:', err);
    }
  }

  /**
   * Plays a base64 WAV file directly using HTML5 Audio (rock-solid universal fallback).
   */
  public playWavFallback(base64Wav: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.stop();
        const binary = atob(base64Wav);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.currentAudioFallback = audio;

        if (this.onStateChange) {
          this.onStateChange(true);
        }

        audio.onended = () => {
          URL.revokeObjectURL(url);
          this.currentAudioFallback = null;
          if (this.onStateChange) {
            this.onStateChange(false);
          }
          resolve();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(url);
          this.currentAudioFallback = null;
          if (this.onStateChange) {
            this.onStateChange(false);
          }
          resolve();
        };

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('Autoplay prevented by browser policy:', err);
            if (this.onStateChange) {
              this.onStateChange(false);
            }
            resolve();
          });
        }
      } catch (e) {
        console.error('playWavFallback error:', e);
        if (this.onStateChange) {
          this.onStateChange(false);
        }
        resolve();
      }
    });
  }

  /**
   * Returns whether any PCM streaming chunks were successfully scheduled.
   */
  public didPlayPcm(): boolean {
    return this.playedAnyPcm;
  }

  /**
   * Immediately stops all currently playing audio.
   */
  public stop(): void {
    if (this.checkEndTimeout) {
      clearTimeout(this.checkEndTimeout);
      this.checkEndTimeout = null;
    }

    if (this.currentAudioFallback) {
      try {
        this.currentAudioFallback.pause();
        this.currentAudioFallback.currentTime = 0;
      } catch {}
      this.currentAudioFallback = null;
    }

    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources = [];

    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    }

    if (this.onStateChange) {
      this.onStateChange(false);
    }
  }

  /**
   * Replays the turn using WAV fallback or collected PCM chunks.
   */
  public async replay(audioWav?: string): Promise<void> {
    if (audioWav) {
      await this.playWavFallback(audioWav);
    } else if (this.collectedChunks.length > 0) {
      this.stop();
      const ctx = await this.ensureContext();
      if (ctx) {
        this.nextStartTime = ctx.currentTime;
        for (const chunk of this.collectedChunks) {
          await this.feed(chunk);
        }
      }
    }
  }
}
