// ── Intent Graph Core Types ───────────────────────────────────────────────────

export type IntentStatus = 'ACTIVE' | 'DORMANT' | 'FULFILLED' | 'EXPIRED';
export type AppType = 'hotel_ota' | 'restaurant' | 'retail' | 'hotel_guest';
export type Category = 'TRAVEL' | 'DINING' | 'RETAIL' | 'HOTEL_SERVICE' | 'GENERAL';
export type EventType = 'search' | 'view' | 'wishlist' | 'cart_add' | 'hold' | 'checkout_start' | 'fulfilled' | 'abandoned';

export interface IntentSignalWeight {
  eventType: EventType;
  weight: number;
}

export const SIGNAL_WEIGHTS: Record<EventType, number> = {
  search: 0.15,
  view: 0.10,
  wishlist: 0.25,
  cart_add: 0.30,
  hold: 0.35,
  checkout_start: 0.40,
  fulfilled: 1.0,
  abandoned: -0.2,
};

export const BASE_CONFIDENCE = 0.3;
export const DORMANCY_THRESHOLD_DAYS = 7;
export const CONFIDENCE_DORMANT_THRESHOLD = 0.3;

// ── Core Interfaces ─────────────────────────────────────────────────────────

export interface Intent {
  id: string;
  userId: string;
  merchantId?: string;
  appType: AppType;
  category: Category;
  intentKey: string;
  intentQuery?: string;
  metadata?: Record<string, unknown>;
  confidence: number;
  status: IntentStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface IntentSignal {
  id: string;
  intentId: string;
  eventType: EventType;
  weight: number;
  data?: Record<string, unknown>;
  capturedAt: Date;
}

export interface DormantIntent {
  id: string;
  intentId: string;
  userId: string;
  appType: AppType;
  category: Category;
  intentKey: string;
  dormancyScore: number;
  revivalScore: number;
  daysDormant: number;
  lastNudgeSent?: Date;
  nudgeCount: number;
  idealRevivalAt?: Date;
  status: 'active' | 'paused' | 'revived';
}

export interface IntentSequence {
  id: string;
  intentId: string;
  userId: string;
  eventType: EventType;
  sequenceOrder: number;
  durationMs?: number;
  occurredAt: Date;
}

export interface CrossAppIntentProfile {
  id: string;
  userId: string;
  travelIntentCount: number;
  diningIntentCount: number;
  retailIntentCount: number;
  dormantTravelCount: number;
  dormantDiningCount: number;
  dormantRetailCount: number;
  totalConversions: number;
  travelAffinity: number;
  diningAffinity: number;
  retailAffinity: number;
  updatedAt: Date;
}

// ── Capture Request/Response ─────────────────────────────────────────────────

export interface CaptureIntentParams {
  userId: string;
  appType: AppType;
  eventType: EventType;
  category: Category;
  intentKey: string;
  intentQuery?: string;
  metadata?: Record<string, unknown>;
}

export interface CaptureIntentResult {
  intent: Intent;
  signal: IntentSignal;
  isNew: boolean;
}

// ── Scoring Types ────────────────────────────────────────────────────────────

export interface ScoringContext {
  intentId: string;
  baseConfidence: number;
  signalCount: number;
  lastSignalAt?: Date;
  avgVelocity: number;
  metadata?: Record<string, unknown>;
}

export interface DormancyDetection {
  intentId: string;
  daysSinceLastActivity: number;
  currentConfidence: number;
  shouldMarkDormant: boolean;
}

export interface RevivalCandidate {
  dormantIntent: DormantIntent;
  intent: Intent;
  revivalScore: number;
  suggestedNudge?: string;
  idealTiming?: Date;
}

// ── Cross-App Types ──────────────────────────────────────────────────────────

export interface EnrichedContext {
  activeIntents: Array<{ category: Category; key: string; confidence: number; lastSeen: Date }>;
  dormantIntents: Array<{ category: Category; key: string; revivalScore: number; daysDormant: number }>;
  suggestedNudges: Array<{ intentKey: string; message: string; priority: 'high' | 'medium' | 'low' }>;
  crossAppProfile?: CrossAppIntentProfile;
}

// ── Agent Tools ──────────────────────────────────────────────────────────────

export interface IntentToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ── Zod Schemas for Validation ───────────────────────────────────────────────

import { z } from 'zod';

export const CaptureIntentSchema = z.object({
  userId: z.string().min(1),
  appType: z.enum(['hotel_ota', 'restaurant', 'retail', 'hotel_guest']),
  eventType: z.enum(['search', 'view', 'wishlist', 'cart_add', 'hold', 'checkout_start', 'fulfilled', 'abandoned']),
  category: z.enum(['TRAVEL', 'DINING', 'RETAIL', 'HOTEL_SERVICE', 'GENERAL']),
  intentKey: z.string().min(1),
  intentQuery: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const DormancyCheckSchema = z.object({
  userId: z.string().min(1),
  daysThreshold: z.number().min(1).default(7),
});

export const RevivalTriggerSchema = z.object({
  dormantIntentId: z.string().min(1),
  triggerType: z.enum(['price_drop', 'return_user', 'seasonality', 'offer_match', 'manual']),
  triggerData: z.record(z.unknown()).optional(),
});
