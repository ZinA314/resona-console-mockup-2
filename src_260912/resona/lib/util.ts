/** 여러 곳에서 쓰는 작은 계산기들. */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mapRange(
  v: number,
  inLo: number,
  inHi: number,
  outLo: number,
  outHi: number,
): number {
  const t = clamp((v - inLo) / (inHi - inLo || 1e-9), 0, 1);
  return outLo + (outHi - outLo) * t;
}

/** `MM:SS.CS`. 트랜스포트와 가사 큐가 같은 형식을 씁니다. */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** 0.00 ~ 1.00 형식. 리드아웃의 기본 표기입니다. */
export function formatUnit(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : '0.00';
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
