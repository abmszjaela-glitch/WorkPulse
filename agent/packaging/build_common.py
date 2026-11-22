"""Explicit PyInstaller inputs shared by debug onedir and console onefile specs."""
from pathlib import Path
import runpy

from PyInstaller.building.build_main import Analysis
from PyInstaller.building.api import PYZ, EXE, COLLECT
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.win32.versioninfo import VSVersionInfo, FixedFileInfo, StringFileInfo, StringTable, StringStruct, VarFileInfo, VarStruct


def build(spec_directory, *, onefile, windowed=False):
    directory = Path(spec_directory)
    agent = directory.parent
    repository = agent.parent
    release = runpy.run_path(str(agent / "version.py"))
    version_tuple = tuple(int(part) for part in release["APP_VERSION"].split(".")) + (0,)
    version_info = VSVersionInfo(
        ffi=FixedFileInfo(filevers=version_tuple, prodvers=version_tuple, mask=0x3f,
                          flags=0, OS=0x40004, fileType=1, subtype=0, date=(0, 0)),
        kids=[StringFileInfo([StringTable("040904B0", [
            StringStruct("CompanyName", release["PUBLISHER_DISPLAY_NAME"]),
            StringStruct("ProductName", release["APP_NAME"]),
            StringStruct("FileDescription", release["APP_DESCRIPTION"]),
            StringStruct("FileVersion", release["APP_VERSION"]),
            StringStruct("ProductVersion", release["APP_VERSION"]),
            StringStruct("OriginalFilename", "WorkPulseAgent.exe"),
            StringStruct("Comments", "Unsigned; publisher display name is not a verified legal identity."),
        ])]), VarFileInfo([VarStruct("Translation", [1033, 1200])])])
    # No directory-wide add-data: never bundle .env, local queues, logs, reports,
    # venv, test fixtures, credentials, or the frontend/backend source trees.
    datas = collect_data_files("tzdata") + collect_data_files("certifi") + collect_data_files("customtkinter")
    hidden = [
        "pynput.mouse._win32", "pynput.keyboard._win32", "pynput._util.win32",
        "pystray._win32", "psutil._psutil_windows", "pywintypes",
        "win32api", "win32con", "win32gui", "win32process", "win32security",
        "win32file", "win32crypt", "win32cryptcon", "win32cred", "ntsecuritycon",
        "agent.ui.login", "agent.ui.desktop", "agent.ui.compact", "agent.auth.client", "agent.auth.session", "agent.desktop_bootstrap", "agent.core.offline_queue", "requests", "tkinter", "tkinter.ttk", "customtkinter", "darkdetect", "PIL._tkinter_finder",
    ]
    analysis = Analysis(
        [str(agent / "start_agent.py")], pathex=[str(repository)],
        binaries=[], datas=datas, hiddenimports=hidden,
        hookspath=[], runtime_hooks=[],
        excludes=["agent.tests", "agent.performance_test", "agent.compatibility_test", "pytest"],
        noarchive=False, optimize=0,
    )
    # Enforce an explicit denylist on data destinations before packaging.
    forbidden = {".env", "venv", ".venv", "node_modules", "tests", "reports", "logs", ".git"}
    for destination, source, kind in analysis.datas:
        parts = set(Path(destination).parts)
        public_ca_bundle = Path(destination).as_posix() == "certifi/cacert.pem"
        if parts & forbidden or (Path(destination).suffix.lower() in {".sqlite3", ".pem", ".key"} and not public_ca_bundle):
            raise RuntimeError("Unexpected private/development data in the PyInstaller input manifest.")
    archive = PYZ(analysis.pure)
    options = dict(name="WorkPulseAgent", debug=False, strip=False, upx=False,
                   console=not windowed, disable_windowed_traceback=False, version=version_info)
    if onefile:
        EXE(archive, analysis.scripts, analysis.binaries, analysis.datas, [], **options)
    else:
        executable = EXE(archive, analysis.scripts, [], exclude_binaries=True, **options)
        COLLECT(executable, analysis.binaries, analysis.datas, strip=False, upx=False, name="WorkPulseAgent")
