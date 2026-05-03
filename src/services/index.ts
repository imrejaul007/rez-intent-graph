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

export { insightService, generateInsights, getInsights } from './insightService.js';
export type { Insight } from './insightService.js';

// QRContextService and RecommendationTriggersService temporarily disabled due to missing dependencies
// export { QRContextService, qrContextService } from './qrContextService.js';
// export type { QRIntentRecord, QRContextEnrichment, CaptureQRResult } from './qrContextService.js';

// export { RecommendationTriggersService, recommendationTriggersService } from './recommendationTriggers.js';
// export type { RecommendationTrigger, Recommendation, TriggerCondition, TriggeredRecommendation, TriggerResult } from './recommendationTriggers.js';
