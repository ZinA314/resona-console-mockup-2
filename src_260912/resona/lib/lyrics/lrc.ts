/**
 * LRC 파싱과 내보내기 (F-601, F-605). `docs/02-features.md` F-600.
 *
 * `[mm:ss.xx] 가사` 형식입니다. 실제로 도는 파일에는 표준 밖의 것이 섞여
 * 있으므로 다음까지 받아들입니다.
 *
 * - `[mm:ss]` `[mm:ss.x]` `[mm:ss.xx]` `[mm:ss.xxx]` — 소수 자릿수가 제각각입니다
 * - `[00:12.00][00:45.30] 후렴` — 한 줄에 시각 여러 개. 반복되는 후렴을 이렇게 씁니다
 * - `[ti:] [ar:] [al:] [by:]` 같은 메타 태그 — 가사로 내보내지 않습니다
 * - `[offset:-250]` — 밀리초. 전체를 미는 값이라 파싱할 때 반영합니다
 *
 * **시각이 없는 줄도 큐에 넣습니다** (`t: null`). 버리면 `길이에 균등 배분`
 * 이 나눌 대상이 파싱 직후에 사라져 두 기능이 서로를 무효로 만듭니다.
 * 재생과 내보내기에서만 건너뜁니다.
 */
import type { LyricLine } from '@/lib/types';

/** `[mm:ss.xx]` 한 개. 소수부는 있어도 되고 없어도 됩니다. */
const TIME_TAG = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;
/** `[offset:-250]` 처럼 값이 붙는 메타 태그. */
const META_TAG = /^\[([a-zA-Z#]+):(.*)\]$/;

/**
 * 소수부를 초로 바꿉니다. `.5` 는 0.5초, `.05` 는 0.05초, `.005` 는 5밀리초입니다.
 * 자릿수를 세지 않고 두 자리로 가정하면 `.5` 가 0.05초가 되어 반 박이 밀립니다.
 */
function fractionToSeconds(digits: string | undefined): number {
  if (!digits) return 0;
  return Number(digits) / 10 ** digits.length;
}

/** 단어 쪼개기. 공백으로만 나눕니다. */
export function splitWords(text: string): string[] {
  const trimmed = text.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

export function makeLine(t: number | null, text: string): LyricLine {
  return { t, text, words: splitWords(text) };
}

export interface ParsedLrc {
  lines: LyricLine[];
  /** `[ti:]` 로 들어온 곡 제목. 없으면 null 입니다. */
  title: string | null;
  /** `[offset:]` 밀리초. 이미 `lines` 에 반영해 두었고 표시용으로만 남깁니다. */
  offsetMs: number;
  /** 시각이 안 붙어 `t: null` 로 들어간 줄 수. 패널이 알립니다. */
  undated: number;
}

/**
 * 시각순. **시각 미정 줄은 바로 앞 줄의 자리를 물려받습니다.**
 *
 * 앞부분만 찍어 둔 가사를 정렬할 때, 미정 줄을 맨 앞이나 맨 뒤로 몰면 가사
 * 순서가 통째로 흐트러집니다. 적힌 순서가 곧 부르는 순서이므로 이웃한
 * 자리에 그대로 둡니다. 자바스크립트의 `sort` 는 안정 정렬이라 같은 키끼리는
 * 원래 순서가 지켜집니다.
 */
export function sortLines(lines: LyricLine[]): LyricLine[] {
  let carried = Number.NEGATIVE_INFINITY;
  const keyed = lines.map((line) => {
    if (line.t !== null) carried = line.t;
    return { line, key: carried };
  });
  return keyed.sort((a, b) => a.key - b.key).map((k) => k.line);
}

/**
 * LRC 원문을 큐로 만듭니다. 비어 있지 않은 모든 줄이 큐가 됩니다.
 */
export function parseLrc(source: string): ParsedLrc {
  const lines: LyricLine[] = [];
  let title: string | null = null;
  let offsetMs = 0;
  let undated = 0;

  for (const raw of source.split(/\r?\n/)) {
    const row = raw.trim();
    if (row.length === 0) continue;

    // 메타 태그만 있는 줄. 시간 태그와 생김새가 같아 먼저 걸러 냅니다.
    const meta = META_TAG.exec(row);
    if (meta) {
      const key = meta[1].toLowerCase();
      if (key === 'ti') title = meta[2].trim() || null;
      else if (key === 'offset') offsetMs = Number(meta[2].trim()) || 0;
      continue;
    }

    TIME_TAG.lastIndex = 0;
    const times: number[] = [];
    let end = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(row)) !== null) {
      // 앞머리에 붙은 태그만 시각으로 봅니다. 가사 한가운데의 `[...]` 는 글자입니다.
      if (m.index !== end) break;
      end = m.index + m[0].length;
      times.push(Number(m[1]) * 60 + Number(m[2]) + fractionToSeconds(m[3]));
    }

    const text = row.slice(end).trim();
    if (times.length === 0) {
      // 시각 없는 줄. 글자가 있으면 미정으로 남깁니다.
      if (text.length === 0) continue;
      lines.push(makeLine(null, text));
      undated += 1;
      continue;
    }
    for (const t of times) lines.push(makeLine(t, text));
  }

  // LRC 의 offset 은 "가사를 이만큼 앞당긴다" 는 뜻이라 부호가 반대입니다.
  const shift = -offsetMs / 1000;
  if (shift !== 0) {
    for (const line of lines) {
      if (line.t !== null) line.t = Math.max(0, line.t + shift);
    }
  }

  return { lines: sortLines(lines), title, offsetMs, undated };
}

/**
 * LRC 가 담을 수 있는 최소 단위는 1/100초입니다.
 *
 * 탭으로 찍은 시각은 그보다 잘게 나옵니다. 그대로 들고 있으면 화면에 보이는
 * 값과 내보낸 값이 어긋나고, 내보냈다 다시 읽으면 줄마다 1/100초씩 움직인
 * 것처럼 보입니다. 만들 때 맞춰 두면 왕복이 정확히 맞습니다.
 */
export function quantize(sec: number): number {
  return Math.round(Math.max(0, sec) * 100) / 100;
}

/**
 * 시각 미정 줄에만 시각을 채웁니다 (F-603).
 *
 * **이미 시각이 있는 줄은 건드리지 않습니다.** 그래서 버튼 하나로 두 경우가
 * 다 풀립니다 — 처음부터 만들 때는 모든 줄이 미정이라 전부 배분되고, 앞부분만
 * 찍어 둔 상태에서는 빈자리만 채웁니다.
 *
 * 미정 줄이 이어지는 구간마다 앞뒤의 확정된 줄을 기둥으로 삼아 그 사이를
 * 고르게 나눕니다. 앞에 기둥이 없으면 0 초, 뒤에 없으면 곡 끝을 씁니다.
 * 맨 앞 구간만 0 초를 포함합니다 — 전부 미정일 때 첫 줄이 0 초에서 시작하도록.
 *
 * @param duration 곡 길이(초). 0 이면 나눌 수 없으므로 그대로 돌려줍니다.
 */
export function distributeEvenly(
  lines: LyricLine[],
  duration: number,
): LyricLine[] {
  if (lines.length === 0 || duration <= 0) return lines;
  const out = lines.map((l) => ({ ...l }));

  let i = 0;
  while (i < out.length) {
    if (out[i].t !== null) {
      i += 1;
      continue;
    }
    // 미정 줄이 이어지는 구간 [i, j)
    let j = i;
    while (j < out.length && out[j].t === null) j += 1;

    const before = i > 0 ? out[i - 1].t : null;
    const after = j < out.length ? out[j].t : null;
    const lo = before ?? 0;
    const hi = after ?? duration;
    const k = j - i;
    // 뒤집힌 구간이라도 줄이 겹치지 않게 최소 간격을 둡니다.
    const span = Math.max(hi - lo, 0.01 * (k + 1));

    for (let n = 0; n < k; n += 1) {
      // 앞에 기둥이 없으면 첫 줄이 0 초입니다. 있으면 그 줄과 겹치지 않게 뒤로 뗍니다.
      const ratio = before === null ? n / Math.max(1, k) : (n + 1) / (k + 1);
      out[i + n].t = quantize(lo + span * ratio);
    }
    i = j;
  }
  return sortLines(out);
}

/**
 * `mm:ss.cc`. 편집기의 시각 칸과 내보내기가 **같은 함수를 씁니다.**
 *
 * `formatTime`(`lib/util.ts`)은 남은 자리를 버립니다. 흐르는 시계에는 그것이
 * 맞지만 — 아직 닿지 않은 시각을 먼저 띄우면 안 되므로 — 타임스탬프에는
 * 맞지 않습니다. 화면에 `03.10` 이라고 적어 두고 파일에는 `03.11` 로
 * 나가면, 다시 읽었을 때 값이 바뀐 것처럼 보입니다.
 *
 * 1/100초로 먼저 반올림한 뒤 자릿수를 나눕니다. 초와 소수를 따로 다루면
 * `3.999` 초가 `00:03.00` 으로 나갑니다 — 올림이 초로 넘어가지 못합니다.
 */
export function formatStamp(sec: number): string {
  const total = Math.round(Math.max(0, sec) * 100);
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** 시각 미정 줄의 시각 칸. 줄 목록이 흐리게 둡니다. */
export const NO_STAMP = '--:--.--';

/** `[mm:ss.xx]` 한 개. 내보내기(F-605)가 씁니다. */
export function formatTimeTag(sec: number): string {
  return `[${formatStamp(sec)}]`;
}

/**
 * 큐를 다시 LRC 원문으로. 내보낸 파일을 다시 올리면 같은 큐가 됩니다 (F-605).
 *
 * **시각 미정 줄은 빼고 내보냅니다.** LRC 는 시각이 있는 줄만 담는 형식이라
 * 미정 줄을 시각 없이 적으면 다른 도구가 읽지 못합니다. 몇 줄을 뺐는지는
 * 편집기가 `countUndated` 로 세어 알립니다.
 *
 * **`[offset:]` 을 쓰지 않습니다.** 편집기의 전체 오프셋은 타임스탬프 자체를
 * 밀어 둔 것이라 이미 각 줄에 반영돼 있습니다. 여기서 태그로 한 번 더 적으면
 * 다시 읽을 때 두 번 밀립니다. 부호까지 반대라(F-601) 두 배가 아니라
 * 엉뚱한 자리로 갑니다.
 */
export function toLrc(lines: LyricLine[]): string {
  return lines
    .filter((l) => l.t !== null)
    .map((l) => `${formatTimeTag(l.t as number)}${l.text}`)
    .join('\n');
}

/**
 * 큐를 편집기의 원문 영역에 실을 글로 바꿉니다.
 *
 * 내보내기와 다릅니다 — **시각 미정 줄을 시각 없이 그대로 남깁니다.** 원문
 * 영역은 지금 큐를 그대로 비추는 자리이고, 미정 줄이 사라지면 화면에 보이는
 * 글과 실제 큐가 어긋납니다. 이 글을 다시 `파싱` 하면 같은 큐가 됩니다.
 */
export function toDraft(lines: LyricLine[]): string {
  return lines
    .map((l) => (l.t === null ? l.text : `${formatTimeTag(l.t)}${l.text}`))
    .join('\n');
}

export function countUndated(lines: LyricLine[]): number {
  return lines.reduce((n, l) => (l.t === null ? n + 1 : n), 0);
}
