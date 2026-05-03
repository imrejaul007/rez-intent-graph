// ── ReZ Mind ───────────────────────────────────────────────────────────────────
// AI-powered commerce intelligence platform
// RTMN Commerce Memory + ReZ Agent OS combined

// Core types (from types file, avoiding conflicts with Mongoose models)
export type { IntentStatus, AppType, Category, EventType, IntentSignalWeight } from './types/intent.js';
export { SIGNAL_WEIGHTS, BASE_CONFIDENCE, DORMANCY_THRESHOLD_DAYS, CONFIDENCE_DORMANT_THRESHOLD } from './types/intent.js';

// ── MongoDB Models ────────────────────────────────────────────────────────────
export * from './models/index.js';

// Services
export { IntentCaptureService, intentCaptureService } from './services/IntentCaptureService.js';
export { DormantIntentService, dormantIntentService } from './services/DormantIntentService.js';
export { CrossAppAggregationService, crossAppAggregationService } from './services/CrossAppAggregationService.js';
export { MerchantKnowledgeService, merchantKnowledgeService } from './services/MerchantKnowledgeService.js';
export { AutonomousChatService, autonomousChatService } from './chat/autonomousChat.js';

// QR Services temporarily disabled - requires @rez/shared-types package
// export { QRContextService, qrContextService } from './services/qrContextService.js';
// export { RecommendationTriggersService, recommendationTriggersService } from './services/recommendationTriggers.js';

// Types from merchant knowledge service
export type { KnowledgeType, KnowledgeEntry, ChatContext } from './services/MerchantKnowledgeService.js';
export type { QRKnowledgeEntry, QRChatContext } from './services/MerchantKnowledgeService.js';

// QR Types temporarily disabled
// export type { QRIntentRecord, QRContextEnrichment, CaptureQRResult } from './services/qrContextService.js';
// export type { RecommendationTrigger, Recommendation, TriggerCondition, TriggeredRecommendation, TriggerResult } from './services/recommendationTriggers.js';

// API Routes
export { default as intentRouter } from './api/intent.routes.js';
export { default as commerceMemoryRouter } from './api/commerce-memory.routes.js';
// QR routes temporarily disabled - requires @rez/shared-types
// export { default as qrRouter } from './api/qr.routes.js';

// Middleware
export { intentCaptureMiddleware } from './middleware/intentMiddleware.js';
