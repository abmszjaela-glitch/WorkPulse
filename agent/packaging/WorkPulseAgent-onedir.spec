# Console first: visible diagnostics are required before windowless release.
import sys
from pathlib import Path
sys.path.insert(0, str(Path(SPECPATH)))
from build_common import build
build(SPECPATH, onefile=False)
