# Windowed build: desktop startup and sanitized error logging verified first.
import sys
from pathlib import Path
sys.path.insert(0, str(Path(SPECPATH)))
from build_common import build
build(SPECPATH, onefile=False, windowed=True)
