#!/usr/bin/env python3
"""Range 요청을 지원하는 간단한 서버 (오디오 탐색용) — 사용: python3 build/range_server.py 8765"""
import http.server, os, re, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 다시 빌드한 화면이 바로 뜨도록: HTML 은 매번 새로 받고, 나머지는 쓰기 전에 서버에 확인
        page = self.path.split('?')[0].split('#')[0].endswith(('.html', '/'))
        self.send_header('Cache-Control', 'no-store' if page else 'no-cache'); super().end_headers()
    def send_head(self):
        rng = self.headers.get('Range'); path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path): return super().send_head()
        m = re.match(r'bytes=(\d+)-(\d*)', rng); size = os.path.getsize(path)
        a = int(m.group(1)); b = int(m.group(2)) if m.group(2) else size - 1; b = min(b, size - 1)
        f = open(path, 'rb'); f.seek(a)
        self.send_response(206); self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {a}-{b}/{size}'); self.send_header('Content-Length', str(b - a + 1))
        self.send_header('Accept-Ranges', 'bytes'); self.end_headers(); self._left = b - a + 1; return f
    def copyfile(self, src, dst):
        n = getattr(self, '_left', None)
        if n is None: return super().copyfile(src, dst)
        while n > 0:
            d = src.read(min(65536, n))
            if not d: break
            dst.write(d); n -= len(d)
        self._left = None
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
