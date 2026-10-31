from pathlib import Path
from app.helpers.media import tool, probe

class FFmpegProvider:
    def probe(self, source: Path) -> dict:
        return probe(source)

    def run(self, *args: str, timeout: int = 120) -> str:
        return tool(*args, timeout=timeout)
