"""Queue errors deliberately exclude database paths, payloads and credentials."""


class QueueError(RuntimeError):
    """A queue operation failed without acknowledging or discarding pending data."""


class QueueSecurityError(QueueError):
    """Required Windows storage protection could not be established."""


class QueueValidationError(QueueError, ValueError):
    """A record is not an allowed aggregate activity summary."""


class QueueFullError(QueueError):
    """The bounded queue cannot accept another record without losing pending data."""


class QueueConflictError(QueueError):
    """A record ID or interval identity conflicts with previously queued data."""


class QueueRetentionError(QueueError):
    """An interval is already beyond the configured retention period."""
