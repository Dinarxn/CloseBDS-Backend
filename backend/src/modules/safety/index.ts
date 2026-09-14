/**
 * Module Boundary: Safety Controls
 * Daily cap enforcement, velocity throttles, and Global Kill Switch verification.
 */
export interface SafetyGatePolicy {
  maxDailyProspectsPerCampaign: number; // MVP cap default: 50
  minIntervalBetweenSendsMs: number;
  killSwitchActive: boolean;
}
