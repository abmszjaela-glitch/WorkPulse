"""Evidence-based Windows compatibility report, never an OS-support assertion.

python -m agent.compatibility_test [--native-tray-smoke] [--performance]
Unit tests include real synthetic SQLite/DPAPI/ACL/Credential Manager operations.
Startup registry writes remain mocked; native tray smoke opens PAUSED and exits.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
from threading import Timer
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent
STATUSES = frozenset({"PASS", "FAIL", "NOT TESTED"})


def host_environment():
    data = {"python": platform.python_version(), "architecture": platform.machine(),
            "os": "Unidentified platform", "windows_build": None, "windows_product_type": None}
    if sys.platform == "win32":
        version = sys.getwindowsversion()
        data.update(windows_build=version.build, windows_product_type=version.product_type,
                    windows_version=f"{version.major}.{version.minor}.{version.build}")
        # Workstation kernel versions share major=10; distinguish by build and
        # product type, never by a runner label such as 'windows-latest'.
        if version.product_type == 1 and version.major == 10:
            data["os"] = "Windows 11" if version.build >= 22000 else "Windows 10"
    return data


def aggregate(statuses):
    statuses = list(statuses)
    if "FAIL" in statuses:
        return "FAIL"
    if not statuses or "NOT TESTED" in statuses:
        return "NOT TESTED"
    return "PASS"


class EvidenceResult(unittest.TestResult):
    """Keep test IDs/status only in the artifact, never exception payloads."""
    def __init__(self):
        super().__init__()
        self.evidence = []

    def _record(self, test, status, detail):
        self.evidence.append({"test": test.id(), "status": status, "detail": detail})

    def addSuccess(self, test):
        super().addSuccess(test)
        self._record(test, "PASS", "Automated assertion passed")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._record(test, "FAIL", "Assertion failed; rerun this test locally for diagnostics")

    def addError(self, test, err):
        super().addError(test, err)
        self._record(test, "FAIL", "Execution/import/setup error; no exception payload retained")

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._record(test, "NOT TESTED", "Skipped; no successful execution claimed")

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._record(test, "FAIL", "Known expected failure remains unresolved")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._record(test, "FAIL", "Unexpected success requires test review")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            # Do not write subtest parameters; they can contain synthetic secrets.
            self._record(test, "FAIL", "Subtest failed; parameters omitted")


def native_tray_smoke():
    from .config import config
    from .ui.tray import WorkPulseTray
    # Real native icon and event loop, not a mocked Icon; no tracking starts.
    with tempfile.TemporaryDirectory(prefix=".compatibility-test-", dir=ROOT / "tests") as directory:
        with patch.object(config, "LOG_DIRECTORY", Path(directory) / "logs"):
            tray = WorkPulseTray()
            timer = Timer(3, lambda: tray.request("exit"))
            timer.start()
            try:
                tray.run()
                if tray._agent is not None or tray._requested or not tray._manual_stop.is_set():
                    return "FAIL"
                return "PASS" if tray.state.snapshot()[0] == "Tracking PAUSED" else "FAIL"
            finally:
                timer.cancel()


def write_report(report, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    json_path = directory / "windows-compatibility-results.json"
    markdown_path = directory / "windows-compatibility-report.md"
    json_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    env = report["environment"]
    lines = ["# WorkPulse Agent Windows compatibility execution report", "",
             f"Execution UTC: {report['executed_at_utc']}", "",
             f"Host: **{env['os']}**, build **{env['windows_build']}**, {env['architecture']}; Python **{env['python']}**.", "",
             "This records executed evidence, not blanket Windows compatibility certification.", "",
             "PASS = stated check executed successfully. FAIL = executed check failed. NOT TESTED = skipped, unavailable or not executed.", "",
             "## Platform coverage", "", "| Platform | Automated run | Full release acceptance |", "|---|---|---|"]
    for name, coverage in report["platforms"].items():
        lines.append(f"| {name} | {coverage['automated_run']} | {coverage['full_acceptance']} |")
    lines += ["", "## Executed checks and gaps", "", "| Check | Result | Evidence / scope |", "|---|---|---|"]
    for row in report["checks"]:
        lines.append(f"| {row['check']} | {row['status']} | {row['detail']} |")
    lines += ["", "## Automated module results", "", "| Test module | Result | PASS | FAIL | NOT TESTED |", "|---|---|---:|---:|---:|"]
    for module, values in report["unit_modules"].items():
        counts = Counter(entry["status"] for entry in values)
        lines.append(f"| {module} | {aggregate(entry['status'] for entry in values)} | {counts['PASS']} | {counts['FAIL']} | {counts['NOT TESTED']} |")
    lines += ["", f"unittest testsRun: **{report['unit_tests_run']}**. Per-test evidence is in the JSON; subtest failures can produce additional evidence rows.", "",
              "## Interpretation", "",
              "Mouse/keyboard/foreground/counter/idle/usage/agent orchestration unit tests use controlled input and mocks. They do not prove physical input capture or cross-application behavior.",
              "Queue tests execute real temporary SQLite, Windows DPAPI and ACL operations with synthetic records. Credential storage includes a real synthetic Windows Credential Manager round trip. They do not prove backend authentication.",
              "Startup registry modifications are mocked. Native startup enable/disable, real sign-out/reboot, security-product interactions, tray menu UX and clean-machine installation require the manual plan.",
              "Backend authentication and synchronization are unavailable in this checkout. Their end-to-end results are NOT TESTED, even though supporting UI/cache/queue tests pass.",
              "Native tray smoke covers icon/event-loop creation, paused startup and exit only; it does not verify every menu/notification or Explorer restart.",
              "Performance results cover short controlled native-listener workloads with discarded OS input, synthetic counters and fixed foreground app. No unrelated employee process is inspected. See performance-report.md for metrics and limits.",
              "Only the current OS build, architecture and interpreter were executed. Other Windows/Python/build combinations remain NOT TESTED.", "",
              "Full acceptance remains **NOT TESTED** until the plan's integration/manual matrix is executed on both target OS versions."]
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return markdown_path


def main():
    parser = argparse.ArgumentParser(description="Run Windows compatibility checks with explicit evidence scope.")
    parser.add_argument("--native-tray-smoke", action="store_true", help="Display a real paused tray icon for three seconds")
    parser.add_argument("--performance", action="store_true", help="Run the controlled resource/listener benchmark")
    parser.add_argument("--output", type=Path, default=ROOT / "reports")
    options = parser.parse_args()
    report = {"executed_at_utc": datetime.now(timezone.utc).isoformat(), "environment": host_environment(),
              "checks": [], "unit_modules": {}, "unit_tests_run": 0}
    def check(name, status, detail):
        report["checks"].append({"check": name, "status": status, "detail": detail})
    print("Visible compatibility test: synthetic test data only; no startup registration or backend uploads.", flush=True)
    packages = ("psutil", "pynput", "pywin32", "requests", "pystray", "Pillow", "tzdata")
    versions = {}
    for package in packages:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    report["dependency_versions"] = versions
    check("Installed required packages", "PASS" if all(versions.values()) else "FAIL", "Metadata for the required agent packages; does not replace clean installation testing")
    try:
        pip = subprocess.run([sys.executable, "-m", "pip", "check"], capture_output=True, timeout=60)
        check("Python dependency consistency", "PASS" if pip.returncode == 0 else "FAIL", "Executed python -m pip check in the current environment")
    except (OSError, subprocess.TimeoutExpired):
        check("Python dependency consistency", "FAIL", "pip check could not complete")
    print("Running automated unit and synthetic Windows storage tests...", flush=True)
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
    result = EvidenceResult()
    suite.run(result)
    report["unit_tests_run"] = result.testsRun
    for entry in result.evidence:
        module = entry["test"].split(".")[0]
        report["unit_modules"].setdefault(module, []).append(entry)
    unit_status = aggregate(entry["status"] for entry in result.evidence)
    check("Automated suite", unit_status, f"{result.testsRun} unittest cases executed; detailed scope and outcomes below")
    tray_status = "NOT TESTED"
    if options.native_tray_smoke:
        print("Opening native WorkPulse tray PAUSED; automatic exit in three seconds...", flush=True)
        try:
            tray_status = native_tray_smoke()
        except Exception:
            tray_status = "FAIL"
    check("Native tray create / paused launch / exit", tray_status, "Real Windows event loop only when explicitly requested; no tracking listeners started")
    performance_status = "NOT TESTED"
    if options.performance:
        print("Running process-only native-listener performance benchmark...", flush=True)
        try:
            from .config import config
            timeout = 3 * config.PERF_PHASE_SECONDS + 10 * config.PERF_LIFECYCLE_CYCLES + 120
            measured = subprocess.run([sys.executable, "-B", "-m", "agent.performance_test"], cwd=ROOT.parent,
                                      capture_output=True, timeout=timeout)
            performance_status = "PASS" if measured.returncode == 0 else "FAIL"
            # Load only the freshly generated evidence from this invocation.
            path = config.PERF_REPORT_DIRECTORY / "performance-results.json"
            if path.is_file():
                evidence = json.loads(path.read_text(encoding="utf-8"))
                if evidence["started_at_utc"] >= report["executed_at_utc"]:
                    report["performance"] = evidence
                else:
                    performance_status = "FAIL"
            else:
                performance_status = "FAIL"
        except Exception:
            performance_status = "FAIL"
    check("Controlled CPU/RSS/listener lifecycle benchmark", performance_status, "Only a fresh benchmark from this invocation counts; real backend synchronization remains unmeasured")
    for name, detail in (
        ("Clean Python installation", "Existing venv tested; clean VM setup not executed"),
        ("Physical mouse/keyboard counters", "Unit tests use fabricated callback events; actual hardware/lock-screen cases not executed"),
        ("Real foreground application switches", "Unit tests mock window/process calls; native benchmark substitutes a fixed app name"),
        ("Real application usage and idle transitions", "Controlled unit tests pass/fail separately; physical cross-app timing requires manual execution"),
        ("Backend employee login and verified JWT", "Backend auth endpoints/verification contract are absent; UI/cache tests are support only"),
        ("Backend synchronization/retries/idempotency", "Sender/upload contract unavailable; no successful upload claimed"),
        ("Complete tray UX and emergency control", "Native smoke is limited; manual menu, Explorer restart and visibility checks not executed"),
        ("Actual startup Run registration and reboot", "Registry writes mocked; no real startup entry enabled"),
        ("Packaged executable installation", "No packaged installer/executable supplied"),
        ("Sleep/resume/Explorer/network fault recovery", "Unit error paths tested separately; real OS transitions not executed"),
        ("Long-duration memory/thread soak", "Short controlled cycles cannot prove leak absence"),
    ):
        check(name, "NOT TESTED", detail)
    report["platforms"] = {}
    for target in ("Windows 10", "Windows 11"):
        report["platforms"][target] = {
            "automated_run": unit_status if report["environment"]["os"] == target else "NOT TESTED",
            "full_acceptance": "NOT TESTED"}
    print(write_report(report, options.output), flush=True)
    return int(any(row["status"] == "FAIL" for row in report["checks"]))


if __name__ == "__main__":
    raise SystemExit(main())
