/**
 * Load Test Scenarios for Rez Intent Graph
 * Designed for 1M user scale testing
 */

import type { LoadProfile, LoadScenario } from './types.js';

// Re-export for backwards compatibility
export type { LoadProfile, LoadScenario } from './types.js';

// ============================================================================
// Scenario Definitions
// ============================================================================

export interface ApiScenarioConfig {
  name: string;
  weight: number;
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  };
  thinkTime?: number; // milliseconds between requests
  expectedStatus: number[];
}

export interface WebSocketScenarioConfig {
  name: string;
  weight: number;
  messageFrequency: number; // messages per minute
  messageSize: number; // bytes
  subscribeChannels: string[];
}

export interface IntentCaptureScenarioConfig {
  name: string;
  weight: number;
  intentTypes: ('view' | 'click' | 'add_to_cart' | 'purchase' | 'search' | 'browse')[];
  dataSize: number; // bytes per intent event
}

// ============================================================================
// API Scenarios
// ============================================================================

export const apiScenarios: ApiScenarioConfig[] = [
  // Intent API - Most critical path
  {
    name: 'capture_intent',
    weight: 30,
    request: {
      method: 'POST',
      path: '/api/intent/capture',
      headers: { 'Content-Type': 'application/json' },
      body: {
        userId: '{{userId}}',
        sessionId: '{{sessionId}}',
        intentType: '{{intentType}}',
        productId: '{{productId}}',
        metadata: { source: 'load-test', timestamp: '{{timestamp}}' },
      },
    },
    thinkTime: 100,
    expectedStatus: [200, 201],
  },
  {
    name: 'get_intent_graph',
    weight: 20,
    request: {
      method: 'GET',
      path: '/api/intent/user/{{userId}}/graph',
    },
    thinkTime: 500,
    expectedStatus: [200],
  },
  {
    name: 'query_intents',
    weight: 15,
    request: {
      method: 'POST',
      path: '/api/intent/query',
      headers: { 'Content-Type': 'application/json' },
      body: {
        userId: '{{userId}}',
        intentTypes: ['purchase', 'add_to_cart', 'view'],
        timeRange: { start: '{{timeStart}}', end: '{{timeEnd}}' },
      },
    },
    thinkTime: 300,
    expectedStatus: [200],
  },
  // Merchant API
  {
    name: 'get_merchant_analytics',
    weight: 10,
    request: {
      method: 'GET',
      path: '/api/merchant/{{merchantId}}/analytics',
    },
    thinkTime: 1000,
    expectedStatus: [200],
  },
  {
    name: 'update_merchant_settings',
    weight: 5,
    request: {
      method: 'PUT',
      path: '/api/merchant/{{merchantId}}/settings',
      headers: { 'Content-Type': 'application/json' },
      body: {
        notificationPreferences: { email: true, push: true },
        intentTracking: { enabled: true, retention: 90 },
      },
    },
    thinkTime: 200,
    expectedStatus: [200, 204],
  },
  // Chat API
  {
    name: 'send_chat_message',
    weight: 10,
    request: {
      method: 'POST',
      path: '/api/chat/message',
      headers: { 'Content-Type': 'application/json' },
      body: {
        sessionId: '{{sessionId}}',
        message: '{{message}}',
        context: { userId: '{{userId}}' },
      },
    },
    thinkTime: 200,
    expectedStatus: [200, 201],
  },
  {
    name: 'get_chat_history',
    weight: 5,
    request: {
      method: 'GET',
      path: '/api/chat/history/{{sessionId}}',
    },
    thinkTime: 300,
    expectedStatus: [200],
  },
  // Commerce Memory API
  {
    name: 'store_commerce_memory',
    weight: 3,
    request: {
      method: 'POST',
      path: '/api/commerce-memory',
      headers: { 'Content-Type': 'application/json' },
      body: {
        userId: '{{userId}}',
        eventType: '{{eventType}}',
        data: { productId: '{{productId}}', price: '{{price}}' },
      },
    },
    thinkTime: 100,
    expectedStatus: [200, 201],
  },
  {
    name: 'retrieve_commerce_memory',
    weight: 2,
    request: {
      method: 'GET',
      path: '/api/commerce-memory/user/{{userId}}',
    },
    thinkTime: 400,
    expectedStatus: [200],
  },
];

// ============================================================================
// WebSocket Scenarios
// ============================================================================

export const webSocketScenarios: WebSocketScenarioConfig[] = [
  {
    name: 'intent_stream',
    weight: 40,
    messageFrequency: 60, // 1 message per second
    messageSize: 512,
    subscribeChannels: ['intents', 'user:{{userId}}'],
  },
  {
    name: 'notification_stream',
    weight: 30,
    messageFrequency: 5, // 1 message every 12 seconds
    messageSize: 256,
    subscribeChannels: ['notifications', 'user:{{userId}}'],
  },
  {
    name: 'agent_stream',
    weight: 20,
    messageFrequency: 10,
    messageSize: 1024,
    subscribeChannels: ['agents', 'user:{{userId}}'],
  },
  {
    name: 'commerce_stream',
    weight: 10,
    messageFrequency: 30,
    messageSize: 768,
    subscribeChannels: ['commerce', 'user:{{userId}}'],
  },
];

// ============================================================================
// Intent Capture Scenarios (for event-driven testing)
// ============================================================================

export const intentCaptureScenarios: IntentCaptureScenarioConfig[] = [
  {
    name: 'product_view_intent',
    weight: 40,
    intentTypes: ['view'],
    dataSize: 256,
  },
  {
    name: 'add_to_cart_intent',
    weight: 25,
    intentTypes: ['add_to_cart'],
    dataSize: 384,
  },
  {
    name: 'purchase_intent',
    weight: 15,
    intentTypes: ['purchase'],
    dataSize: 512,
  },
  {
    name: 'search_intent',
    weight: 15,
    intentTypes: ['search'],
    dataSize: 192,
  },
  {
    name: 'browse_intent',
    weight: 5,
    intentTypes: ['browse'],
    dataSize: 128,
  },
];

// ============================================================================
// Scenario Factory
// ============================================================================

export class LoadScenarioFactory {
  private profile: LoadProfile;
  private userIdCounter = 0;
  private sessionIdCounter = 0;
  private startTime: number;

  constructor(profile: LoadProfile) {
    this.profile = profile;
    this.startTime = Date.now();
  }

  private generateUserId(): string {
    this.userIdCounter++;
    return `load_test_user_${this.userIdCounter % this.profile.totalUsers}`;
  }

  private generateSessionId(): string {
    this.sessionIdCounter++;
    return `session_${this.sessionIdCounter}_${Date.now()}`;
  }

  private generateTimestamp(): string {
    return new Date().toISOString();
  }

  private interpolate(template: string | Record<string, unknown>): string | Record<string, unknown> {
    if (typeof template === 'string') {
      return template
        .replace(/\{\{userId\}\}/g, this.generateUserId())
        .replace(/\{\{sessionId\}\}/g, this.generateSessionId())
        .replace(/\{\{timestamp\}\}/g, this.generateTimestamp())
        .replace(/\{\{merchantId\}\}/g, `merchant_${Math.floor(Math.random() * 10000)}`)
        .replace(/\{\{productId\}\}/g, `product_${Math.floor(Math.random() * 100000)}`)
        .replace(/\{\{intentType\}\}/g, ['view', 'click', 'add_to_cart', 'purchase'][Math.floor(Math.random() * 4)])
        .replace(/\{\{timeStart\}\}/g, new Date(Date.now() - 86400000).toISOString())
        .replace(/\{\{timeEnd\}\}/g, new Date().toISOString())
        .replace(/\{\{message\}\}/g, `Load test message ${Date.now()}`)
        .replace(/\{\{eventType\}\}/g, ['view', 'add_to_cart', 'purchase', 'review'][Math.floor(Math.random() * 4)])
        .replace(/\{\{price\}\}/g, (Math.random() * 500 + 10).toFixed(2));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = this.interpolate(value as string);
    }
    return result;
  }

  selectApiScenario(): ApiScenarioConfig {
    const totalWeight = apiScenarios.reduce((sum, s) => sum + s.weight, 0);
    let random = Math.random() * totalWeight;

    for (const scenario of apiScenarios) {
      random -= scenario.weight;
      if (random <= 0) {
        return scenario;
      }
    }

    return apiScenarios[0];
  }

  selectWebSocketScenario(): WebSocketScenarioConfig {
    const totalWeight = webSocketScenarios.reduce((sum, s) => sum + s.weight, 0);
    let random = Math.random() * totalWeight;

    for (const scenario of webSocketScenarios) {
      random -= scenario.weight;
      if (random <= 0) {
        return scenario;
      }
    }

    return webSocketScenarios[0];
  }

  createApiRequest(): {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    thinkTime: number;
    expectedStatus: number[];
  } {
    const scenario = this.selectApiScenario();
    const baseUrl = this.profile.targetUrl.replace(/\/$/, '');

    const interpolatedRequest = this.interpolate(scenario.request as unknown as string) as typeof scenario.request;

    return {
      url: `${baseUrl}${interpolatedRequest.path}`,
      method: interpolatedRequest.method,
      headers: interpolatedRequest.headers || {},
      body: interpolatedRequest.body ? JSON.stringify(interpolatedRequest.body) : undefined,
      thinkTime: scenario.thinkTime || 0,
      expectedStatus: scenario.expectedStatus,
    };
  }

  createWebSocketConnection(): {
    url: string;
    protocols?: string[];
    subscribeChannels: string[];
    messageFrequency: number;
    messageSize: number;
  } {
    const scenario = this.selectWebSocketScenario();
    const wsUrl = this.profile.targetUrl.replace(/^http/, 'ws').replace(/\/$/, '');

    return {
      url: `${wsUrl}/ws`,
      subscribeChannels: scenario.subscribeChannels.map((ch) =>
        ch.replace(/\{\{userId\}\}/g, this.generateUserId())
      ),
      messageFrequency: scenario.messageFrequency,
      messageSize: scenario.messageSize,
    };
  }
}

// ============================================================================
// Scenario Execution
// ============================================================================

export interface ScenarioResult {
  scenarioName: string;
  startTime: number;
  endTime: number;
  duration: number;
  statusCode: number;
  success: boolean;
  error?: string;
  bytesIn: number;
  bytesOut: number;
}

export class ScenarioExecutor {
  private results: ScenarioResult[] = [];
  private activeConnections = 0;

  async executeApiScenario(
    scenario: ReturnType<LoadScenarioFactory['createApiRequest']>
  ): Promise<ScenarioResult> {
    const startTime = Date.now();
    this.activeConnections++;

    const result: ScenarioResult = {
      scenarioName: 'api_call',
      startTime,
      endTime: 0,
      duration: 0,
      statusCode: 0,
      success: false,
      bytesIn: 0,
      bytesOut: 0,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.getTimeout());

      const response = await fetch(scenario.url, {
        method: scenario.method,
        headers: scenario.headers,
        body: scenario.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      result.statusCode = response.status;
      result.success = scenario.expectedStatus.includes(response.status);
      result.bytesIn = parseInt(response.headers.get('content-length') || '0', 10);
      result.bytesOut = scenario.body ? scenario.body.length : 0;

      if (!result.success) {
        result.error = `Unexpected status: ${response.status}`;
      }
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
    }

    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;
    this.activeConnections--;
    this.results.push(result);

    return result;
  }

  private getTimeout(): number {
    return 30000; // 30 second timeout
  }

  getActiveConnections(): number {
    return this.activeConnections;
  }

  getResults(): ScenarioResult[] {
    return [...this.results];
  }

  clearResults(): void {
    this.results = [];
  }
}

// ============================================================================
// Export all scenario data
// ============================================================================

export const SCENARIO_CONFIG = {
  apiScenarios,
  webSocketScenarios,
  intentCaptureScenarios,
  factory: LoadScenarioFactory,
  executor: ScenarioExecutor,
};
