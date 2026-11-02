/**
 * 가사 큐 (F-602). 지금 어느 줄의 어디를 부르고 있는지 산출합니다.
 *
 * **시각 미정 줄(`t === null`)은 건너뜁니다.** 큐에는 남아 있지만 재생에는
 * 쓰이지 않습니다. 미정 줄에서 멈추거나 화면이 비면 안 됩니다.
 *
 * 매 프레임 도는 자리이므로 **직전 줄 번호를 기억해 두고 거기서부터
 * 움직입니다.** 보통은 한 줄도 안 넘어가거나 한 줄만 넘어갑니다. 탐색(seek)으로
 * 크게 뛰어도 while 이 한 번 훑고 제자리를 찾습니다.
 *
 * 큐 객체는 갱신해서 돌려줍니다. 초당 수십 번 새 객체를 만들면 쓰레기 수집이
 * 프레임을 먹습니다.
 */
import type { LyricCue, LyricLine } from '@/lib/types';

/**
 * 단어를 밝히는 데 쓰는 최대 구간(초).
 *
 * 줄 사이가 벌어지는 곳이 있습니다. 간주가 길거나, 마지막 줄 뒤로 아웃트로가
 * 남는 경우입니다. 그 간격을 그대로 쓰면 마지막 단어가 30초 뒤에야 밝아집니다.
 * 여기서 잘라 단어를 다 밝힌 뒤 줄 전체가 켜진 채로 기다리게 합니다.
 * 진행 막대는 이 상한을 쓰지 않습니다 — 그쪽은 "다음 줄이 언제 오는가" 라서
 * 실제 간격을 보여 주어야 합니다.
 */
const WORD_WINDOW_MAX = 8;
/** 시각이 겹치는 줄이 있어도 0 으로 나누지 않게 하는 하한(초). */
const SPAN_MIN = 0.35;
/** 마지막 줄에 곡 길이가 없을 때 가정하는 길이(초). */
const TAIL_SPAN = 4;

function emptyCue(): LyricCue {
  return { index: -1, ordinal: 0, total: 0, line: null, next: null, progress: 0, word: -1 };
}

/**
 * 진행률 → 단어 번호. **글자 수로 가중합니다.**
 *
 * 균등하게 나누면 `난` 과 `사랑했었던` 이 같은 시간을 갖습니다. 한국어 가사는
 * 어절 길이가 크게 차이 나서, 균등 배분은 짧은 어절에서 앞서고 긴 어절에서
 * 뒤처지는 것이 눈에 보입니다. 명세에 정해진 바가 없어 이렇게 두었습니다.
 */
function wordAt(words: string[], progress: number): number {
  const n = words.length;
  if (n === 0) return -1;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += words[i].length + 1;
  const target = progress * total;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    acc += words[i].length + 1;
    if (target < acc) return i;
  }
  return n - 1;
}

export class LyricsCursor {
  private lines: LyricLine[] = [];
  /**
   * 시각이 붙은 줄의 원래 번호만 모아 둡니다.
   *
   * 미정 줄을 건너뛰려고 매 프레임 `filter` 를 돌리면 초당 예순 번 배열이
   * 새로 생깁니다. 큐가 바뀔 때만 한 번 세웁니다.
   */
  private dated: number[] = [];
  /** `dated` 안에서의 자리. `cue.index` 는 원래 배열의 번호입니다. */
  private at = -1;
  /** 매 프레임 갱신해서 돌려주는 한 벌. */
  readonly cue: LyricCue = emptyCue();

  private rebuild(lines: LyricLine[]) {
    this.lines = lines;
    this.dated = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].t !== null) this.dated.push(i);
    }
    this.at = -1;
  }

  /**
   * @param lines 큐. 배열이 통째로 바뀌면 커서를 처음부터 다시 잡습니다.
   * @param time 곡 안의 위치(초). `AudioContext.currentTime` 이 아닙니다.
   * @param duration 곡 길이(초). 마지막 줄의 길이를 정하는 데만 씁니다.
   */
  update(lines: LyricLine[], time: number, duration: number): LyricCue {
    const cue = this.cue;
    if (lines !== this.lines) this.rebuild(lines);

    const dated = this.dated;
    const n = dated.length;
    cue.total = n;
    if (n === 0) {
      cue.index = -1;
      cue.ordinal = 0;
      cue.line = null;
      cue.next = null;
      cue.progress = 0;
      cue.word = -1;
      return cue;
    }

    const tAt = (k: number) => lines[dated[k]].t as number;

    // 직전 자리에서 앞뒤로 움직입니다. 탐색으로 뛰었으면 여기서 따라잡습니다.
    let at = this.at;
    if (at >= n) at = n - 1;
    while (at + 1 < n && tAt(at + 1) <= time) at += 1;
    while (at >= 0 && tAt(at) > time) at -= 1;
    this.at = at;

    const nextAt = at + 1 < n ? at + 1 : -1;
    cue.index = at >= 0 ? dated[at] : -1;
    cue.ordinal = at + 1;
    cue.line = at >= 0 ? lines[dated[at]] : null;
    cue.next = nextAt >= 0 ? lines[dated[nextAt]] : null;

    if (at < 0) {
      // 첫 줄이 시작하기 전. 다음 줄만 보여 줍니다.
      cue.progress = 0;
      cue.word = -1;
      return cue;
    }

    const line = lines[dated[at]];
    const start = tAt(at);
    const end = nextAt >= 0 ? tAt(nextAt) : Math.max(start + TAIL_SPAN, duration);
    const span = Math.max(SPAN_MIN, end - start);
    const elapsed = time - start;

    cue.progress = elapsed <= 0 ? 0 : elapsed >= span ? 1 : elapsed / span;
    const windowed = Math.min(span, WORD_WINDOW_MAX);
    const wp = elapsed <= 0 ? 0 : elapsed >= windowed ? 1 : elapsed / windowed;
    cue.word = wordAt(line.words, wp);
    return cue;
  }

  reset(): void {
    this.at = -1;
  }
}

/** 씬과 패널이 값이 없을 때 쓰는 자리. 읽기 전용으로만 씁니다. */
export const EMPTY_CUE: LyricCue = emptyCue();
