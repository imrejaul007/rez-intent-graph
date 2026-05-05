/**
 * MongoDB Models Index
 * ReZ Mind - Intent Graph
 */

export { Intent } from './Intent.js';
export { DormantIntent } from './DormantIntent.js';
export { IntentSequence } from './IntentSequence.js';
export { CrossAppIntentProfile } from './CrossAppIntentProfile.js';
export { MerchantKnowledge } from './MerchantKnowledge.js';
export { Nudge } from './Nudge.js';
export { MerchantDemandSignal } from './MerchantDemandSignal.js';
export { NudgeSchedule } from './NudgeSchedule.js';

// Fraud Prevention Models
export {
  CashbackRequest,
  FraudReport,
  UserRiskProfile,
  RewardChainNode,
  FraudConfig,
  seedFraudConfig,
  DEFAULT_FRAUD_THRESHOLDS,
} from './CashbackFraud.js';
export type {
  ICashbackRequestDocument,
  IFraudReportDocument,
  IFraudFlag,
  IUserRiskProfileDocument,
  IRewardChainNodeDocument,
  IFraudConfigDocument,
  FraudFlagType,
  FraudSeverity,
  FraudAction,
} from './CashbackFraud.js';

export type {
  IIntent,
  IIntentSignal,
} from './Intent.js';
export type {
  IDormantIntent,
} from './DormantIntent.js';

export { connectDB, disconnectDB, getConnectionStatus } from '../database/mongodb.js';
