import './environment.js';

export function loadMonitoringConfig() {
  const integer = (name, fallback, max) => {
    const value = Number(process.env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  return Object.freeze({
    maxBatchSize: integer('MONITORING_MAX_BATCH_SIZE',100,500),
    maxRecordBytes: integer('MONITORING_MAX_RECORD_BYTES',262144,1048576),
    maxAgeDays: integer('MONITORING_MAX_AGE_DAYS',30,365),
    maxIntervalSeconds: integer('MONITORING_MAX_INTERVAL_SECONDS',86400,604800),
    futureSkewSeconds: integer('MONITORING_FUTURE_SKEW_SECONDS',300,3600),
    clockToleranceSeconds: integer('MONITORING_CLOCK_TOLERANCE_SECONDS',5,60),
    offlineTimeoutSeconds: integer('DEVICE_OFFLINE_TIMEOUT_SECONDS',300,86400),
    requestsPerMinute: integer('MONITORING_REQUESTS_PER_MINUTE',120,6000),
  });
}
