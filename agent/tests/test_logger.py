"""Temporary-directory rotation/privacy/failure tests; never log real credentials."""
import io
import logging
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from agent.utils import logger


class LoggerTests(unittest.TestCase):
    def setUp(self):
        logger.shutdown_logging()
        temporary = tempfile.TemporaryDirectory(prefix=".logger-test-", dir=Path(__file__).parent)
        self.directory = Path(temporary.name)
        self.addCleanup(temporary.cleanup)
        self.addCleanup(logger.shutdown_logging)
        for key, value in (("LOG_DIRECTORY", self.directory), ("LOG_MAX_BYTES", 1024),
                           ("LOG_BACKUP_COUNT", 2), ("LOG_LEVEL", "DEBUG"), ("LOG_REPEAT_SECONDS", 30)):
            setting = patch.object(logger.config, key, value)
            setting.start()
            self.addCleanup(setting.stop)

    def contents(self):
        return "".join(path.read_text(encoding="utf-8") for path in self.directory.glob("workpulse.log*"))

    def test_reusable_idempotent_configuration_and_standard_levels(self):
        self.assertTrue(logger.configure_logging())
        self.assertTrue(logger.configure_logging())
        log = logger.get_logger()
        self.assertIsInstance(log, logging.Logger)
        self.assertEqual(sum(isinstance(h, logger._SafeRotatingHandler) for h in log.handlers), 1)
        log.debug("logging_configured")
        log.info("application_started")
        log.warning("sync_offline")
        log.error("tracking_error")
        text = self.contents()
        for level in ("DEBUG", "INFO", "WARNING", "ERROR"):
            self.assertIn(level, text)
        self.assertIn("Application started", text)
        self.assertRegex(text, r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")

    def test_credentials_content_exceptions_and_untrusted_objects_never_render(self):
        logger.configure_logging()
        log = logger.get_logger()
        secret = "fabricated-password-token-personal-content"
        log.info(secret)
        log.warning("application_started", secret)
        log.error("application_error", extra={"jwt": secret, "email": secret})
        try:
            raise RuntimeError(secret)
        except RuntimeError:
            log.exception("application_error")
        log.error("application_error", stack_info=True)
        class Sensitive:
            def __str__(self):
                raise AssertionError("Untrusted object must never render")
        log.error(Sensitive())
        self.assertNotIn(secret, self.contents())
        self.assertNotIn("Traceback", self.contents())
        self.assertNotIn("Stack", self.contents())
        self.assertIn("Application failed", self.contents())

    def test_rotation_keeps_bounded_number_of_backups(self):
        logger.configure_logging()
        for _ in range(100):
            logger.get_logger().info("tracking_on")
        files = list(self.directory.glob("workpulse.log*"))
        self.assertEqual(len(files), 3)
        self.assertTrue(all(path.stat().st_size <= 1024 for path in files))

    def test_repeated_errors_are_throttled_without_throttling_state_transitions(self):
        logger.configure_logging()
        with patch("agent.utils.logger.monotonic", side_effect=[1, 2, 32]):
            for _ in range(3):
                logger.get_logger().error("sync_failed")
        for _ in range(2):
            logger.get_logger().info("tracking_paused")
        self.assertEqual(self.contents().count("Synchronization failed"), 2)
        self.assertEqual(self.contents().count("Tracking PAUSED"), 2)

    def test_directory_failure_is_safe_and_does_not_reveal_exception_or_path(self):
        stream = io.StringIO()
        with patch.object(Path, "mkdir", side_effect=PermissionError("private path/token")), patch("sys.stderr", stream):
            self.assertFalse(logger.configure_logging())
            self.assertFalse(logger.configure_logging())
        self.assertEqual(stream.getvalue().count("file logging is unavailable"), 1)
        self.assertNotIn("private", stream.getvalue())

    def test_disk_failure_opens_circuit_without_tracebacks_or_repeated_io(self):
        logger.configure_logging()
        handler = next(h for h in logger.get_logger().handlers if isinstance(h, logger._SafeRotatingHandler))
        stream = io.StringIO()
        with patch.object(handler, "shouldRollover", side_effect=OSError("private disk detail")) as rollover, patch("sys.stderr", stream):
            logger.get_logger().error("application_error")
            logger.get_logger().error("application_error")
        self.assertEqual(rollover.call_count, 1)
        self.assertTrue(handler.failed)
        self.assertNotIn("private", stream.getvalue())
        self.assertNotIn("Traceback", stream.getvalue())
        self.assertFalse(logger.configure_logging())

    def test_root_handlers_do_not_receive_workpulse_events(self):
        logger.configure_logging()
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        logging.getLogger().addHandler(handler)
        try:
            logger.get_logger().error("application_error")
        finally:
            logging.getLogger().removeHandler(handler)
            handler.close()
        self.assertEqual(stream.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
