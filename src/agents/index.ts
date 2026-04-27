// ── Agent Index ─────────────────────────────────────────────────────────────────
// Public exports for all agent modules

// Types
export * from './types.js';

// Shared Memory
export { SharedMemory, sharedMemory } from './shared-memory.js';

// Individual Agents
export {
  runDemandSignalAgent,
  startDemandSignalCron,
  stopDemandSignalCron,
  demandSignalAgentConfig,
  getMerchantDemand,
} from './demand-signal-agent.js';

export {
  runScarcityAgent,
  startScarcityCron,
  stopScarcityCron,
  scarcityAgentConfig,
  updateInventory,
  getScarcityForDemandSignal,
} from './scarcity-agent.js';

export {
  runPersonalizationAgent,
  startPersonalizationCron,
  stopPersonalizationCron,
  personalizationAgentConfig,
  processNudgeEvent,
  selectOptimalVariant,
  getUserPersonalizationProfile,
  analyzeABTestResults,
} from './personalization-agent.js';

export {
  runAttributionAgent,
  startAttributionCron,
  stopAttributionCron,
  attributionAgentConfig,
  recordTouchpoint,
  calculateAttribution,
  detectOrganicVsInfluenced,
  calculateIncrementality,
} from './attribution-agent.js';

export {
  runAdaptiveScoringAgent,
  startAdaptiveScoringCron,
  stopAdaptiveScoringCron,
  adaptiveScoringAgentConfig,
  scoreIntentById,
  scoreIntents,
  retrainModel,
  getCurrentWeights,
} from './adaptive-scoring-agent.js';

export {
  runFeedbackLoopAgent,
  startFeedbackLoopCron,
  stopFeedbackLoopCron,
  feedbackLoopAgentConfig,
  handleAlert,
  getAgentHealth,
} from './feedback-loop-agent.js';

export {
  runNetworkEffectAgent,
  startNetworkEffectCron,
  stopNetworkEffectCron,
  networkEffectAgentConfig,
  findSimilarUsers,
  getCollaborativeRecommendations,
  generateCollaborativeSignal,
  getCollaborativeSignalForUser,
  triggerCohortCampaign,
} from './network-effect-agent.js';

export {
  runRevenueAttributionAgent,
  startRevenueAttributionCron,
  stopRevenueAttributionCron,
  revenueAttributionAgentConfig,
  generateRevenueReport,
  getLatestReport,
} from './revenue-attribution-agent.js';

// Swarm Coordinator
export {
  SwarmCoordinator,
  getSwarmCoordinator,
  startAllAgents,
  stopAllAgents,
  getSwarmStatus,
  runAgent,
  runAllAgentsOnce,
  enableDangerousMode,
  disableDangerousMode,
  enableFullAutonomy,
  emergencyStop,
  isDangerousModeEnabled,
} from './swarm-coordinator.js';

// Autonomous Orchestrator
export {
  AutonomousOrchestrator,
  getAutonomousOrchestrator,
  startAutonomousMode,
  stopAutonomousMode,
  executeAutonomousAction,
} from './autonomous-orchestrator.js';

// Action Trigger
export {
  actionExecutor,
  handleDemandSignalAction,
  handleScarcitySignalAction,
  handleOptimizationAction,
  triggerAutoRevival,
} from './action-trigger.js';

// Types re-exports
export type {
  DemandSignal,
  ScarcitySignal,
  UserResponseProfile,
  AttributionRecord,
  ScoredIntent,
  OptimizationRecommendation,
  CollaborativeSignal,
  RevenueReport,
  Touchpoint,
  AgentConfig,
  AgentResult,
  AgentHealth,
  AgentMessage,
} from './types.js';

// Re-export NudgeVariant as type
export type { NudgeVariant } from './types.js';

// Dangerous mode config type
export type { DangerousModeConfig } from './swarm-coordinator.js';

// Support Agent
export {
  runSupportAgent,
  supportAgentConfig,
  handleSupportRequest,
  getSupportStats,
} from './support-agent.js';

export type {
  SupportCategory,
  SupportRequest,
  SupportResponse,
  SupportAction,
  EscalationRequest,
} from './support-agent.js';
