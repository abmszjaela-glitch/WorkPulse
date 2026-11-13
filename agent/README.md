# Foreground activity agent

From the repository root, start the agent explicitly in a visible terminal:

```powershell
.\agent\venv\Scripts\python.exe -m agent.core.agent
```

Alternatively, from the `agent` directory, use `python -m core.agent` with the
virtual environment activated. Importing the module does not start tracking.

The agent announces when tracking starts, prints cumulative mouse movement,
mouse click and anonymous key press counts with `ACTIVE`/`IDLE` status, and prints
a final summary on normal shutdown. It stores no coordinates, individual keys,
typed text or screenshots. Counts stay in memory; no API requests, persistent
files, services or autostart entries are created.

Set `TRACKING_INTERVAL` and `IDLE_THRESHOLD` environment variables (seconds) before
launch to override the defaults in `config/config.py`.

Press **Ctrl+C** to request shutdown. The CLI also handles SIGTERM. Embedded
callers can use `ActivityAgent.stop()` to interrupt the reporting wait. Both
listeners are stopped in cleanup, including when startup or reporting fails.
Listener shutdown is bounded; failures are reported with a nonzero exit code.
Forced process termination or operating-system failure cannot guarantee cleanup.

`ActivityAgent.run()` blocks the calling thread and creates no reporting thread.
Create a new agent instance for a fresh run after stopping an existing instance.

Run the synthetic test suite without recording real input:

```powershell
.\agent\venv\Scripts\python.exe -B -m unittest discover -s agent/tests -p "test_*.py" -v
```
