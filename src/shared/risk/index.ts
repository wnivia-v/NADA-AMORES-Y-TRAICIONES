// =============================================================================
// Motor de riesgo — API publica
// =============================================================================

export { FusionEngine, getFusionEngine, clearLane, clearAllLanes } from './fusionEngine';
export type { RiskLane } from './fusionEngine';
export {
  DEFAULT_FUSION_CONFIG,
  EXPLICIT_THREAT_CATEGORIES,
  isExplicitThreatCategory,
} from './config';
export type { FusionConfig, ExplicitThreatCategory } from './config';
export type {
  RiskSignal,
  SignalType,
  RiskBand,
  FusionResult,
  SignalContribution,
} from './types';
