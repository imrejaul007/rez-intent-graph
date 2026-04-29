/**
 * Resilient Intent Capture Client
 * Circuit breaker pattern for intent capture
 * Can be used by consumer apps for graceful degradation
 */

import CircuitBreaker from './CircuitBreaker.js';

export interface CaptureIntentParams {
  userId: string;
  appType: string;
  eventType: string;
  category: string;
  intentKey: string;
  intentQuery?: string;
  metadata?: Record<string, unknown>;
  merchantId?: string;
}

const INTENT_CAPTURE_URL = process.env.INTENT_CAPTURE_URL || 'https://rez-intent-graph.onrender.com';
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';

// Circuit breaker for intent capture
const captureCircuit = new CircuitBreaker({
  name: 'intent-capture',
  timeout: 5000,
  resetTimeout: 30000,
  maxFailures: 5,
});

// Circuit breaker for recommendations
const recommendationCircuit = new CircuitBreaker({
  name: 'recommendations',
  timeout: 3000,
  resetTimeout: 60000,
  maxFailures: 3,
});

/**
 * Capture intent with circuit breaker protection
 * Falls back to silent failure if intent graph is down
 */
export async function captureIntent(params: CaptureIntentParams): Promise<void> {
  await captureCircuit.execute(
    async () => {
      const response = await fetch(`${INTENT_CAPTURE_URL}/api/intent/capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': INTERNAL_TOKEN,
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`Intent capture failed: ${response.status}`);
      }
    },
    () => {
      // Fallback: silent failure (event lost but user experience unaffected)
      console.warn(`[IntentCapture] Circuit open - event dropped: ${params.eventType}`);
    }
  );
}

/**
 * Get recommendations with circuit breaker protection
 * Falls back to empty recommendations if intent graph is down
 */
export async function getRecommendations(
  userId: string,
  category?: string
): Promise<string[]> {
  return recommendationCircuit.execute(
    async () => {
      const params = new URLSearchParams({ userId });
      if (category) params.set('category', category);

      const response = await fetch(
        `${INTENT_CAPTURE_URL}/api/intent/recommendations?${params}`,
        {
          headers: {
            'x-internal-token': INTERNAL_TOKEN,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Recommendations failed: ${response.status}`);
      }

      const data = await response.json();
      return data.data?.recommendations || [];
    },
    () => {
      // Fallback: empty recommendations (show default content)
      console.warn(`[IntentCapture] Recommendations circuit open - returning empty`);
      return [];
    }
  );
}

/**
 * Get similar intents with circuit breaker protection
 */
export async function getSimilarIntents(
  userId: string,
  intentKey: string,
  category?: string
): Promise<{ intentKey: string; similarity: number }[]> {
  return recommendationCircuit.execute(
    async () => {
      const params = new URLSearchParams({ userId, intentKey });
      if (category) params.set('category', category);

      const response = await fetch(
        `${INTENT_CAPTURE_URL}/api/intent/similar?${params}`,
        {
          headers: {
            'x-internal-token': INTERNAL_TOKEN,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Similar intents failed: ${response.status}`);
      }

      const data = await response.json();
      return data.data || [];
    },
    () => {
      return [];
    }
  );
}

/**
 * Get circuit breaker stats for monitoring
 */
export function getCaptureStats() {
  return captureCircuit.getStats();
}

export function getRecommendationStats() {
  return recommendationCircuit.getStats();
}

/**
 * Reset circuit breakers (for testing/admin)
 */
export function resetCircuitBreakers() {
  captureCircuit.reset();
  recommendationCircuit.reset();
}
