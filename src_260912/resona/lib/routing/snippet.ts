'use client';

/**
 * TouchDesigner 콜백 스크립트 (F-803).
 *
 * 원본 `resona.html` 의 `TD_SNIPPET` 을 옮기고 **문자열 채널을 갱신했습니다.**
 * 원본은 `lyric` 과 `scene` 둘만 Table DAT 으로 보냈는데, 우리 채널 표에는
 * 문자열이 일곱 개입니다 (`mood/name` · `audience/state` · `palette/*` 다섯 ·
 * `lyric/line` · `lyric/next` · `lyric/word` · `scene`).
 *
 * 숫자는 Constant CHOP, 문자열은 Table DAT 으로 갈라 받습니다. CHOP 은
 * 문자열을 담지 못합니다.
 */
export const TD_SNIPPET = [
  '# TouchDesigner — WebSocket DAT callbacks (RESONA)',
  '# 네트워크: WebSocket DAT(port 9980, Active=On) -> 이 스크립트',
  '#           Constant CHOP "resona" 와 Table DAT "resona_txt" 를 만들어 두세요.',
  '#',
  '# 숫자는 CHOP 으로, 문자열은 Table DAT 으로 갑니다. CHOP 은 문자열을 담지 못합니다.',
  'import json',
  '',
  'CHOP_NAME  = "resona"      # 숫자 채널',
  'TABLE_NAME = "resona_txt"  # 문자열 채널',
  '',
  'def onReceiveText(dat, rowIndex, message):',
  '    try:',
  '        d = json.loads(message)',
  '    except Exception:',
  '        return',
  '',
  '    nums = [(k, v) for k, v in d.items() if isinstance(v, (int, float))]',
  '    txts = [(k, v) for k, v in d.items() if isinstance(v, str)]',
  '',
  '    c = op(CHOP_NAME)',
  '    if c is not None:',
  '        if c.par.numchans.eval() < len(nums):',
  '            c.par.numchans = len(nums)',
  '        for i, (k, v) in enumerate(nums):',
  '            setattr(c.par, "name%d" % i, k)',
  '            setattr(c.par, "value%d" % i, float(v))',
  '',
  '    t = op(TABLE_NAME)',
  '    if t is not None:',
  '        t.clear()',
  '        for k, v in txts:',
  '            t.appendRow([k, v])',
  '    return',
  '',
  '',
  'def onConnect(dat):    debug("RESONA connected")',
  'def onDisconnect(dat): debug("RESONA disconnected")',
  '',
].join('\n');
