/**
 * WebGL2 뼈대. 셰이더 컴파일과 오프스크린 렌더 타깃만 다룹니다.
 *
 * 라이브러리를 쓰지 않습니다. 필요한 것이 전체 화면 사각형 하나와 점 그리기
 * 뿐이라, Three.js 를 얹으면 번들만 커지고 얻는 것이 없습니다.
 */

export interface Program {
  program: WebGLProgram;
  /** 유니폼 위치를 이름으로 찾아 둡니다. 매 프레임 조회하면 느립니다. */
  u: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('셰이더를 만들지 못했습니다');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new Error(`셰이더 컴파일 실패: ${log}`);
  }
  return sh;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vert: string,
  frag: string,
  uniforms: readonly string[],
): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  const program = gl.createProgram();
  if (!program) throw new Error('프로그램을 만들지 못했습니다');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`프로그램 링크 실패: ${log}`);
  }
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(program, name);
  return { program, u };
}

/** 색 첨부 하나짜리 오프스크린 버퍼. */
export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('렌더 타깃을 만들지 못했습니다');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  // 블룸은 1/4 해상도에서 키워 쓰므로 선형 보간이어야 계단이 보이지 않습니다.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/** `#rrggbb` 를 셰이더에 넘길 선형 0~1 로. 팔레트는 hex 로 옵니다. */
export function hexToRgb(hex: string, out: Float32Array): Float32Array {
  const h = hex.replace('#', '');
  const n =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  for (let i = 0; i < 3; i += 1) {
    const v = Number.parseInt(n.slice(i * 2, i * 2 + 2), 16);
    out[i] = Number.isFinite(v) ? v / 255 : 0;
  }
  return out;
}

/**
 * 이 브라우저가 WebGL2 를 쓸 수 있는가. 06 패널이 버튼을 막는 데 씁니다.
 * 판정에 캔버스를 하나 만들어야 하므로 한 번만 재고 기억해 둡니다.
 */
let gl2Cache: boolean | null = null;

export function webgl2Supported(): boolean {
  if (typeof document === 'undefined') return false;
  if (gl2Cache !== null) return gl2Cache;
  try {
    const c = document.createElement('canvas');
    gl2Cache = c.getContext('webgl2') !== null;
  } catch {
    gl2Cache = false;
  }
  return gl2Cache;
}
