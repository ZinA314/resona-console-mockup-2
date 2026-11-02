/**
 * 기본 팔레트 여덟. `docs/05-signal-processing.md` 8-2·8-3절 (F-1003).
 *
 * 색값과 앵커 좌표는 명세 표 그대로입니다. 눈으로 고른 값이므로 화면을 보고
 * 조정하게 되면 명세에 되돌려 적으십시오.
 *
 * 앞의 다섯은 7-5절의 분위기 이름과 짝을 이뤄 자동 선택의 앵커가 되고, 뒤의
 * 셋은 수동 선택용입니다. 사용자가 `auto` 를 켜서 후보에 넣을 수 있습니다.
 */
import type { MoodName, Palette } from '@/lib/types';

/**
 * **기본 자동 후보는 네 모서리뿐입니다** (8-2·8-3절).
 *
 * `MONO` 는 평면 한가운데(0.50, 0.50)에 있고 `base` 가 무채색 뼈색이라,
 * 후보에 두면 거의 모든 곡에서 두 번째로 가까운 앵커가 되어 색을 바래게
 * 만듭니다. 실측에서 `test-09-mood-radiant.wav` 가 `희망` 으로 옳게 판정됐는데도
 * 섞임이 `MONO 53% + 희망 47%` 가 되어 무대색이 탁한 갈색(`#6a5f4a`)으로
 * 나왔습니다. 후보에서 빼면 두 번째가 `격정` 이 되어 주황빛 노랑이 됩니다.
 *
 * 나머지 넷에도 앵커를 주는 것은, 사용자가 자동 후보로 켰을 때 한자리에
 * 겹치지 않게 하기 위해서입니다.
 */

export const BUILTIN_PALETTES: readonly Palette[] = [
  {
    id: 'deep',
    name: '침잠',
    chips: { bg: '#01040E', deep: '#0A1740', base: '#3B5BD9', accent: '#6E86F0', hot: '#C3D0FF' },
    auto: true,
    anchor: { valence: 0.22, arousal: 0.2 },
    builtin: true,
  },
  {
    id: 'serene',
    name: '평온',
    chips: { bg: '#03080C', deep: '#0B2430', base: '#7FD7D0', accent: '#A8E6DF', hot: '#E8FBF7' },
    auto: true,
    anchor: { valence: 0.72, arousal: 0.2 },
    builtin: true,
  },
  {
    id: 'radiant',
    name: '희망',
    chips: { bg: '#0B0703', deep: '#3A2405', base: '#FFC53D', accent: '#FFE27A', hot: '#FFF6D6' },
    auto: true,
    anchor: { valence: 0.8, arousal: 0.82 },
    builtin: true,
  },
  {
    id: 'fervent',
    name: '격정',
    chips: { bg: '#0A0204', deep: '#3B0512', base: '#FF2A00', accent: '#FF6B8A', hot: '#FFD1DA' },
    auto: true,
    anchor: { valence: 0.2, arousal: 0.82 },
    builtin: true,
  },
  {
    // 기존 시각 언어(`03-screens.md` 2절)의 색 그대로입니다.
    // 원본 프로토타입의 `mono` 톤이 여기로 흡수됩니다. 기본 선택값입니다.
    id: 'mono',
    name: 'MONO',
    chips: { bg: '#000000', deep: '#14140F', base: '#E8E4DC', accent: '#7FD7D0', hot: '#FF2A00' },
    // 수동 선택용입니다. 위 주석의 이유로 자동 후보에서 뺍니다.
    auto: false,
    anchor: { valence: 0.5, arousal: 0.5 },
    builtin: true,
  },
  {
    id: 'abyss',
    name: '심해',
    chips: { bg: '#00070A', deep: '#052430', base: '#0FA3A3', accent: '#55E0C8', hot: '#EAFFFA' },
    auto: false,
    anchor: { valence: 0.35, arousal: 0.35 },
    builtin: true,
  },
  {
    id: 'ember',
    name: '노을',
    chips: { bg: '#0C0403', deep: '#40120A', base: '#FF7A2F', accent: '#FFB35C', hot: '#FFE7C4' },
    auto: false,
    anchor: { valence: 0.65, arousal: 0.55 },
    builtin: true,
  },
  {
    id: 'frost',
    name: '설야',
    chips: { bg: '#04060A', deep: '#131A24', base: '#DCE6F2', accent: '#8FB6E8', hot: '#FFFFFF' },
    auto: false,
    anchor: { valence: 0.6, arousal: 0.3 },
    builtin: true,
  },
];

/**
 * 기본으로 선택돼 있는 팔레트. 원본의 흑백에 빨강 강조 화면입니다.
 *
 * 분위기 이름 `중립 NEUTRAL`(7-5절)과는 다른 것입니다. 그쪽은 평면 한가운데의
 * **분위기** 이름이고, 이쪽은 무채색 **팔레트** 입니다. 이름이 같아 헷갈리던
 * 것을 `MONO` 로 갈랐습니다.
 */
export const MONO_PALETTE_ID = 'mono';

/**
 * **분위기** 이름의 한글 표시. 08 패널 머리말과 2축 평면이 씁니다.
 * 여기의 `NEUTRAL 중립` 은 팔레트 `MONO` 와 다른 것입니다.
 */
export const MOOD_LABEL: Record<MoodName, string> = {
  DEEP: '침잠',
  SERENE: '평온',
  RADIANT: '희망',
  FERVENT: '격정',
  NEUTRAL: '중립',
};

/** 역할 다섯의 순서와 이름. 컬러칩 편집기가 이 순서로 세로로 놓습니다. */
export const ROLE_ROWS = [
  { role: 'bg', label: '배경', hint: '무대 배경의 가장 어두운 자리' },
  { role: 'deep', label: '깊이', hint: '배경 유체의 어두운 층' },
  { role: 'base', label: '기본', hint: '입자와 실의 기본색' },
  { role: 'accent', label: '강조', hint: '가사의 현재 단어, 세로실, 밝은 입자' },
  { role: 'hot', label: '순간', hint: '비트가 올 때만 잠깐 나타납니다' },
] as const;

/** 사용자 팔레트를 만들 때 쓰는 새 식별자. */
export function newPaletteId(): string {
  return `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
