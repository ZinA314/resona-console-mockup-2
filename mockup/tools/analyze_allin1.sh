#!/usr/bin/env bash
# allin1 (github.com/mir-aidj/all-in-one) 로 곡 구조 분석 → 콘솔에 "allin1 JSON 불러오기"
# 사용: bash tools/analyze_allin1.sh "곡.mp3"      결과: data/<곡이름>.json
set -e
cd "$(dirname "$0")/.."
[ -d .venv_allin1 ] || {
  /opt/homebrew/bin/python3.12 -m venv .venv_allin1
  . .venv_allin1/bin/activate
  pip install -q --upgrade pip setuptools wheel cython numpy torch torchaudio
  pip install -q git+https://github.com/CPJKU/madmom          # 깃허브 원본
  pip install -q allin1                                        # PyPI 배포본 (원본: github.com/mir-aidj/all-in-one)
}
. .venv_allin1/bin/activate
export PYTHONPATH="$PWD/tools/natten_shim"   # Mac 은 NATTEN 이 안 깔려서 순수 PyTorch 대체본 사용 (NVIDIA/리눅스면 이 줄 지우고 pip install natten)
allin1 -o data --demix-dir .allin1_demix --device cpu "$1"
echo "→ data/ 에 JSON 생성됨. 콘솔 왼쪽 01 패널의 [allin1 JSON 불러오기]로 읽으세요."
