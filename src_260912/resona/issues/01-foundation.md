## 목표

프로젝트 뼈대를 세우고, 음원을 재생해 RMS 가 움직이는 것까지 확인한다.

## 작업

- [ ] Next.js 15 프로젝트 생성 (TypeScript, Tailwind, App Router)
- [ ] `lib/types.ts` 에 `MusicAnalysis`, `MusicState`, `AudienceSource`, `DirectionParams`, `Preset`, `LyricLine` 타입 정의
- [ ] 디자인 토큰을 CSS 변수로 선언 (`--void` `--panel` `--rule` `--bone` `--dim` `--alert` `--cyan`)
- [ ] 콘솔 레이아웃: 상단 바, 좌측 레일(01~04), 중앙 무대, 우측 레일(05~09), 하단 트랜스포트
- [ ] `lib/audio/engine.ts`: AudioContext 생성, 사용자 조작 시점 `resume()`
- [ ] 파일 드롭과 `decodeAudioData`
- [ ] 파형 개요(peaks) 생성과 탐색 막대 표시
- [ ] mid/side 신호를 만들어 AnalyserNode 두 개에 연결 (`fftSize` 4096) — 좌우 채널을 직접 분석하지 않습니다
- [ ] RMS 계산과 상단 바 표시
- [ ] 재생·일시정지·정지·탐색
- [ ] 스페이스바 단축키

## 완료 기준

- [ ] `npm run dev` 후 오류 없이 화면이 뜬다
- [ ] MP3 나 WAV 를 끌어다 놓으면 파일명과 길이가 표시되고 재생 버튼이 활성화된다
- [ ] 재생하면 소리가 나고 상단 바 RMS 가 음악에 맞춰 움직인다
- [ ] 개발자 도구 네트워크 탭에 파일 업로드 요청이 없다
- [ ] 브라우저 콘솔에 오류가 없다

## 검증

`synth/test-01-rms-steps.wav` 를 재생하고 상단 바 RMS 를 대조한다.

| 구간 | 기대값 |
|---|---|
| 0~3초 | 0.00 |
| 3~8초 | 약 0.15 |
| 8~13초 | 약 0.45 |
| 13~18초 | 1.00 |
| 18~23초 | 약 0.22 |
| 23~27초 | 0.00 |

무음 구간에서 0.05 언저리에 떠 있으면 평활이 과한 것이다.

## 참고

- `docs/03-screens.md` 1·2·3절
- `docs/05-signal-processing.md` 1·2-3절
- `docs/06-data-model.md` 4·6절
