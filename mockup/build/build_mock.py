#!/usr/bin/env python3
"""RESONA 콘솔 목업 한 파일 만들기
  console.src.html + stage_embed.html(three.js·네온폰트 내장) + cue_env.json + 폰트 → ../RESONA_콘솔_목업.html
실행:  python3 build_mock.py          (전체: 3D 무대 포함)
       python3 build_mock.py --lite   (사전 목업: 3D 무대 제외, 가벼움)
"""
import base64, json, os, re, sys
D = os.path.dirname(os.path.abspath(__file__))
LITE = '--lite' in sys.argv
OUT = os.path.join(D, '..', 'RESONA_UI_사전목업.html' if LITE else 'RESONA_콘솔_목업.html')

def b64(path): return base64.b64encode(open(os.path.join(D, path), 'rb').read()).decode()

def build_stage():
    src = open(os.path.join(D, 'stage_embed.html'), encoding='utf-8').read()
    mods = {'three': 'lib/three/build/three.module.js'}
    for sub in ['controls', 'postprocessing', 'shaders']:
        for f in sorted(os.listdir(os.path.join(D, 'lib/three/addons', sub))):
            if f.endswith('.js'): mods[f'three/addons/{sub}/{f}'] = f'lib/three/addons/{sub}/{f}'
    blocks = []
    for spec, path in mods.items():
        code = open(os.path.join(D, path), encoding='utf-8').read()
        sub = spec.split('/')[2] if spec != 'three' else ''
        code = re.sub(r"from '\./([^']+)'", lambda m: f"from 'three/addons/{sub}/{m.group(1)}'", code)
        code = re.sub(r"from '\.\./([^']+)'", lambda m: f"from 'three/addons/{m.group(1)}'", code)
        blocks.append(f'<script type="text/plain" data-mod="{spec}">\n{code}\n</script>')
    loader = """<script>
(()=>{ const map = {imports:{}};
  document.querySelectorAll('script[data-mod]').forEach(s=>{ map.imports[s.dataset.mod] = URL.createObjectURL(new Blob([s.textContent], {type:'text/javascript'})); });
  const im = document.createElement('script'); im.type = 'importmap'; im.textContent = JSON.stringify(map); document.currentScript.after(im); })();
</script>"""
    src, n = re.subn(r'<script type="importmap">.*?</script>', lambda m: '\n'.join(blocks) + '\n' + loader, src, count=1, flags=re.S)
    assert n == 1, 'importmap not found'
    css = open(os.path.join(D, 'lib/fonts/fonts.css'), encoding='utf-8').read()
    css = re.sub(r'url\(([^)]+\.woff2)\)', lambda m: 'url(data:font/woff2;base64,' + b64('lib/fonts/' + m.group(1)) + ')', css)
    src, n = re.subn(r'<link href="lib/fonts/fonts.css" rel="stylesheet">[^\n]*', lambda m: '<style>' + css + '</style>', src, count=1)
    assert n == 1, 'fonts link not found'
    return src

def font_css():
    f = []
    def face(fam, w, file): f.append(f"@font-face{{font-family:'{fam}';font-weight:{w};font-display:swap;src:url(data:font/woff2;base64,{b64('fonts/'+file)}) format('woff2')}}")
    face('Pretendard', 700, 'Pretendard-Bold.woff2'); face('Pretendard', 500, 'Pretendard-Medium.woff2')
    face('IBM Plex Mono', 400, 'IBMPlexMono-400.woff2'); face('IBM Plex Mono', 500, 'IBMPlexMono-500.woff2')
    for w in (500, 600, 700): face('Barlow Condensed', w, f'BarlowCondensed-{w}.woff2')
    return '\n'.join(f)

def main():
    html = open(os.path.join(D, 'console.src.html'), encoding='utf-8').read()
    env = open(os.path.join(D, 'cue_env.json'), encoding='utf-8').read()
    stage = '' if LITE else build_stage()
    js = json.dumps(stage, ensure_ascii=False).replace('</', '<\\/').replace('<!--', '<\\!--')
    a1 = open(os.path.join(D, '..', 'data', 'allin1_hongdae.json'), encoding='utf-8').read()
    html = html.replace('/*__A1RUN__*/', a1.replace('</', '<\\/'))
    html = html.replace('/*__FONTS__*/', font_css())
    html = html.replace('/*__ENV__*/', env.replace('</', '<\\/'))
    html = html.replace('/*__STAGE__*/""', js)
    open(OUT, 'w', encoding='utf-8').write(html)
    print(f'만듦: {os.path.basename(OUT)} ({len(html)/1e6:.2f} MB)')
main()
