# GUI-compatible entry point; the former core/agent.py windowless target is retired.
import sys
from pathlib import Path
packaging_directory = Path(SPECPATH) / 'packaging'
sys.path.insert(0, str(packaging_directory))
from build_common import build
build(packaging_directory, onefile=False, windowed=True)