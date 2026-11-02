## 목표

연출 값을 외부 장비로 내보낸다.

## 먼저 읽을 것

원본 프로토타입 `resona.html` 의 「08 · TouchDesigner 라우팅」 패널에 이 기능이 이미 있다. WebSocket 연결·형식 전환·송출 레이트 슬라이더·채널 표·TouchDesigner 스니펫이 전부 동작하는 상태다. **새로 설계하지 말고 그 구현을 옮겨라.** 다만 아래 세 가지는 바꾼다.

## 작업

- [ ] WebSocket 클라이언트 (기본 `ws://localhost:9980`)
- [ ] 송출 형식 두 가지: JSON 객체, OSC 스타일 평문
- [ ] 송출 주기 슬라이더 5~120, 기본 60
- [ ] 연결 상태 표시 (`OFFLINE` · `CONNECTING` · `LIVE`)
- [ ] **자동 재연결** — 1초에서 시작해 두 배씩, 최대 10초. 해제 버튼으로 끊었을 때는 시도하지 않는다
- [ ] **채널 표를 새로 짠다** — `02-features.md` F-802 의 표 그대로
- [ ] 10 패널 (채널명과 현재 값, 묶음별 접기, 표 갱신은 초당 네 번)
- [ ] TouchDesigner 콜백 스크립트 복사 버튼 — 문자열 채널이 Table DAT 으로 가도록 갱신
- [ ] HTTPS 페이지의 로컬 소켓 차단 안내 문구

## 원본에서 바꾸는 세 가지

**① 채널 표.** 원본은 `/resona/face/count` 와 `/resona/face/max` 로 관객 카메라의 날값을 내보냈다. 이 프로젝트에서 관객은 0~1 로 정규화되어 연출을 증폭하는 값이고, 결과는 `DirectionParams` 다. 그 둘을 빼고 `/resona/audience` · `/resona/audience/state` · `/resona/audience/calibration` · `/resona/influence` 를 넣는다. 그리고 원본에 아예 없던 것 — `/resona/dir/*` 일곱, `/resona/mood/*` 넷, `/resona/palette/*` 다섯, `/resona/state`, `/resona/scene`, `/resona/blackout` — 을 더한다.

얼굴 수를 그대로 보내면 받는 쪽이 연출을 다시 계산하게 된다. 결합 규칙은 `lib/direction/translate.ts` 한 곳에만 있어야 한다는 이 프로젝트의 원칙이 무대 밖에서 깨진다.

**② 가사 채널 이름.** 원본의 `/resona/lyric/index` 는 배열 번호였다. 이 프로젝트의 큐에는 시각 미정 줄이 섞이므로 `/resona/lyric/ordinal` 로 바꾼다. 시각이 붙은 줄만 센 번호이며 `LyricCue.ordinal` 을 그대로 쓴다. `total` 도 같은 기준이다.

**③ 자동 재연결.** 원본은 `onclose` 에서 상태 표시만 바꾸고 다시 붙지 않는다. 공연 중에 TouchDesigner 를 껐다 켜면 사람이 연결 버튼을 다시 눌러야 했다. 무대 뒤에서 그 버튼을 찾게 만들지 않는다.

## 완료 기준

- [ ] 로컬 실행 상태에서 WebSocket 수신 도구로 값이 들어온다
- [ ] JSON 과 OSC-TXT 를 전환해도 같은 값이 두 형식으로 나온다
- [ ] 상대 쪽을 끄면 재연결을 시도하고, 다시 켜면 사람 손 없이 `LIVE` 로 돌아온다
- [ ] `해제` 로 끊으면 재연결하지 않는다
- [ ] 관객 영향력 슬라이더를 움직이면 `/resona/dir/*` 가 따라 움직이고, `/resona/influence` 가 그 값을 그대로 싣는다
- [ ] 관객 입력을 꺼도 `/resona/dir/*` 가 계속 나온다 (`/resona/audience` 는 0)
- [ ] 팔레트를 바꾸면 `/resona/palette/*` 다섯이 즉시 바뀐다
- [ ] 시각 미정 줄이 섞인 큐를 재생할 때 `/resona/lyric/ordinal` 이 건너뛰지 않는다
- [ ] 배포 주소에서 연결을 시도하면 차단 사유가 안내된다
- [ ] 연결하지 않은 상태에서 fps 가 떨어지지 않는다

## 주의

브라우저 보안 정책 때문에 HTTPS 로 배포된 페이지에서는 로컬 소켓에 연결할 수 없다. 외부 연동은 로컬 실행에서 쓴다는 것을 화면에도 적는다.

송출은 렌더 루프 안에서 누적 시간으로 솎아 낸다. 원본의 `wsTick(dt)` 방식이 그대로 맞다. 별도 타이머를 두면 프레임과 어긋난 값이 나간다.

**연결 실패가 렌더 루프를 멈추게 하지 마라.** 공연 중에 쓰는 도구다.

## 참고

- `docs/02-features.md` F-800
- `docs/03-screens.md` 10 절
- 원본 `resona.html` — `wsConnect()` · `wsTick()` · `CHAN` · `TD_SNIPPET`
