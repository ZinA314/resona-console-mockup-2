# 개발 이슈

`docs/07-roadmap.md` 의 8단계를 GitHub 이슈 9개로 나눈 것입니다. 2단계는 덩어리가 커서 두 개로 쪼갰습니다.

| 파일 | 이슈 제목 | 라벨 |
|---|---|---|
| `01-foundation.md` | [1단계] 프로젝트 뼈대와 오디오 입력 | 1단계, 오디오, 화면 |
| `02-features-onset.md` | [2단계-A] 주파수 특징 추출과 온셋 검출 | 2단계, 오디오 |
| `03-tempo-beat.md` | [2단계-B] BPM 추정과 비트 트래킹 | 2단계, 오디오 |
| `04-render-scenes.md` | [3단계] 캔버스 렌더링과 첫 씬 | 3단계, 화면 |
| `05-audience.md` | [4단계] 관객 입력과 자동 보정 | 4단계 |
| `06-direction-engine.md` | [5단계] 연출 번역 엔진 | 5단계, **핵심** |
| `07-lyrics-scenes.md` | [6단계] 가사 큐와 나머지 씬 | 6단계, 화면 |
| `08-storage-deploy.md` | [7단계] Supabase 저장과 Vercel 배포 | 7단계 |
| `09-routing.md` | [8단계] WebSocket 외부 연동 | 8단계 |
| `10-tempo-accuracy.md` | [개선] 실제 음악에서의 BPM 정확도 | 2단계, 오디오 |
| `11-mood-palette.md` | [5단계-B] 곡 분위기 판정과 팔레트 | 5단계, 색, 화면 |
| `12-stage-bloom.md` | [6단계-A] 무대 출력 씬 BLOOM | 6단계, 화면, **핵심** |
| `13-lyrics-editor.md` | [6단계-C] LRC 편집기 | 6단계, 화면 |
| `14-output-window-resilience.md` | [개선] 콘솔이 가려져도 출력 창이 계속 돌게 | 3단계, 화면 |

11~14 번은 나중에 더한 이슈입니다. 단계가 갈라지면서 제목도 바뀌었습니다.

| 이슈 | 제목 |
|---|---|
| `06-direction-engine.md` | [5단계-A] 연출 번역 엔진 |
| `11-mood-palette.md` | [5단계-B] 곡 분위기 판정과 팔레트 |
| `12-stage-bloom.md` | [6단계-A] 무대 출력 씬 BLOOM |
| `07-lyrics-scenes.md` | [6단계-B] 가사 큐와 합성 씬 |
| `13-lyrics-editor.md` | [6단계-C] LRC 편집기 |

## 로컬 파일과 GitHub 이슈 맞추기

명세를 고치면 이슈 파일도 함께 바뀝니다. GitHub 쪽 본문이 뒤처졌는지 확인하고 맞추는 스크립트입니다.

```bash
bash issues/sync-issues.sh          # 무엇이 다른지만 봅니다. 아무것도 고치지 않습니다
bash issues/sync-issues.sh --apply  # 다른 것만 갱신합니다
```

제목이 아니라 검색 키로 이슈를 찾으므로, 제목에 `-A` `-B` 가 붙어 바뀌어도 같은 이슈를 계속 따라갑니다. 본문이 같은 이슈는 건드리지 않습니다.

## 한 번에 등록하기

GitHub 저장소가 이미 있고 `gh` CLI 로그인이 되어 있다면 한 줄로 끝납니다.

```bash
bash issues/create-issues.sh
```

라벨 11개를 먼저 만들고 이슈 9개를 등록합니다. 이미 있는 라벨은 건너뜁니다.

나중에 더한 11~13 번은 별도 스크립트로 등록합니다. **위 스크립트를 다시 돌리면 1~9 번이 한 벌 더 생깁니다.**

```bash
bash issues/create-issues-2.sh
```

저장소가 아직 없다면 프로젝트 루트에서 먼저 만드십시오.

```bash
gh repo create resona --private --source=. --push
```

## 하나씩 등록하기

```bash
gh issue create \
  --title "[2단계-A] 주파수 특징 추출과 온셋 검출" \
  --body-file issues/02-features-onset.md \
  --label "2단계,오디오"
```

## 이슈를 닫을 때

작업이 끝나면 완료 기준을 하나씩 체크하고, 검증까지 마친 뒤에 닫습니다. 커밋 메시지에 `closes #3` 을 넣으면 병합될 때 자동으로 닫힙니다.

```bash
git commit -m "2단계-B: BPM 추정과 비트 트래킹

closes #3"
```

## 이슈 본문의 구조

각 이슈는 같은 형태로 되어 있습니다.

- **목표** — 이 이슈가 끝나면 무엇이 되는가
- **배경** — 왜 이렇게 하는가 (필요한 이슈에만)
- **작업** — 구현할 항목 체크리스트
- **완료 기준** — 눈으로 확인 가능한 조건
- **검증** — 어느 테스트 음원으로 어떻게 확인하는가
- **참고** — 관련 명세 문서와 절

Claude Code 에게 작업을 시킬 때 이슈 본문을 그대로 붙여 넣으셔도 됩니다.

```
아래 이슈를 구현해줘.

(이슈 본문 붙여넣기)
```
