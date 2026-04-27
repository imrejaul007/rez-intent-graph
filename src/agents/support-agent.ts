// ── Support Agent ────────────────────────────────────────────────────────────────
// Unified support agent for all ReZ apps
// Handles: retrieval, troubleshooting, policy reasoning, escalation, guided education
// DANGEROUS: Can execute operational actions (tickets, refunds, escalations)

import { sharedMemory } from './shared-memory.js';
import { actionExecutor } from './action-trigger.js';
import type { AgentConfig, AgentResult } from './types.js';

const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[SupportAgent] ${msg}`, meta || ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[SupportAgent] ${msg}`, meta || ''),
  error: (msg: string, meta?: unknown) => console.error(`[SupportAgent] ${msg}`, meta || ''),
};

// ── Agent Configuration ────────────────────────────────────────────────────────

export const supportAgentConfig: AgentConfig = {
  name: 'support-agent',
  intervalMs: 0, // Event-driven, not cron
  enabled: true,
  priority: 'critical',
};

// ── Support Categories ─────────────────────────────────────────────────────────

export type SupportCategory =
  | 'hotel_ota'
  | 'room_qr'
  | 'rez_consumer'
  | 'web_menu'
  | 'merchant_os'
  | 'karma'
  | 'rendez'
  | 'adbazaar'
  | 'nextabiz';

// ── Support Request ────────────────────────────────────────────────────────────

export interface SupportRequest {
  category: SupportCategory;
  userId: string;
  message: string;
  context?: Record<string, unknown>;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface SupportResponse {
  success: boolean;
  message: string;
  actions?: SupportAction[];
  escalation?: EscalationRequest;
  data?: Record<string, unknown>;
}

export interface SupportAction {
  type: 'ticket' | 'refund' | 'status_update' | 'notification' | 'lookup';
  payload: Record<string, unknown>;
}

export interface EscalationRequest {
  reason: string;
  department: string;
  priority: 'medium' | 'high' | 'critical';
  metadata: Record<string, unknown>;
}

// ── Support Scenarios by App ─────────────────────────────────────────────────

const SUPPORT_SCENARIOS: Record<SupportCategory, SupportScenario[]> = {
  hotel_ota: [
    {
      id: 'late_checkin',
      patterns: ['late check-in', 'arrive late', 'delayed', 'arriving late'],
      handler: 'handleLateCheckin',
      priority: 'medium',
    },
    {
      id: 'refund_cancellation',
      patterns: ['cancel', 'refund', 'cancellation policy', 'how much refund'],
      handler: 'handleRefundCancellation',
      priority: 'high',
    },
    {
      id: 'room_complaint',
      patterns: ['ac not cooling', 'ac broken', 'room complaint', 'room issue', 'problem with room'],
      handler: 'handleRoomComplaint',
      priority: 'high',
    },
    {
      id: 'booking_confusion',
      patterns: ['booking confusion', 'two rooms', 'breakfast included', 'did i book'],
      handler: 'handleBookingConfusion',
      priority: 'low',
    },
    {
      id: 'local_concierge',
      patterns: ['pharmacy near', 'restaurant near', 'concierge', 'recommend', 'nearby'],
      handler: 'handleLocalConcierge',
      priority: 'low',
    },
  ],

  room_qr: [
    {
      id: 'wifi_troubleshooting',
      patterns: ['wifi', 'wi-fi', 'connect to internet', 'internet not working'],
      handler: 'handleWifiTroubleshooting',
      priority: 'medium',
    },
    {
      id: 'housekeeping_followup',
      patterns: ['towels', 'housekeeping', 'hour ago', 'still waiting', 'requested'],
      handler: 'handleHousekeepingFollowup',
      priority: 'high',
    },
    {
      id: 'billing_question',
      patterns: ['charged', 'billing', 'minibar', 'why was i charged', 'dispute'],
      handler: 'handleBillingQuestion',
      priority: 'high',
    },
    {
      id: 'amenity_guidance',
      patterns: ['spa included', 'gym access', 'pool', 'amenity', 'package'],
      handler: 'handleAmenityGuidance',
      priority: 'low',
    },
    {
      id: 'emergency_assistance',
      patterns: ['emergency', 'doctor', 'ambulance', 'police', 'security', 'help'],
      handler: 'handleEmergencyAssistance',
      priority: 'critical',
    },
  ],

  rez_consumer: [
    {
      id: 'cashback_missing',
      patterns: ['cashback not showing', 'cashback missing', 'coins not credited', 'missing coins'],
      handler: 'handleCashbackMissing',
      priority: 'high',
    },
    {
      id: 'coins_expiry',
      patterns: ['coins expire', 'expiry', 'when do coins expire', 'balance'],
      handler: 'handleCoinsExpiry',
      priority: 'low',
    },
    {
      id: 'order_tracking',
      patterns: ['order late', 'delivery late', 'where is my order', 'order tracking'],
      handler: 'handleOrderTracking',
      priority: 'high',
    },
    {
      id: 'app_guidance',
      patterns: ['how to use', 'how do i', 'explain', 'tutorial', 'guide'],
      handler: 'handleAppGuidance',
      priority: 'low',
    },
    {
      id: 'fraud_report',
      patterns: ['fraud', 'unauthorized', 'didnt make', 'suspicious', 'unusual'],
      handler: 'handleFraudReport',
      priority: 'critical',
    },
  ],

  web_menu: [
    {
      id: 'dietary_guidance',
      patterns: ['gluten', 'allergen', 'dietary', 'vegetarian', 'vegan', 'contains'],
      handler: 'handleDietaryGuidance',
      priority: 'medium',
    },
    {
      id: 'order_modification',
      patterns: ['remove', 'modify', 'change order', 'customize', 'no onion'],
      handler: 'handleOrderModification',
      priority: 'medium',
    },
    {
      id: 'wrong_order',
      patterns: ['wrong dish', 'incorrect order', 'got wrong', 'mistake'],
      handler: 'handleWrongOrder',
      priority: 'high',
    },
    {
      id: 'wait_time',
      patterns: ['wait time', 'table wait', 'how long', 'waiting'],
      handler: 'handleWaitTime',
      priority: 'low',
    },
    {
      id: 'bill_split',
      patterns: ['split bill', 'divide', 'separate bills', 'pay separately'],
      handler: 'handleBillSplit',
      priority: 'medium',
    },
  ],

  merchant_os: [
    {
      id: 'pos_help',
      patterns: ['printer not syncing', 'pos issue', 'register', 'terminal'],
      handler: 'handlePosHelp',
      priority: 'medium',
    },
    {
      id: 'settlement_question',
      patterns: ['payout', 'settlement', 'when will i get paid', 'withdrawal'],
      handler: 'handleSettlementQuestion',
      priority: 'high',
    },
    {
      id: 'campaign_guidance',
      patterns: ['create campaign', 'cashback offer', 'how to create', 'campaign help'],
      handler: 'handleCampaignGuidance',
      priority: 'medium',
    },
    {
      id: 'inventory_error',
      patterns: ['inventory not updating', 'stock wrong', 'items', 'out of stock'],
      handler: 'handleInventoryError',
      priority: 'medium',
    },
    {
      id: 'complaint_guidance',
      patterns: ['negative review', 'customer complaint', 'handle complaint', 'bad review'],
      handler: 'handleComplaintGuidance',
      priority: 'high',
    },
  ],

  karma: [
    {
      id: 'points_missing',
      patterns: ['points not credited', 'missing points', 'challenge points', 'didnt get points'],
      handler: 'handlePointsMissing',
      priority: 'high',
    },
    {
      id: 'tier_benefits',
      patterns: ['tier benefits', 'gold tier', 'platinum', 'what does tier include'],
      handler: 'handleTierBenefits',
      priority: 'low',
    },
    {
      id: 'challenge_help',
      patterns: ['challenge help', 'how to complete', 'mission', 'stuck on challenge'],
      handler: 'handleChallengeHelp',
      priority: 'medium',
    },
    {
      id: 'redemption_issue',
      patterns: ['reward code failed', 'redemption', 'coupon not working', 'cant redeem'],
      handler: 'handleRedemptionIssue',
      priority: 'high',
    },
    {
      id: 'anti_abuse',
      patterns: ['reward blocked', 'account blocked', 'suspended', 'why blocked'],
      handler: 'handleAntiAbuse',
      priority: 'critical',
    },
  ],

  rendez: [
    {
      id: 'safety_report',
      patterns: ['report user', 'safety', 'harassment', 'inappropriate', 'block'],
      handler: 'handleSafetyReport',
      priority: 'critical',
    },
    {
      id: 'booking_help',
      patterns: ['booking not showing', 'reservation missing', 'where is my booking'],
      handler: 'handleBookingHelp',
      priority: 'high',
    },
    {
      id: 'profile_guidance',
      patterns: ['improve profile', 'better matches', 'profile tips', 'how to get more'],
      handler: 'handleProfileGuidance',
      priority: 'low',
    },
    {
      id: 'gift_delivery',
      patterns: ['gift not arrived', 'delivery problem', 'gift issue'],
      handler: 'handleGiftDelivery',
      priority: 'high',
    },
    {
      id: 'date_cancellation',
      patterns: ['cancel date', 'cancellation', 'cant make it'],
      handler: 'handleDateCancellation',
      priority: 'medium',
    },
  ],

  adbazaar: [
    {
      id: 'campaign_underperforming',
      patterns: ['campaign low', 'impressions low', 'not performing', 'underperforming'],
      handler: 'handleCampaignUnderperforming',
      priority: 'high',
    },
    {
      id: 'ad_rejection',
      patterns: ['ad rejected', 'rejected', 'why rejected', 'ad not approved'],
      handler: 'handleAdRejection',
      priority: 'high',
    },
    {
      id: 'budget_overspend',
      patterns: ['overspend', 'over budget', 'exceeded cap', 'budget issue'],
      handler: 'handleBudgetOverspend',
      priority: 'high',
    },
    {
      id: 'audience_setup',
      patterns: ['target audience', 'setup audience', 'targeting', 'students'],
      handler: 'handleAudienceSetup',
      priority: 'medium',
    },
    {
      id: 'roi_explanation',
      patterns: ['which campaign', 'roi', 'performance', 'sales attribution'],
      handler: 'handleRoiExplanation',
      priority: 'medium',
    },
  ],

  nextabiz: [
    {
      id: 'invoice_error',
      patterns: ['invoice wrong', 'invoice error', 'billing issue'],
      handler: 'handleInvoiceError',
      priority: 'high',
    },
    {
      id: 'workflow_setup',
      patterns: ['workflow setup', 'automation', 'how to setup', 'configure'],
      handler: 'handleWorkflowSetup',
      priority: 'medium',
    },
    {
      id: 'vendor_payment',
      patterns: ['vendor payment', 'pay vendor', 'payment status'],
      handler: 'handleVendorPayment',
      priority: 'medium',
    },
    {
      id: 'report_interpretation',
      patterns: ['report help', 'understand report', 'what does mean', 'interpret'],
      handler: 'handleReportInterpretation',
      priority: 'low',
    },
    {
      id: 'integration_help',
      patterns: ['integration issue', 'api error', 'not syncing', 'connect'],
      handler: 'handleIntegrationHelp',
      priority: 'high',
    },
  ],
};

interface SupportScenario {
  id: string;
  patterns: string[];
  handler: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

// ── Handler Registry ───────────────────────────────────────────────────────────

type HandlerFn = (request: SupportRequest) => Promise<SupportResponse>;

const handlers: Record<string, HandlerFn> = {
  // Hotel OTA Handlers
  handleLateCheckin: async (req) => ({
    success: true,
    message: 'I\'ll check the late check-in policy for your booking and inform the front desk.',
    actions: [{ type: 'lookup', payload: { type: 'booking_policy', userId: req.userId } }],
  }),

  handleRefundCancellation: async (req) => ({
    success: true,
    message: 'Let me check your cancellation window and calculate your refund amount.',
    actions: [{ type: 'lookup', payload: { type: 'refund_estimate', userId: req.userId } }],
  }),

  handleRoomComplaint: async (req) => ({
    success: true,
    message: 'I\'m opening a maintenance ticket and will route it to engineering. Let me track the SLA.',
    actions: [
      { type: 'ticket', payload: { category: 'maintenance', userId: req.userId, priority: 'high' } },
      { type: 'notification', payload: { department: 'engineering', message: 'Room complaint - SLA tracking started' } },
    ],
  }),

  handleBookingConfusion: async (req) => ({
    success: true,
    message: 'Let me pull up your reservation details to clarify.',
    actions: [{ type: 'lookup', payload: { type: 'booking_details', userId: req.userId } }],
  }),

  handleLocalConcierge: async (req) => ({
    success: true,
    message: 'Based on your location, here are nearby recommendations...',
    data: { type: 'concierge_recommendations', location: req.context?.hotelId },
  }),

  // Room QR Handlers
  handleWifiTroubleshooting: async (req) => ({
    success: true,
    message: 'Here are the WiFi instructions for your property: Network: [HotelWiFi], Password: [Room#]. If issues persist, I\'ll open a IT ticket.',
    actions: [{ type: 'lookup', payload: { type: 'wifi_instructions', hotelId: req.context?.hotelId } }],
  }),

  handleHousekeepingFollowup: async (req) => {
    const elapsed = Date.now() - ((req.context?.requestedAt as number) || Date.now());
    if (elapsed > 30 * 60 * 1000) {
      return {
        success: true,
        message: 'Your request has exceeded SLA. I\'m escalating to the supervisor.',
        actions: [
          { type: 'notification', payload: { department: 'housekeeping', priority: 'high', message: 'SLA breach - follow up needed' } },
        ],
        escalation: { reason: 'SLA breach', department: 'supervisor', priority: 'high', metadata: req.context || {} },
      };
    }
    return {
      success: true,
      message: 'I see your request is still in progress. Estimated time remaining: 10 minutes.',
      actions: [{ type: 'lookup', payload: { type: 'service_status', requestId: req.context?.requestId } }],
    };
  },

  handleBillingQuestion: async (req) => ({
    success: true,
    message: 'Let me pull your folio details to explain the charges.',
    actions: [{ type: 'lookup', payload: { type: 'folio_details', userId: req.userId } }],
  }),

  handleAmenityGuidance: async (req) => ({
    success: true,
    message: 'Let me check your booking entitlements.',
    actions: [{ type: 'lookup', payload: { type: 'booking_entitlements', userId: req.userId } }],
  }),

  handleEmergencyAssistance: async (req) => ({
    success: true,
    message: 'Connecting you to emergency services. Please hold.',
    actions: [{ type: 'notification', payload: { department: 'security', priority: 'critical', message: 'EMERGENCY - immediate response required' } }],
    escalation: { reason: 'Emergency assistance requested', department: 'emergency', priority: 'critical', metadata: { type: 'emergency', ...req.context || {} } },
  }),

  // ReZ Consumer Handlers
  handleCashbackMissing: async (req) => ({
    success: true,
    message: 'Let me check your transaction status and explain pending vs credited cashback.',
    actions: [{ type: 'lookup', payload: { type: 'transaction_status', userId: req.userId } }],
  }),

  handleCoinsExpiry: async (req) => ({
    success: true,
    message: 'Here\'s your coin balance breakdown and expiry dates...',
    actions: [{ type: 'lookup', payload: { type: 'coin_balance', userId: req.userId } }],
  }),

  handleOrderTracking: async (req) => ({
    success: true,
    message: 'Let me check your live order status.',
    actions: [{ type: 'lookup', payload: { type: 'order_status', orderId: req.context?.orderId } }],
  }),

  handleAppGuidance: async (req) => ({
    success: true,
    message: 'Here\'s how to use [feature]...',
    data: { type: 'app_guidance', topic: req.message },
  }),

  handleFraudReport: async (req) => ({
    success: true,
    message: 'I\'m flagging this for immediate review. Your account will be protected.',
    actions: [
      { type: 'notification', payload: { department: 'fraud', priority: 'critical', message: 'Unauthorized activity report' } },
    ],
    escalation: { reason: 'Fraud report - unauthorized activity', department: 'fraud_team', priority: 'critical', metadata: req.context || {} },
  }),

  // Web Menu Handlers
  handleDietaryGuidance: async (req) => ({
    success: true,
    message: 'I\'m checking the menu for dietary information...',
    actions: [{ type: 'lookup', payload: { type: 'menu_allergens', item: req.context?.item } }],
  }),

  handleOrderModification: async (req) => ({
    success: true,
    message: 'I can update your order before it goes to the kitchen.',
    actions: [{ type: 'status_update', payload: { orderId: req.context?.orderId, action: 'hold_for_modification' } }],
  }),

  handleWrongOrder: async (req) => ({
    success: true,
    message: 'I\'m initiating a replacement workflow. A staff member will bring the correct dish.',
    actions: [
      { type: 'ticket', payload: { category: 'kitchen', orderId: req.context?.orderId, priority: 'high' } },
      { type: 'notification', payload: { department: 'kitchen', priority: 'high', message: 'Wrong order - priority replacement' } },
    ],
  }),

  handleWaitTime: async (req) => ({
    success: true,
    message: 'Current estimated wait time: 25 minutes.',
    actions: [{ type: 'lookup', payload: { type: 'wait_time', restaurantId: req.context?.restaurantId } }],
  }),

  handleBillSplit: async (req) => ({
    success: true,
    message: 'Here\'s how to split your bill...',
    data: { type: 'bill_split_instructions' },
  }),

  // Merchant OS Handlers
  handlePosHelp: async (req) => ({
    success: true,
    message: 'Try these troubleshooting steps: 1. Restart the terminal 2. Check network connection 3. Contact IT if persists.',
    actions: [{ type: 'ticket', payload: { category: 'it', merchantId: req.context?.merchantId, priority: 'medium' } }],
  }),

  handleSettlementQuestion: async (req) => ({
    success: true,
    message: 'Let me check your settlement schedule.',
    actions: [{ type: 'lookup', payload: { type: 'settlement_status', merchantId: req.context?.merchantId } }],
  }),

  handleCampaignGuidance: async (req) => ({
    success: true,
    message: 'Here\'s how to create a cashback campaign...',
    data: { type: 'campaign_tutorial', merchantId: req.context?.merchantId },
  }),

  handleInventoryError: async (req) => ({
    success: true,
    message: 'I\'m checking your inventory sync status.',
    actions: [{ type: 'lookup', payload: { type: 'inventory_status', merchantId: req.context?.merchantId } }],
  }),

  handleComplaintGuidance: async (req) => ({
    success: true,
    message: 'Here\'s how to handle this customer complaint professionally...',
    data: { type: 'complaint_handling_guide' },
  }),

  // Karma Handlers
  handlePointsMissing: async (req) => ({
    success: true,
    message: 'Let me verify your challenge completion and point allocation.',
    actions: [{ type: 'lookup', payload: { type: 'karma_points', userId: req.userId } }],
  }),

  handleTierBenefits: async (req) => ({
    success: true,
    message: 'Your current tier benefits include...',
    actions: [{ type: 'lookup', payload: { type: 'tier_benefits', userId: req.userId } }],
  }),

  handleChallengeHelp: async (req) => ({
    success: true,
    message: 'Here\'s how to complete this challenge...',
    data: { type: 'challenge_guide', challengeId: req.context?.challengeId },
  }),

  handleRedemptionIssue: async (req) => ({
    success: true,
    message: 'Let me check why your code isn\'t working.',
    actions: [{ type: 'lookup', payload: { type: 'redemption_status', code: req.context?.code } }],
  }),

  handleAntiAbuse: async (req) => ({
    success: true,
    message: 'I\'m reviewing your account status. This may take 24-48 hours.',
    actions: [{ type: 'notification', payload: { department: 'trust_safety', priority: 'high', message: 'Anti-abuse review requested' } }],
  }),

  // Rendez Handlers
  handleSafetyReport: async (req) => ({
    success: true,
    message: 'Your safety is our priority. I\'m escalating this immediately.',
    actions: [{ type: 'notification', payload: { department: 'safety', priority: 'critical', message: 'Safety report - immediate review' } }],
    escalation: { reason: 'User safety report', department: 'trust_safety', priority: 'critical', metadata: req.context || {} },
  }),

  handleBookingHelp: async (req) => ({
    success: true,
    message: 'Let me search for your reservation.',
    actions: [{ type: 'lookup', payload: { type: 'rendez_booking', userId: req.userId } }],
  }),

  handleProfileGuidance: async (req) => ({
    success: true,
    message: 'Here are tips to improve your profile...',
    data: { type: 'profile_tips' },
  }),

  handleGiftDelivery: async (req) => ({
    success: true,
    message: 'Let me track your gift delivery status.',
    actions: [{ type: 'lookup', payload: { type: 'gift_status', giftId: req.context?.giftId } }],
  }),

  handleDateCancellation: async (req) => ({
    success: true,
    message: 'I\'m processing your cancellation and notifying the other party.',
    actions: [{ type: 'status_update', payload: { bookingId: req.context?.bookingId, action: 'cancel' } }],
  }),

  // AdBazaar Handlers
  handleCampaignUnderperforming: async (req) => ({
    success: true,
    message: 'Let me analyze your campaign metrics and suggest optimizations.',
    actions: [{ type: 'lookup', payload: { type: 'campaign_analytics', campaignId: req.context?.campaignId } }],
  }),

  handleAdRejection: async (req) => ({
    success: true,
    message: 'Your ad was rejected due to: [reason]. Here\'s how to fix it...',
    actions: [{ type: 'lookup', payload: { type: 'ad_rejection_reason', adId: req.context?.adId } }],
  }),

  handleBudgetOverspend: async (req) => ({
    success: true,
    message: 'I\'m investigating your budget usage.',
    actions: [{ type: 'lookup', payload: { type: 'budget_usage', campaignId: req.context?.campaignId } }],
  }),

  handleAudienceSetup: async (req) => ({
    success: true,
    message: 'Here\'s how to set up audience targeting for students...',
    data: { type: 'audience_tutorial', targeting: req.context?.targeting },
  }),

  handleRoiExplanation: async (req) => ({
    success: true,
    message: 'Here\'s the ROI breakdown by campaign...',
    actions: [{ type: 'lookup', payload: { type: 'campaign_roi', merchantId: req.context?.merchantId } }],
  }),

  // NextaBiZ Handlers
  handleInvoiceError: async (req) => ({
    success: true,
    message: 'Let me pull up your invoice for review.',
    actions: [{ type: 'lookup', payload: { type: 'invoice_details', invoiceId: req.context?.invoiceId } }],
  }),

  handleWorkflowSetup: async (req) => ({
    success: true,
    message: 'Here\'s how to set up this workflow...',
    data: { type: 'workflow_guide', workflowType: req.context?.workflowType },
  }),

  handleVendorPayment: async (req) => ({
    success: true,
    message: 'Let me check the vendor payment status.',
    actions: [{ type: 'lookup', payload: { type: 'vendor_payment', vendorId: req.context?.vendorId } }],
  }),

  handleReportInterpretation: async (req) => ({
    success: true,
    message: 'This report shows... [interpretation]',
    data: { type: 'report_explanation', reportType: req.context?.reportType },
  }),

  handleIntegrationHelp: async (req) => ({
    success: true,
    message: 'Let me check the integration status.',
    actions: [{ type: 'lookup', payload: { type: 'integration_status', integrationId: req.context?.integrationId } }],
  }),
};

// ── Scenario Matcher ────────────────────────────────────────────────────────────
// DANGEROUS: Matches patterns with word-level fuzzy matching

function matchScenario(category: SupportCategory, message: string): SupportScenario | null {
  const lowerMessage = message.toLowerCase();
  const words = lowerMessage.split(/\s+/);
  const scenarios = SUPPORT_SCENARIOS[category] || [];

  for (const scenario of scenarios) {
    for (const pattern of scenario.patterns) {
      const lowerPattern = pattern.toLowerCase();

      // Exact substring match
      if (lowerMessage.includes(lowerPattern)) {
        return scenario;
      }

      // Word-level fuzzy match: check if all key words in pattern exist
      const patternWords = lowerPattern.split(/\s+/);
      const matchCount = patternWords.filter((pw: string) =>
        words.some((w: string) => w.includes(pw) || pw.includes(w))
      ).length;

      // Match if 70%+ of pattern words found
      if (patternWords.length > 0 && matchCount / patternWords.length >= 0.7) {
        return scenario;
      }
    }
  }

  // Fallback: check keywords across all scenarios
  const allKeywords = new Set<string>();
  for (const s of scenarios) {
    for (const p of s.patterns) {
      for (const w of p.toLowerCase().split(/\s+/)) {
        if (w.length > 3) allKeywords.add(w);
      }
    }
  }

  for (const keyword of allKeywords) {
    if (lowerMessage.includes(keyword)) {
      const matched = scenarios.find(s =>
        s.patterns.some(p => p.toLowerCase().includes(keyword))
      );
      if (matched) return matched;
    }
  }

  return null;
}

// ── Main Handler ───────────────────────────────────────────────────────────────

export async function handleSupportRequest(request: SupportRequest): Promise<SupportResponse> {
  logger.info('Processing support request', { category: request.category, message: request.message });

  const scenario = matchScenario(request.category, request.message);

  if (!scenario) {
    // Fallback: general support
    return {
      success: true,
      message: 'I\'m here to help! Let me route your inquiry to the right team.',
      actions: [{ type: 'notification', payload: { department: 'support', priority: 'medium', message: request.message } }],
    };
  }

  const handler = handlers[scenario.handler];
  if (!handler) {
    logger.error('Handler not found', { handler: scenario.handler });
    return {
      success: false,
      message: 'I\'m having trouble processing your request. Please try again.',
    };
  }

  // Execute handler
  const response = await handler(request);

  // Execute any actions
  for (const action of response.actions || []) {
    await executeSupportAction(action, request);
  }

  // Escalate if needed
  if (response.escalation) {
    await executeEscalation(response.escalation);
  }

  logger.info('Support request handled', { scenario: scenario.id, success: response.success });

  return response;
}

// ── Action Execution ───────────────────────────────────────────────────────────

async function executeSupportAction(action: SupportAction, request: SupportRequest): Promise<void> {
  switch (action.type) {
    case 'ticket':
      await actionExecutor.execute({
        type: 'route_to_task_queue',
        target: action.payload.department as string || 'support',
        payload: {
          department: action.payload.department || 'support',
          taskType: `support_${action.payload.category || 'general'}`,
          description: request.message,
          priority: request.priority || 'medium',
          metadata: { supportRequest: request, ...action.payload },
        },
        agent: 'support-agent',
        skipPermission: true,
        risk: 'medium',
      });
      break;

    case 'notification':
      await actionExecutor.execute({
        type: 'send_staff_notification',
        target: action.payload.department as string,
        payload: {
          department: action.payload.department,
          title: `Support Request: ${request.category}`,
          message: action.payload.message,
          priority: action.payload.priority || 'medium',
        },
        agent: 'support-agent',
        skipPermission: true,
        risk: 'low',
      });
      break;

    case 'status_update':
      await sharedMemory.set(
        `support:status:${action.payload.orderId || action.payload.bookingId}`,
        { ...action.payload, updatedBy: 'support-agent', timestamp: new Date() },
        3600
      );
      break;

    case 'lookup':
      // Cache lookup for faster future access
      await sharedMemory.set(
        `support:lookup:${action.payload.type}:${Object.values(action.payload).join(':')}`,
        { status: 'pending', requestedAt: Date.now() },
        300 // 5 min cache
      );
      break;
  }
}

// ── Escalation Handler ─────────────────────────────────────────────────────────

async function executeEscalation(escalation: EscalationRequest): Promise<void> {
  await actionExecutor.execute({
    type: 'alert_support',
    target: escalation.department,
    payload: {
      type: escalation.reason.includes('emergency') ? 'critical_error' : 'anomaly',
      severity: escalation.priority,
      message: escalation.reason,
      data: escalation.metadata,
    },
    agent: 'support-agent',
    skipPermission: true,
    risk: escalation.priority === 'critical' ? 'high' : 'medium',
  });
}

// ── Dashboard Stats ────────────────────────────────────────────────────────────

export async function getSupportStats(): Promise<{
  totalRequests: number;
  byCategory: Record<SupportCategory, number>;
  escalations: number;
  avgResolutionTime: number;
}> {
  const stats = await sharedMemory.get<{
    totalRequests: number;
    byCategory: Record<string, number>;
    escalations: number;
  }>('support:stats');

  return {
    totalRequests: stats?.totalRequests || 0,
    byCategory: (stats?.byCategory || {}) as Record<SupportCategory, number>,
    escalations: stats?.escalations || 0,
    avgResolutionTime: 0, // Would calculate from actual data
  };
}

// ── Run Agent (for health check) ──────────────────────────────────────────────

export async function runSupportAgent(): Promise<AgentResult> {
  const start = Date.now();

  return {
    agent: 'support-agent',
    success: true,
    durationMs: Date.now() - start,
    data: { status: 'ready', scenarios: Object.keys(SUPPORT_SCENARIOS).length },
  };
}
