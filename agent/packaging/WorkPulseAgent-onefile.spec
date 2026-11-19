# Build only after the onedir executable passes the documented smoke checks.
import sys
from pathlib import Path
sys.path.insert(0, str(Path(SPECPATH)))
from build_common import build
build(SPECPATH, onefile=True)
