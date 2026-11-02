'use client';

import { useEffect, useRef, useState } from 'react';
import { Panel } from '@/components/console/Panel';
import { audioEngine } from '@/lib/audio/engine';
import { STEM_GATE } from '@/lib/audio/stems';
import { BPM_CONF_SHOW } from '@/lib/audio/tempo';
import { frameStats } from '@/lib/frame';
import { useEngineState, useFrame } from '@/lib/hooks';
import { audienceManager } from '@/lib/audience/manager';
import { useConsoleStore } from '@/lib/store';
import { cx, formatUnit } from '@/lib/util';

/** 아직 구현하지 않은 값은 이 표시로 둡니다. */
const NONE = '—';

/**
 * `hot` 이면 그 칸을 강조합니다. 0~1 값은 0.8 을 넘을 때,
 * 플럭스는 온셋이 뜰 때 켭니다. Hz 처럼 0~1 이 아닌 값에는 걸지 않습니다.
 */
function Row({
  label,
  value,
  live = false,
  hot = false,
}: {
  label: string;
  value: string;
  live?: boolean;
  hot?: boolean;
}) {
  const over = hot;
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-rule/60 py-0.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-dim">{label}</span>
      <span
        className={cx(
          'text-[12px] tabular-nums',
          over ? 'text-alert' : live ? 'text-bone' : 'text-dim',
        )}
      >
        {value}
      </span>
    </div>
  );
}

interface Snapshot {
  bpm: number;
  bpmConf: number;
  bar: number;
  beat: number;
  beatInBar: number;
  phase: number;
  rms: number;
  peak: number;
  flux: number;
  centroid: number;
  onsetPulse: number;
  bands: number[];
  stems: number[];
  audience: number;
  calibration: number;
  audienceLive: boolean;
  fps: number;
  /** `rmsSlow` 가 `STEM_GATE` 아래로 이어진 시간(초). */
  quietFor: number;
  /** 이 소스에서 한 번이라도 문턱 위로 올라간 적이 있는가. */
  heard: boolean;
}

const EMPTY: Snapshot = {
  bpm: 0,
  bpmConf: 0,
  bar: 1,
  beat: 0,
  beatInBar: 1,
  phase: 0,
  rms: 0,
  peak: 0,
  flux: 0,
  centroid: 0,
  onsetPulse: 0,
  bands: [0, 0, 0, 0, 0, 0],
  stems: [0, 0, 0, 0],
  audience: 0,
  calibration: 0,
  audienceLive: false,
  fps: 0,
  quietFor: 0,
  heard: false,
};

const BAND_LABELS = ['SUB', 'LOW', 'LMID', 'MID', 'HI', 'AIR'];
const STEM_LABELS = ['DRUMS', 'BASS', 'VOCAL', 'OTHER'];

/**
 * 입력이 작다고 말하기 전에 기다리는 시간. 두 단입니다.
 * `docs/03-screens.md` 09 절.
 *
 * 문턱은 스템 게이트와 같은 `STEM_GATE` 입니다. 같은 물음(들어오는 소리가
 * 음악인가 암소음인가)에 두 개의 숫자를 두지 않습니다.
 *
 * **아직 한 번도 소리를 들은 적이 없으면 2.0초.** 마이크 모드나 볼륨 설정
 * 실수는 빨리 알려야 합니다. 실제 음악이 문턱 아래로 이어지는 가장 긴 구간이
 * 0.94초(발라드 도입부)였고 조용한 방은 9.6~13.4초 내내 아래였습니다.
 *
 * **한 번이라도 들었으면 30.0초.** 공연에서 곡과 곡 사이는 늘 2초를 넘습니다.
 * 아무 문제 없는데 「볼륨을 확인하십시오」가 뜨면 운영자가 손을 댑니다.
 * 셋리스트 실측에서 문턱 아래로 이어진 가장 긴 구간이 20.37초였습니다.
 */
const QUIET_HOLD_COLD = 2.0;
const QUIET_HOLD_WARM = 30.0;

export default function ReadoutPanel() {
  const tempoLocked = useConsoleStore((s) => s.tempoLocked);
  const engine = useEngineState();
  // 매 프레임 쌓는 값이라 상태가 아니라 ref 에 둡니다.
  const quietRef = useRef(0);
  /** 이 소스에서 한 번이라도 문턱 위로 올라간 적이 있는가. */
  const heardRef = useRef(false);

  /**
   * 파일을 세워 둔 동안. 왜 조용한지를 코드가 이미 알고 있으므로 「입력이 너무
   * 작습니다」를 띄우지 않고, 누적 시간도 세지 않습니다. 마이크·라인과 달리
   * 파일은 정지와 무음이 구별됩니다.
   */
  const filePaused = engine.kind === 'file' && !engine.playing;

  // 소스를 바꾸면 처음부터 셉니다. 파일이 잘 나오다가 마이크로 옮겼는데 모드가
  // 틀렸다면, 그것이야말로 2.0초 안에 알려야 하는 상황입니다.
  useEffect(() => {
    heardRef.current = false;
    quietRef.current = 0;
  }, [engine.kind]);
  // 매 프레임이 아니라 4프레임마다 상태로 올립니다.
  const [v, setV] = useState<Snapshot>(EMPTY);

  useFrame((dt, frame) => {
    const a = audioEngine.analysis;
    if (filePaused) quietRef.current = 0;
    else if (a.rmsSlow < STEM_GATE) quietRef.current += dt;
    else {
      quietRef.current = 0;
      heardRef.current = true;
    }
    if (frame % 4 !== 0) return;
    setV({
      bpm: a.bpm,
      bpmConf: a.bpmConf,
      bar: a.bar,
      beat: a.beat,
      beatInBar: a.beatInBar,
      phase: a.phase,
      rms: a.rms,
      peak: a.peak,
      flux: a.flux,
      centroid: a.centroid,
      onsetPulse: a.onsetPulse,
      bands: [...a.bands],
      stems: [...a.stems],
      audience: audienceManager.reading.energy,
      calibration: audienceManager.reading.calibration,
      audienceLive: audienceManager.hasSignal,
      fps: frameStats.fps,
      quietFor: quietRef.current,
      heard: heardRef.current,
    });
  }, 20);

  const fps = Math.round(v.fps);
  const bpmShown = v.bpm > 0 && (tempoLocked || v.bpmConf >= BPM_CONF_SHOW);

  return (
    <Panel index="09" title="분석 리드아웃">
      <div className="grid grid-cols-2 gap-x-3">
        <div>
          {/*
            신뢰도가 `BPM_CONF_SHOW` 아래면 `---` 입니다. 마디·박은 비어 있는데
            BPM 만 숫자로 떠 있으면 읽는 사람이 유효한 값으로 오해합니다.
            잠금 중에는 신뢰도와 무관하게 값을 보여 줍니다 (F-303-2).
          */}
          <Row
            label="BPM"
            value={bpmShown ? v.bpm.toFixed(1) : '---'}
            live={bpmShown}
          />
          {/* 사람이 정한 값을 자동 추정의 확신도와 섞지 않습니다. */}
          <Row
            label="신뢰도"
            value={tempoLocked ? '수동' : formatUnit(v.bpmConf)}
            live={tempoLocked || v.bpm > 0}
            hot={!tempoLocked && v.bpmConf > 0.8}
          />
          <Row
            label="마디"
            value={v.beat > 0 ? String(v.bar) : NONE}
            live={v.beat > 0}
          />
          {/* 박은 마디 안 위치이므로 0.8 판정 대상이 아닙니다. */}
          <Row
            label="박"
            value={v.beat > 0 ? `${v.beatInBar} / 4` : NONE}
            live={v.beat > 0}
          />
          <Row
            label="위상"
            value={formatUnit(v.phase)}
            live={v.bpm > 0}
            hot={v.phase > 0.8}
          />
          <Row label="RMS" value={formatUnit(v.rms)} live hot={v.rms > 0.8} />
          <Row label="피크" value={formatUnit(v.peak)} live hot={v.peak > 0.8} />
          {/* 온셋이 뜨는 순간 플럭스 칸이 붉어집니다. 0.8 판정은 걸지 않습니다. */}
          <Row label="플럭스" value={formatUnit(v.flux)} live hot={v.onsetPulse > 0.5} />
          {/* 센트로이드는 Hz 이므로 0.8 판정 대상이 아닙니다. */}
          <Row
            label="센트로이드"
            value={v.centroid > 0 ? `${Math.round(v.centroid)}Hz` : NONE}
            live={v.centroid > 0}
          />
          <Row
            label="관객 / 보정"
            value={
              v.audienceLive
                ? `${formatUnit(v.audience)} / ${Math.round(v.calibration * 100)}%`
                : NONE
            }
            live={v.audienceLive}
            hot={v.audience > 0.8}
          />
        </div>
        <div>
          {BAND_LABELS.map((label, i) => (
            <Row
              key={label}
              label={label}
              value={formatUnit(v.bands[i])}
              live
              hot={v.bands[i] > 0.8}
            />
          ))}
          {STEM_LABELS.map((label, i) => (
            <Row
              key={label}
              label={label}
              value={formatUnit(v.stems[i])}
              live
              hot={v.stems[i] > 0.8}
            />
          ))}
          <div className="flex items-baseline justify-between gap-2 py-0.5">
            <span className="text-[10px] uppercase tracking-[0.1em] text-dim">FPS</span>
            <span
              className={cx(
                'text-[12px] tabular-nums',
                fps > 0 && fps < 30 ? 'text-alert' : 'text-bone',
              )}
            >
              {fps > 0 ? fps : NONE}
            </span>
          </div>
        </div>
      </div>

      {/*
        숫자가 사라진 이유를 화면이 말합니다. 공연 중에 BPM 이 비면 고장인지
        설계인지 알 수 없어서, 사유와 다음 손동작을 같이 놓습니다.
        자리가 좁은 상단 바에는 두지 않습니다 (`03-screens.md` 2절).
      */}
      {bpmShown ? null : (
        <p className="mt-1.5 border-t border-rule pt-1.5 text-[10px] leading-relaxed text-dim">
          {engine.kind === 'none' ? (
            '입력 없음 · 마이크나 파일을 연결하십시오'
          ) : v.quietFor >= (v.heard ? QUIET_HOLD_WARM : QUIET_HOLD_COLD) ? (
            '입력이 너무 작습니다 · 볼륨과 마이크 모드를 확인하십시오'
          ) : (
            <>
              BPM 신뢰도 낮음 · <span className="text-bone">TAP</span> 으로 잡으십시오
            </>
          )}
        </p>
      )}
    </Panel>
  );
}
