"""Ensure report status logic cannot convert missing coverage into a pass."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from agent.compatibility_test import aggregate, EvidenceResult, host_environment


class CompatibilityReportTests(unittest.TestCase):
    def test_fail_and_missing_coverage_are_not_passes(self):
        self.assertEqual(aggregate(["PASS", "PASS"]), "PASS")
        self.assertEqual(aggregate(["PASS", "NOT TESTED"]), "NOT TESTED")
        self.assertEqual(aggregate(["NOT TESTED", "FAIL"]), "FAIL")
        self.assertEqual(aggregate([]), "NOT TESTED")

    def test_skip_is_not_tested_and_error_is_fail_without_exception_payload(self):
        result = EvidenceResult()
        result.addSkip(self, "private reason")
        self.assertEqual(result.evidence[0]["status"], "NOT TESTED")
        self.assertNotIn("private", str(result.evidence))

    def test_windows_10_and_11_are_distinguished_by_actual_workstation_build(self):
        with patch("agent.compatibility_test.sys.platform", "win32"):
            for build, name in ((19045, "Windows 10"), (26200, "Windows 11")):
                version = SimpleNamespace(build=build, product_type=1, major=10, minor=0)
                with patch("agent.compatibility_test.sys.getwindowsversion", return_value=version):
                    self.assertEqual(host_environment()["os"], name)
            version.product_type = 3
            with patch("agent.compatibility_test.sys.getwindowsversion", return_value=version):
                self.assertEqual(host_environment()["os"], "Unidentified platform")


if __name__ == "__main__":
    unittest.main()
