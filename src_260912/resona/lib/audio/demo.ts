/**
 * 데모 신스 (F-103).
 *
 * 오디오 입력 없이 기능을 확인할 수 있도록 리듬 패턴을 합성합니다.
 * **값을 가짜로 넣지 않습니다.** 오실레이터와 노이즈로 실제 오디오 신호를
 * 만들어 파일 재생과 똑같은 분석 경로를 통과시킵니다.
 *
 * 120 BPM, 4/4. 한 마디를 16분음표 16칸으로 나눠 예약합니다.
 * `setInterval` 로 앞을 내다보며 예약하는 방식입니다. 화면 갱신에 맞춰
 * 소리를 내면 프레임이 흔들릴 때 박자가 같이 흔들립니다.
 */

const BPM = 120;
const STEPS_PER_BAR = 16;
/** 16분음표 하나의 길이(초). 120BPM 에서 0.125초입니다. */
const STEP = 60 / BPM / 4;

/** 예약 루프 주기와 앞서 예약해 두는 길이. */
const TICK_MS = 25;
const LOOKAHEAD = 0.15;

/** 네 박에 하나씩. 스네어는 2·4박, 하이햇은 8분음표. */
const KICK = [0, 4, 8, 12];
const SNARE = [4, 12];
const HAT = [0, 2, 4, 6, 8, 10, 12, 14];
const BASS = [0, 6, 8, 14];

/** 두 마디마다 바뀌는 근음(Hz). A1 · F1 · C2 · G1 */
const ROOTS = [55.0, 43.65, 65.41, 49.0];

export class DemoSynth {
  readonly output: GainNode;

  private ctx: AudioContext;
  private noise: AudioBuffer;
  private timer: number | null = null;
  private step = 0;
  private nextStepT = 0;
  private active = new Set<AudioScheduledSourceNode>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.9;

    // 1초짜리 백색 잡음. 스네어와 하이햇이 구간을 잘라 씁니다.
    const len = Math.floor(ctx.sampleRate);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextStepT = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    // 예약해 둔 노드를 모두 끊습니다. 남겨 두면 소리가 겹칩니다.
    for (const node of this.active) {
      try {
        node.stop();
      } catch {
        /* 아직 시작되지 않았을 수 있습니다. */
      }
      node.disconnect();
    }
    this.active.clear();
  }

  /** 앞으로 `LOOKAHEAD` 초 안에 들어올 칸을 미리 예약합니다. */
  private schedule() {
    const ctx = this.ctx;
    while (this.nextStepT < ctx.currentTime + LOOKAHEAD) {
      const t = this.nextStepT;
      const s = this.step % STEPS_PER_BAR;
      const bar = Math.floor(this.step / STEPS_PER_BAR);

      if (KICK.includes(s)) this.kick(t);
      if (SNARE.includes(s)) this.snare(t);
      if (HAT.includes(s)) this.hat(t, s % 4 === 0 ? 0.28 : 0.16);
      if (BASS.includes(s)) this.bass(t, ROOTS[Math.floor(bar / 2) % ROOTS.length]);
      // 패드는 두 마디에 한 번, 마디 첫 박에 깝니다.
      if (s === 0 && bar % 2 === 0) {
        this.pad(t, ROOTS[Math.floor(bar / 2) % ROOTS.length] * 4, STEP * 32);
      }

      this.nextStepT += STEP;
      this.step += 1;
    }
  }

  /** 예약이 끝나면 스스로 정리되게 걸어 둡니다. */
  private track(node: AudioScheduledSourceNode) {
    this.active.add(node);
    node.onended = () => {
      this.active.delete(node);
      node.disconnect();
    };
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private pan(value: number): StereoPannerNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = value;
    return p;
  }

  /** 킥 — 사인의 주파수를 빠르게 떨어뜨립니다. */
  private kick(t: number) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    const g = this.env(t, 0.95, 0.004, 0.26);
    osc.connect(g).connect(this.output);
    osc.start(t);
    osc.stop(t + 0.32);
    this.track(osc);
  }

  /** 스네어 — 잡음에 대역 통과를 걸고 짧은 몸통 음을 얹습니다. */
  private snare(t: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const g = this.env(t, 0.42, 0.002, 0.16);
    src.connect(bp).connect(g).connect(this.output);
    src.start(t, Math.random());
    src.stop(t + 0.2);
    this.track(src);

    const body = this.ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, t);
    const bg = this.env(t, 0.22, 0.002, 0.09);
    body.connect(bg).connect(this.output);
    body.start(t);
    body.stop(t + 0.12);
    this.track(body);
  }

  /** 하이햇 — 잡음에 고역 통과. 좌우로 조금 벌립니다. */
  private hat(t: number, peak: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.env(t, peak, 0.001, 0.045);
    src.connect(hp).connect(g).connect(this.pan(0.35)).connect(this.output);
    src.start(t, Math.random());
    src.stop(t + 0.08);
    this.track(src);
  }

  /** 베이스 — 톱니에 저역 통과. 중앙에 둡니다. */
  private bass(t: number, freq: number) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = this.env(t, 0.5, 0.006, 0.3);
    osc.connect(lp).connect(g).connect(this.output);
    osc.start(t);
    osc.stop(t + 0.36);
    this.track(osc);
  }

  /**
   * 패드 — 살짝 어긋난 톱니 둘을 좌우로 벌려 깝니다.
   * 좌우로 벌린 성분이 있어야 OTHER 스템과 side 신호를 확인할 수 있습니다.
   */
  private pad(t: number, freq: number, dur: number) {
    for (const [detune, side] of [
      [-7, -0.8],
      [7, 0.8],
    ]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.value = detune;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const g = this.env(t, 0.16, dur * 0.25, dur * 0.7);
      osc.connect(lp).connect(g).connect(this.pan(side)).connect(this.output);
      osc.start(t);
      osc.stop(t + dur);
      this.track(osc);
    }
  }
}
