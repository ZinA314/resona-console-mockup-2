/**
 * 무대 씬 (BLOOM). `docs/03-screens.md` 무대 씬 절 (F-507).
 *
 * **공연 본편에 거는 화면입니다.** 직조가 "무엇이 일어났는지" 를 기록한다면
 * 이쪽은 "지금 무엇이 일어나는지" 를 느끼게 합니다. 숫자·눈금·라벨·테두리를
 * 하나도 그리지 않습니다. 관객이 보는 화면에 진단 정보가 섞이면 그 순간
 * 무대가 아니라 계기판이 됩니다.
 *
 *   층 1  배경 유체   전체 화면 사각형 + 도메인 워핑 노이즈
 *   층 2  입자        gl.POINTS, 위치를 정점 셰이더에서 계산
 *   층 3  블룸        밝은 부분 추출 → 1/4 해상도 블러 두 번 → 가산 합성
 *
 * 자기 캔버스에 WebGL2 로 그린 뒤 2D 캔버스로 옮겨 붙입니다. 그래야 나머지
 * 다섯 씬과 공통 효과(그레인·교란·비트 테두리)를 그대로 쓸 수 있습니다.
 */
import {
  BLUR_FRAG,
  BRIGHT_FRAG,
  COPY_FRAG,
  FADE_FRAG,
  FLUID_FRAG,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  QUAD_VERT,
} from '@/components/stage/scenes/bloom/shaders';
import {
  createProgram,
  createTarget,
  deleteTarget,
  hexToRgb,
  type Program,
  type Target,
} from '@/components/stage/scenes/bloom/gl';
import { DEFAULT_SCENE_PARAMS } from '@/lib/types';
import { clamp } from '@/lib/util';
import type { Scene, SceneFrame } from '@/lib/render/types';

/** 비트가 올 때 1 로 두고 이 시간에 걸쳐 사그라집니다. */
const BEAT_TAU = 0.45;
/** 블룸을 1/4 해상도에서 합니다. 원본 해상도로 블러하면 프레임이 절반입니다. */
const BLOOM_DIV = 4;
/** 대기 화면의 입자 수. 검은 화면을 띄우지 않습니다. */
const IDLE_PARTICLES = 300;

export class BloomScene implements Scene {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private fluid: Program | null = null;
  private particle: Program | null = null;
  private bright: Program | null = null;
  private blur: Program | null = null;
  private copy: Program | null = null;
  private fade: Program | null = null;

  /**
   * 입자만 프레임을 건너 쌓입니다. 배경 유체는 매 프레임 새로 그립니다.
   * 유체까지 누적하면 흐름이 뭉개지고 화면이 하얗게 날아갑니다.
   */
  private trailBuf: Target | null = null;
  private scene: Target | null = null;
  private half: Target | null = null;
  private halfB: Target | null = null;

  private w = 0;
  private h = 0;
  private beatPulse = 0;
  private lastBeat = -1;
  private lost = false;
  private failed: string | null = null;

  private rgb = {
    bg: new Float32Array(3),
    deep: new Float32Array(3),
    base: new Float32Array(3),
    accent: new Float32Array(3),
    hot: new Float32Array(3),
  };

  /** 컨텍스트를 못 얻었거나 잃었을 때의 사유. 화면에 안내를 띄웁니다. */
  get error(): string | null {
    return this.lost ? '그래픽 컨텍스트를 잃었습니다. 복구하는 중입니다.' : this.failed;
  }

  reset(): void {
    this.beatPulse = 0;
    this.lastBeat = -1;
    // 잔상 버퍼를 비웁니다. 앞 씬의 잔상이 남으면 안 됩니다.
    const gl = this.gl;
    if (gl && this.trailBuf) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailBuf.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  draw(f: SceneFrame): void {
    if (!this.ensure(f)) {
      this.drawFallback(f);
      return;
    }
    const gl = this.gl!;
    const { input, dt } = f;
    const p = input.sceneParams.bloom;
    const a = input.analysis;
    const params = input.params;

    // 비트마다 1 로 올리고 0.45초에 걸쳐 내립니다.
    // **"비트마다 확산" 은 이 세 줄이 전부입니다.**
    if (a.beat !== this.lastBeat) {
      this.lastBeat = a.beat;
      this.beatPulse = 1;
    } else {
      this.beatPulse *= Math.exp(-dt / BEAT_TAU);
    }

    const dream = clamp(params.dreaminess, 0, 1);
    const intensity = input.settings.intensity;
    const roles = input.roles;
    hexToRgb(roles.bg, this.rgb.bg);
    hexToRgb(roles.deep, this.rgb.deep);
    hexToRgb(roles.base, this.rgb.base);
    hexToRgb(roles.accent, this.rgb.accent);
    hexToRgb(roles.hot, this.rgb.hot);

    // 음원이 없으면 대기 화면입니다. 입자를 줄이고 거의 멈춘 상태로 둡니다.
    const idle = a.rms <= 0.001 && a.beat === 0;
    const count = idle
      ? IDLE_PARTICLES
      : Math.min(
          Math.round(1200 + params.density * 4800),
          Math.round(p.maxParticles),
        );
    const speed = idle ? 0.05 : params.speed;

    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);

    // ── 입자 버퍼를 잔상만큼 깎습니다 ──
    // 입자가 지나간 자리가 지수적으로 사그라져 꼬리를 남깁니다. 배경은
    // 건드리지 않으므로 흐름이 뭉개지지 않습니다.
    const trail = clamp(input.settings.trail, 0, 0.95);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailBuf!.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.fade!.program);
    gl.uniform1f(this.fade!.u.uKeep, trail);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── 층 2. 가산 블렌딩이라 겹치는 자리가 저절로 밝아집니다 ──
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.particle!.program);
    const pu = this.particle!.u;
    gl.uniform1f(pu.uTime, f.time);
    gl.uniform1f(pu.uSpeed, speed);
    gl.uniform1f(pu.uExpansion, params.expansion);
    gl.uniform1f(pu.uScale, params.scale);
    gl.uniform1f(pu.uDreaminess, dream);
    gl.uniform1f(pu.uBeatPulse, this.beatPulse);
    gl.uniform1f(pu.uDpr, f.dpr);
    gl.uniform1f(pu.uAspect, this.w / Math.max(this.h, 1));
    gl.uniform3fv(pu.uBase, this.rgb.base);
    gl.uniform3fv(pu.uAccent, this.rgb.accent);
    gl.uniform3fv(pu.uHot, this.rgb.hot);
    gl.drawArrays(gl.POINTS, 0, count);

    // ── 층 1. 배경 유체는 매 프레임 불투명하게 ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene!.fbo);
    gl.disable(gl.BLEND);
    gl.useProgram(this.fluid!.program);
    const fu = this.fluid!.u;
    gl.uniform2f(fu.uRes, this.w, this.h);
    gl.uniform1f(
      fu.uTime,
      // 격렬할수록 빠르게 흐릅니다.
      f.time * (0.06 + speed * 0.10 + (1 - dream) * 0.18),
    );
    // 몽환적일수록 크게 휘어집니다.
    gl.uniform1f(fu.uWarp, (1.2 + dream * 2.6) * p.warpScale);
    gl.uniform1f(fu.uBrightness, params.brightness * intensity);
    gl.uniform3fv(fu.uBg, this.rgb.bg);
    gl.uniform3fv(fu.uDeep, this.rgb.deep);
    gl.uniform3fv(fu.uBase, this.rgb.base);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 입자 버퍼를 그 위에 가산합니다.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.copy!.program);
    gl.uniform2f(this.copy!.u.uRes, this.w, this.h);
    gl.uniform1i(this.copy!.u.uTex, 0);
    gl.uniform1f(this.copy!.u.uAmount, intensity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailBuf!.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── 층 3-1. 밝은 부분만 1/4 해상도로 ──
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.half!.fbo);
    gl.viewport(0, 0, this.half!.w, this.half!.h);
    gl.useProgram(this.bright!.program);
    gl.uniform2f(this.bright!.u.uRes, this.half!.w, this.half!.h);
    gl.bindTexture(gl.TEXTURE_2D, this.scene!.tex);
    gl.uniform1i(this.bright!.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── 층 3-2. 가로 9탭 → 세로 9탭 ──
    const radius = ((4 + dream * 10) * p.bloomRadius) / BLOOM_DIV;
    gl.useProgram(this.blur!.program);
    gl.uniform2f(this.blur!.u.uRes, this.half!.w, this.half!.h);
    gl.uniform1i(this.blur!.u.uTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.halfB!.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.half!.tex);
    gl.uniform2f(this.blur!.u.uDir, radius, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.half!.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.halfB!.tex);
    gl.uniform2f(this.blur!.u.uDir, 0, radius);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── 층 3-3. 원본을 옮기고 블룸을 가산합니다 ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.copy!.program);
    gl.uniform2f(this.copy!.u.uRes, this.w, this.h);
    gl.uniform1i(this.copy!.u.uTex, 0);
    gl.uniform1f(this.copy!.u.uAmount, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.scene!.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(
      this.copy!.u.uAmount,
      (0.35 + dream * 0.45 + this.beatPulse * 0.25) * p.bloomStrength,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.half!.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    // 2D 캔버스로 옮겨 붙입니다. 공통 효과는 그 위에 얹힙니다.
    f.ctx.drawImage(this.canvas!, 0, 0, f.w, f.h);
  }

  /** 컨텍스트를 못 쓰면 검은 화면 대신 팔레트 색을 옅게 깔아 둡니다. */
  private drawFallback(f: SceneFrame): void {
    const { ctx, w, h } = f;
    ctx.fillStyle = f.input.roles.bg;
    ctx.fillRect(0, 0, w, h);
  }

  private ensure(f: SceneFrame): boolean {
    if (this.failed) return false;
    const w = Math.max(1, Math.round(f.w * f.dpr));
    const h = Math.max(1, Math.round(f.h * f.dpr));

    if (!this.gl) {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', {
          alpha: false,
          antialias: false,
          depth: false,
          // 잔상을 쓰므로 프레임 사이에 색 버퍼가 남아 있어야 합니다.
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance',
        });
        if (!gl) {
          this.failed = '이 브라우저는 WebGL2 를 지원하지 않습니다.';
          return false;
        }
        // 공연 중에 화면이 죽으면 안 됩니다. 잃으면 다음 프레임에 다시 만듭니다.
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          this.lost = true;
          this.gl = null;
          this.trailBuf = this.scene = this.half = this.halfB = null;
          this.w = this.h = 0;
        });
        canvas.addEventListener('webglcontextrestored', () => {
          this.lost = false;
        });
        this.canvas = canvas;
        this.gl = gl;
        this.vao = gl.createVertexArray();
        this.fluid = createProgram(gl, QUAD_VERT, FLUID_FRAG, [
          'uRes', 'uTime', 'uWarp', 'uBrightness', 'uBg', 'uDeep', 'uBase',
        ]);
        this.fade = createProgram(gl, QUAD_VERT, FADE_FRAG, ['uKeep']);
        this.particle = createProgram(gl, PARTICLE_VERT, PARTICLE_FRAG, [
          'uTime', 'uSpeed', 'uExpansion', 'uScale', 'uDreaminess', 'uBeatPulse',
          'uDpr', 'uAspect', 'uBase', 'uAccent', 'uHot',
        ]);
        this.bright = createProgram(gl, QUAD_VERT, BRIGHT_FRAG, ['uTex', 'uRes']);
        this.blur = createProgram(gl, QUAD_VERT, BLUR_FRAG, ['uTex', 'uRes', 'uDir']);
        this.copy = createProgram(gl, QUAD_VERT, COPY_FRAG, ['uTex', 'uRes', 'uAmount']);
        this.lost = false;
      } catch (err) {
        this.failed = err instanceof Error ? err.message : '그래픽 초기화에 실패했습니다.';
        console.error('[bloom] 초기화 실패', err);
        return false;
      }
    }

    const gl = this.gl;
    if (!gl || !this.canvas) return false;
    if (this.w !== w || this.h !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.w = w;
      this.h = h;
      deleteTarget(gl, this.trailBuf);
      deleteTarget(gl, this.scene);
      deleteTarget(gl, this.half);
      deleteTarget(gl, this.halfB);
      const hw = Math.max(1, Math.floor(w / BLOOM_DIV));
      const hh = Math.max(1, Math.floor(h / BLOOM_DIV));
      this.trailBuf = createTarget(gl, w, h);
      this.scene = createTarget(gl, w, h);
      this.half = createTarget(gl, hw, hh);
      this.halfB = createTarget(gl, hw, hh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailBuf.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return true;
  }
}

/** 07 패널이 없을 때 쓰는 기본값. */
export const BLOOM_DEFAULTS = DEFAULT_SCENE_PARAMS.bloom;
