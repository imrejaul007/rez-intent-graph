/**
 * Services Index
 * ReZ Mind - Intent Graph
 */

export { IntentCaptureService, intentCaptureService } from './IntentCaptureService.js';
export type { CaptureIntentParams, CaptureResult } from './IntentCaptureService.js';

export { DormantIntentService, dormantIntentService } from './DormantIntentService.js';
export type { RevivalCandidate } from './DormantIntentService.js';

export { CrossAppAggregationService, crossAppAggregationService } from './CrossAppAggregationService.js';
export type { UserAffinityProfile, EnrichedContext } from './CrossAppAggregationService.js';

export { MerchantKnowledgeService, merchantKnowledgeService } from './MerchantKnowledgeService.js';
export type { KnowledgeEntry, ChatContext } from './MerchantKnowledgeService.js';

export { insightService, generateInsights, getInsights } from './insightService.js';
export type { Insight } from './insightService.js';
