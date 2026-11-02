/**
 * 카메라 모션 방식 (F-301). `docs/05-signal-processing.md` 5-1절.
 *
 * 객석을 향한 카메라 영상에서 움직임의 양만 측정합니다.
 *
 * **원본 프레임은 저장하지도 전송하지도 않습니다.** 64×36 격자로 줄인 즉시
 * 버리고, 남는 것은 칸별 변화량 하나뿐입니다. 개인 식별과 얼굴 인식은 하지
 * 않습니다. 이 파일에는 네트워크 호출이 없습니다.
 */
import { clamp } from '@/lib/util';
import { AudienceCalibrator, SAMPLE_HZ } from '@/lib/audience/calibration';
import {
  FIELD_H,
  FIELD_SIZE,
  FIELD_W,
  type ManagedAudienceSource,
} from '@/lib/audience/types';

/** 센서 잡음 바닥값. 이 아래는 카메라 잡음으로 보고 버립니다. */
const NOISE_FLOOR = 0.012;
/** 칸 단위 평활. */
const FIELD_SMOOTH = 0.3;


/** 휘도 변환 계수. */
const R_W = 0.299;
const G_W = 0.587;
const B_W = 0.114;

export class CameraSource implements ManagedAudienceSource {
  readonly kind = 'camera' as const;

  private cal = new AudienceCalibrator();
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  /** 이전 프레임의 칸별 휘도. 변화량을 구하는 데만 씁니다. */
  private prev = new Float32Array(FIELD_SIZE);
  /** 이번 프레임의 칸별 휘도. 30Hz 로 도는 자리라 매번 새로 만들지 않습니다. */
  private cur = new Float32Array(FIELD_SIZE);
  private hasPrev = false;
  private prevMean = 0;
  /** 평활된 칸별 변화량. 미리보기와 관객 씬이 읽습니다. */
  readonly field = new Float32Array(FIELD_SIZE);

  private acc = 0;

  async start(): Promise<void> {
    // 해상도를 크게 받을 이유가 없습니다. 어차피 64×36 으로 줄입니다.
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 180 } },
      audio: false,
    });

    const video = document.createElement('video');
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.video = video;

    const canvas = document.createElement('canvas');
    canvas.width = FIELD_W;
    canvas.height = FIELD_H;
    this.canvas = canvas;
    // 매 프레임 픽셀을 읽으므로 읽기 최적화를 켭니다.
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });

    this.cal.reset();
    this.field.fill(0);
    this.prev.fill(0);
    this.hasPrev = false;
    this.acc = 0;
  }

  stop(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.field.fill(0);
    this.prev.fill(0);
    this.hasPrev = false;
    this.cal.reset();
  }

  /** 스트림은 그대로 두고 이력만 비웁니다. 권한을 다시 묻지 않습니다. */
  recalibrate(): void {
    this.cal.reset();
    this.field.fill(0);
    this.prev.fill(0);
    this.hasPrev = false;
    this.acc = 0;
  }

  read(dt: number): number {
    this.acc += dt;
    if (this.acc >= 1 / SAMPLE_HZ) {
      this.acc = 0;
      const raw = this.measure();
      if (raw !== null) this.cal.push(raw);
    }
    return this.cal.advance(dt);
  }

  get calibration(): number {
    return this.cal.progress;
  }

  /**
   * 한 번의 측정. 격자로 줄이고 변화량만 남깁니다.
   * @returns 칸별 변화량의 평균. 아직 잴 수 없으면 null.
   */
  private measure(): number | null {
    const { video, ctx, canvas } = this;
    if (!video || !ctx || !canvas || video.readyState < 2) return null;

    // 축소. 원본 해상도는 여기서 끝나고 아래로 내려가지 않습니다.
    // 좌우는 뒤집지 않습니다. 객석을 향해 건 카메라를 오퍼레이터가 같은
    // 방향에서 보므로, 화면의 왼쪽이 객석의 왼쪽이어야 합니다.
    ctx.drawImage(video, 0, 0, FIELD_W, FIELD_H);
    const data = ctx.getImageData(0, 0, FIELD_W, FIELD_H).data;

    // 1) 휘도 변환과 평균
    const cur = this.cur;
    let mean = 0;
    for (let i = 0; i < FIELD_SIZE; i += 1) {
      const p = i * 4;
      const l = data[p] * R_W + data[p + 1] * G_W + data[p + 2] * B_W;
      cur[i] = l;
      mean += l;
    }
    mean /= FIELD_SIZE;

    if (!this.hasPrev) {
      this.prev.set(cur);
      this.prevMean = mean;
      this.hasPrev = true;
      return null;
    }

    // 2) 전역 밝기 변화 제거. 조명이 바뀌면 화면 전체가 변하는데, 그것을
    //    관객의 움직임으로 오인하면 안 됩니다.
    const shift = mean - this.prevMean;

    let sum = 0;
    for (let i = 0; i < FIELD_SIZE; i += 1) {
      const d = Math.abs(cur[i] - this.prev[i] - shift) / 255;
      const v = d > NOISE_FLOOR ? d : 0;
      this.field[i] += (v - this.field[i]) * FIELD_SMOOTH;
      sum += v;
    }

    this.prev.set(cur);
    this.prevMean = mean;

    return clamp(sum / FIELD_SIZE, 0, 1);
  }
}
