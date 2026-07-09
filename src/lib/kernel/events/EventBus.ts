import { EventType, EventPayloadMap, EventHandler } from './types';

export class EventBus {
  private handlers: Map<EventType, Set<EventHandler<any>>> = new Map();

  public subscribe<T extends EventType>(eventType: T, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  public unsubscribe<T extends EventType>(eventType: T, handler: EventHandler<T>): void {
    if (this.handlers.has(eventType)) {
      this.handlers.get(eventType)!.delete(handler);
    }
  }

  public async publish<T extends EventType>(eventType: T, payload: EventPayloadMap[T]): Promise<void> {
    const eventHandlers = this.handlers.get(eventType);
    if (!eventHandlers) return;

    // Execute handlers concurrently
    const promises = Array.from(eventHandlers).map(handler => {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          return result.catch(err => {
            console.error(`Error in event handler for ${eventType}:`, err);
          });
        }
      } catch (err) {
        console.error(`Error in sync event handler for ${eventType}:`, err);
      }
      return Promise.resolve();
    });

    await Promise.all(promises);
  }
}

// Global singleton instance for the kernel
export const globalEventBus = new EventBus();
