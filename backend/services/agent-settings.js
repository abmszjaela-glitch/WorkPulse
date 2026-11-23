import {ApiError} from '../utils/api-error.js';

// Reuse the authorized agent-config RPC result; do not query settings twice.
export function createAgentSettings(fallback) {
  return (result) => {
    const sections=result.settings||{};
    const monitoring=sections.monitoring, hours=sections.workingHours;
    if(!monitoring||!hours)throw new ApiError(503,'Configure monitoring and working hours before connecting devices');
    return {...fallback,idleThreshold:monitoring.idleMinutes*60,trackingInterval:monitoring.evaluationSeconds,
      syncInterval:monitoring.syncMinutes*60,trackApplications:monitoring.trackApplications,
      trackKeyboardCounts:monitoring.trackKeyboardCounts,trackMouseCounts:monitoring.trackMouseCounts,
      offlineDays:monitoring.offlineDays,
      workingHours:hours,requireConsent:true,manualStopOverridesSchedule:true};
  };
}
