# RESONA 콘솔 목업 — 비 오는 밤에 홍대

AI 음악 무대 컨트롤러 **RESONA**의 클릭 가능한 목업입니다. allin1로 곡을 분석해 구간(섹션)별 영상·효과·조명을 배정하고, 가상 Roto-Control(또는 실물 MIDI)로 조작하며, LED 960×960 4면(3840×960) 무대에 송출·녹화합니다.

## 바로 쓰기
| 파일 | 내용 |
|---|---|
| `mockup/RESONA_콘솔_목업.html` | 콘솔 + 3D 무대(LED 4면) 한 파일 (크롬 권장) |
| `mockup/RESONA_UI_사전목업.html` | 3D 무대를 뺀 경량본 |
| `mockup/song.mp3` | 같은 폴더에 둘 것 (재생용) |

곡 탐색·녹화 오디오까지 쓰려면 로컬 서버로 여세요.

```bash
cd mockup && python3 build/range_server.py 8765
# 브라우저: http://localhost:8765/RESONA_콘솔_목업.html
```

자세한 사용법·기능·MIDI 매핑은 [`mockup/README.md`](mockup/README.md) 를 보세요.

## 폴더
| 경로 | 내용 |
|---|---|
| `mockup/` | 완성본 HTML, `build/`(소스·빌드 스크립트), `data/`(allin1 분석 JSON), `tools/`(분석 스크립트) |
| `src_team2/` | 2조 무대 3D 미리보기 원본 (콘솔에 내장해 사용) |
| `src_260912/` | 2조 Next.js 콘솔 원본 (디자인 토큰 참고) |
| `docs/` | 참고 자료 PDF (allin1 설명 등) |

소스를 고친 뒤 다시 만들기: `python3 mockup/build/build_mock.py` (전체) / `--lite` (경량).

## 알아둘 점
- 이 저장소는 **비공개**로 팀원 공유용입니다. `mockup/song.mp3`(곡)·`docs/`의 PDF(교육자료)·`src_*`(팀 코드)를 공개로 바꾸기 전에는 각 권리자의 허락을 확인하세요.
- 서드파티: three.js(MIT), Pretendard · Barlow Condensed · IBM Plex Mono(OFL), team2 무대의 `THIRD_PARTY.md` 참고.
- 카메라 얼굴 검출(MediaPipe), Roto-Control 실물 MIDI 매핑(CC1~8, 노트 36~53)은 아직 미검증입니다.
- Launch Control XL 3 매핑은 실물에서 읽은 CC 번호 기준입니다([`mockup/README.md`](mockup/README.md)).
