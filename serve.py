# 로컬 테스트용 서버: python serve.py  (→ http://localhost:8123)
# 그냥 python -m http.server 를 쓰면 브라우저가 옛날 js 파일을 캐시해서
# 코드를 고쳐도 새로고침에 반영이 안 될 때가 있다. 그래서 캐시를 끈다.
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
print(f'친구컷 로컬 서버: http://localhost:{port}  (끄려면 Ctrl+C)')
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
