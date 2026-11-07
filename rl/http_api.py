"""JSON POST helper. Response bodies are returned to callers; headers are not logged."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request


class HTTPFailure(RuntimeError):
    def __init__(self, status: int, body: str):
        self.status = int(status)
        self.body = body[:2000]
        super().__init__(f"HTTP {self.status}")


def post_json(url: str, payload: dict, headers: dict, timeout: float, retries: int = 3) -> dict:
    data = json.dumps(payload).encode("utf-8")
    last: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
            return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            last = HTTPFailure(exc.code, body)
            if exc.code in (429, 500, 502, 503, 504) and attempt + 1 < retries:
                time.sleep(2**attempt)
                continue
            raise last from None
        except urllib.error.URLError as exc:
            last = exc
            if attempt + 1 < retries:
                time.sleep(2**attempt)
                continue
            raise
    if last:
        raise last
    raise RuntimeError("request failed")
