/**
 * Internal Event Bus for ReZ Intent Graph
 *
 * Simple event emitter for internal service communication.
 */

import { EventEmitter } from 'events';

class InternalEventBus extends EventEmitter {
  private static instance: InternalEventBus;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): InternalEventBus {
    if (!InternalEventBus.instance) {
      InternalEventBus.instance = new InternalEventBus();
    }
    return InternalEventBus.instance;
  }

  async emitEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    this.emit(eventType, payload);
  }

  subscribe(eventType: string, handler: (payload: Record<string, unknown>) => void): void {
    this.on(eventType, handler);
  }

  unsubscribe(eventType: string, handler: (payload: Record<string, unknown>) => void): void {
    this.off(eventType, handler);
  }
}

export const eventBus = InternalEventBus.getInstance();
export const emitEvent = eventBus.emitEvent.bind(eventBus);
export const subscribe = eventBus.subscribe.bind(eventBus);
export const unsubscribe = eventBus.unsubscribe.bind(eventBus);
