'use client';

import { useEffect } from 'react';
import AudiencePanel from '@/components/console/AudiencePanel';
import DirectionPanel from '@/components/console/DirectionPanel';
import InputPanel from '@/components/console/InputPanel';
import KeysPanel from '@/components/console/KeysPanel';
import LyricsPanel from '@/components/console/LyricsPanel';
import PalettePanel from '@/components/console/PalettePanel';
import PresetPanel from '@/components/console/PresetPanel';
import ReadoutPanel from '@/components/console/ReadoutPanel';
import RoutingPanel from '@/components/console/RoutingPanel';
import SceneParamsPanel from '@/components/console/SceneParamsPanel';
import ScenePanel from '@/components/console/ScenePanel';
import StemPanel from '@/components/console/StemPanel';
import TopBar from '@/components/console/TopBar';
import Stage from '@/components/stage/Stage';
import Transport from '@/components/transport/Transport';
import { audienceManager } from '@/lib/audience/manager';
import { audioEngine } from '@/lib/audio/engine';
import { directionManager } from '@/lib/direction/manager';
import { StageBroadcaster } from '@/lib/render/broadcast';
import { routingClient } from '@/lib/routing/client';
import { readStageInput } from '@/lib/render/feed';
import { useEngineState } from '@/lib/hooks';
import { useConsoleStore } from '@/lib/store';
import type { SceneKind } from '@/lib/types';

const SEEK_STEP = 5;

/**
 * 숫자키 1~6 에 대응하는 씬. `03-screens.md` 06 절의 배열 순서 그대로입니다.
 * 앞의 셋이 무대용, 뒤의 셋이 진단용입니다. **`1` 이 무대인 것은 의도한
 * 것입니다** — 급할 때 누르면 무대로 돌아옵니다.
 */
const SCENE_KEYS: SceneKind[] = [
  'bloom',
  'composite',
  'type',
  'weave',
  'spectrum',
  'faces',
];

/** 출력 창. 조작 요소가 없는 무대만 띄웁니다 (F-506). */
function openOutputWindow() {
  window.open('/output', 'resona-output', 'width=1280,height=720');
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  } else {
    void document.documentElement.requestFullscreen().catch(() => {});
  }
}

/**
 * 탭 모드 배너 (F-604). `docs/03-screens.md` 03 절.
 *
 * **선택 사항이 아닙니다.** `Space` 는 평소 재생과 일시정지에 쓰는 키입니다.
 * 배너 없이 뜻을 바꾸면 공연 중에 재생을 멈추려다 가사를 망가뜨립니다.
 * 화면 맨 위, 상단 바보다도 위에 둡니다 — 켜져 있다는 사실이 어느 패널을
 * 보고 있든 눈에 들어와야 합니다.
 */
function TapModeBanner() {
  const tapMode = useConsoleStore((s) => s.tapMode);
  const setTapMode = useConsoleStore((s) => s.setTapMode);
  if (!tapMode) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between gap-3 bg-alert px-3 py-1.5 text-void"
    >
      {/* 명세에 적힌 문장 그대로입니다. `uppercase` 를 걸면 Space 가 SPACE 로 바뀝니다. */}
      <span className="text-[12px] tracking-[0.14em]">
        탭 모드 — Space 는 타임스탬프 찍기 · ESC 로 나가기
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.currentTarget.blur();
          setTapMode(false);
        }}
        className="shrink-0 border border-void/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] hover:bg-void/10"
      >
        나가기
      </button>
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export default function Console() {
  /*
   * 분석 루프 (`docs/04-flows.md` 4절의 2~5번, 8번).
   *
   * **콘솔의 `requestAnimationFrame` 이 아니라 오디오 스레드의 시계가
   * 몹니다** (#16). 브라우저는 보이지 않는 창의 rAF 를 멈추므로, 여기에
   * 얹혀 있으면 오퍼레이터가 콘솔을 최소화하는 순간 무대가 정지합니다.
   * 콘솔의 rAF 는 중앙 무대 미리보기와 수치 표시에만 씁니다.
   */
  useEffect(() => {
    const broadcaster = new StageBroadcaster();
    broadcaster.open();
    const stop = audioEngine.subscribeTick((dt) => {
      audioEngine.analyze(dt); // 2) 음악 분석
      audienceManager.read(dt); // 3) 관객 에너지
      directionManager.update(dt); // 4·5) 상태 판정과 연출 산출
      // 8) 출력 창 송출. 이 줄이 rAF 밖에 있어야 무대가 계속 돕니다.
      const input = readStageInput();
      broadcaster.send(audioEngine.now, input);
      /*
       * 9) 외부 연동 송출 (F-801). **여기서 누적 시간으로 솎아 냅니다** —
       * 별도 타이머를 두면 프레임과 어긋난 값이 나갑니다. 원본
       * `resona.html` 의 `wsTick(dt)` 와 같은 방식입니다.
       *
       * 값을 만드는 함수를 넘깁니다. 보낼 차례가 아니면 만들지도 않습니다.
       * `tick` 은 던지지 않으므로 연결이 죽어도 이 루프는 그대로 돕니다.
       */
      routingClient.tick(dt, () => ({
        input,
        trackTime: audioEngine.currentTime,
        influence: useConsoleStore.getState().influence,
        calibration: audienceManager.reading.calibration,
      }));
    });
    return () => {
      stop();
      broadcaster.close();
    };
  }, []);

  // F-303-2. 확정한 템포와 자물쇠를 엔진에 전달합니다.
  const lockedBpm = useConsoleStore((s) => s.lockedBpm);
  const tempoLocked = useConsoleStore((s) => s.tempoLocked);
  useEffect(() => {
    audioEngine.applyTempoOverride(lockedBpm, tempoLocked);
  }, [lockedBpm, tempoLocked]);

  // 곡이 바뀌면 템포도 바뀌므로 확정값을 버립니다. 프리셋을 적용하면
  // `applyPreset` 이 그 뒤에 저장된 값을 다시 넣으므로 예외가 됩니다.
  // 곡의 성격도 마찬가지입니다. `valence` 는 시상수가 6초라 비우지 않으면
  // 이전 곡의 색을 한동안 끌고 갑니다.
  const { loadId } = useEngineState();
  useEffect(() => {
    if (loadId === 0) return;
    useConsoleStore.getState().clearTempoLock();
    directionManager.reset();
  }, [loadId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      /*
       * F-604 탭 모드. **키가 갈리는 자리는 여기 한 곳뿐입니다.**
       * 편집기 컴포넌트가 같은 키를 또 들으면 한 번 누른 것이 두 줄에
       * 찍힙니다. 가로채는 것은 `Space` 와 `ESC` 둘뿐이고, 나머지 단축키는
       * 그대로 둡니다 — 찍는 도중에도 블랙아웃은 즉시 들어야 합니다.
       */
      const store = useConsoleStore.getState();
      if (store.tapMode) {
        if (e.code === 'Space') {
          // 초점이 버튼에 남아 있어도 그 버튼이 다시 눌리지 않게 막습니다.
          e.preventDefault();
          store.stampTap();
          return;
        }
        if (e.code === 'Escape') {
          e.preventDefault();
          store.setTapMode(false);
          return;
        }
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          audioEngine.toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          audioEngine.seek(audioEngine.currentTime - SEEK_STEP);
          break;
        case 'ArrowRight':
          e.preventDefault();
          audioEngine.seek(audioEngine.currentTime + SEEK_STEP);
          break;
        case 'KeyT':
          // F-303-2 탭 템포. 탭 버튼과 같은 경로를 탑니다.
          e.preventDefault();
          useConsoleStore.getState().registerTap();
          break;
        case 'KeyB':
          // 공연 사고 시의 비상 조작이므로 어떤 상태에서도 즉시 반응합니다.
          e.preventDefault();
          useConsoleStore.getState().toggleBlackout();
          break;
        case 'KeyA':
          e.preventDefault();
          useConsoleStore.getState().toggleInfluence();
          break;
        case 'KeyR':
          e.preventDefault();
          audienceManager.recalibrate();
          break;
        case 'KeyP':
          // 끄는 경우 직전 섞임의 우세 팔레트가 선택됩니다 (8-5절).
          e.preventDefault();
          useConsoleStore
            .getState()
            .togglePaletteAuto(directionManager.dominantPaletteId);
          break;
        case 'BracketLeft':
          e.preventDefault();
          useConsoleStore.getState().cyclePalette(-1);
          break;
        case 'BracketRight':
          e.preventDefault();
          useConsoleStore.getState().cyclePalette(1);
          break;
        case 'KeyO':
          e.preventDefault();
          openOutputWindow();
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
        case 'Digit4':
        case 'Digit5':
        case 'Digit6': {
          e.preventDefault();
          const scene = SCENE_KEYS[Number(e.code.slice(5)) - 1];
          if (scene) useConsoleStore.getState().setScene(scene);
          break;
        }
        default:
          break;
      }
    }

    // 드롭 영역 밖에 파일을 놓아도 브라우저가 그 파일로 이동하지 않게 막습니다.
    function swallow(e: DragEvent) {
      e.preventDefault();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  return (
    <div className="flex h-dvh min-w-[1180px] flex-col bg-void">
      <TapModeBanner />
      <TopBar />

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_300px] gap-2 p-2">
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
          <InputPanel />
          <StemPanel />
          <LyricsPanel />
          <AudiencePanel />
          <PalettePanel />
          <PresetPanel />
        </div>

        <div className="flex min-h-0 flex-col">
          <Stage />
        </div>

        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
          <ScenePanel />
          <SceneParamsPanel />
          <DirectionPanel />
          <ReadoutPanel />
          <RoutingPanel />
          <KeysPanel />
        </div>
      </div>

      <Transport />
    </div>
  );
}
