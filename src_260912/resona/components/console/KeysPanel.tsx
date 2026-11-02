'use client';

import { Panel } from '@/components/console/Panel';
import { useConsoleStore } from '@/lib/store';
import { cx } from '@/lib/util';

/** `docs/03-screens.md` 11 절의 표 그대로입니다. */
const KEYS: Array<[string, string]> = [
  ['1–6', '씬 전환 (1 무대 · 4 직조)'],
  ['B', '블랙아웃'],
  ['A', '관객 영향력 0% ↔ 이전 값'],
  ['O', '출력 창 열기'],
  ['F', '전체 화면'],
  ['T', '탭 템포 (4회 이상)'],
  ['← →', '5초 뒤로 / 앞으로'],
  ['R', '관객 보정 초기화'],
  ['P', '팔레트 자동 켜기 / 끄기'],
  ['[ ]', '팔레트 이전 / 다음'],
];

function Row({
  keyName,
  action,
  hot = false,
}: {
  keyName: string;
  action: string;
  hot?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt
        className={cx(
          'w-14 shrink-0 border px-1 text-center text-[10px]',
          hot ? 'border-alert bg-alert text-void' : 'border-rule text-bone',
        )}
      >
        {keyName}
      </dt>
      <dd className={cx('text-[11px]', hot ? 'text-alert' : 'text-bone')}>{action}</dd>
    </div>
  );
}

export default function KeysPanel() {
  /*
   * `Space` 만 뜻이 바뀝니다 (F-604). 탭 모드가 켜져 있는 동안 이 줄도 함께
   * 붉어집니다. 상단 배너가 본체이고 여기는 거들 뿐이지만, 단축키를 확인하러
   * 온 사람이 낡은 설명을 읽고 가면 안 됩니다.
   */
  const tapMode = useConsoleStore((s) => s.tapMode);

  return (
    <Panel index="11" title="단축키">
      <dl className="space-y-1">
        <Row
          keyName="Space"
          action={tapMode ? '현재 줄에 지금 시각 찍기' : '재생 / 일시정지'}
          hot={tapMode}
        />
        {tapMode ? <Row keyName="ESC" action="탭 모드 나가기" hot /> : null}
        {KEYS.map(([key, action]) => (
          <Row key={key} keyName={key} action={action} />
        ))}
      </dl>
      <p className="mt-2 text-[10px] leading-relaxed text-dim">
        <span className="text-bone">Space</span> 는 예외가 하나 있습니다. 03 가사
        패널의 탭 모드가 켜져 있는 동안에는 타임스탬프 찍기로 동작하고, 그때는
        화면 상단에 붉은 배너가 떠 있습니다.
      </p>
    </Panel>
  );
}
