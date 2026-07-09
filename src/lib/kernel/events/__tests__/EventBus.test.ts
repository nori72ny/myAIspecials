import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../EventBus';
import { MissionCreatedPayload, ResponseGeneratedPayload } from '../types';

describe('EventBus', () => {
  it('should publish and receive events', async () => {
    const eventBus = new EventBus();
    const handler = vi.fn();

    eventBus.subscribe('MissionCreated', handler);

    const payload: MissionCreatedPayload = {
      eventId: 'evt-1',
      missionId: 'm-1',
      timestamp: Date.now(),
      creatorId: 'user-1',
      objective: 'Do something',
      context: {}
    };

    await eventBus.publish('MissionCreated', payload);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('should handle multiple subscribers concurrently', async () => {
    const eventBus = new EventBus();
    const handler1 = vi.fn().mockResolvedValue(true);
    const handler2 = vi.fn().mockResolvedValue(true);

    eventBus.subscribe('ResponseGenerated', handler1);
    eventBus.subscribe('ResponseGenerated', handler2);

    const payload: ResponseGeneratedPayload = {
      eventId: 'evt-2',
      missionId: 'm-2',
      timestamp: Date.now(),
      response: 'Hello World'
    };

    await eventBus.publish('ResponseGenerated', payload);

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('should not crash if a handler throws', async () => {
    const eventBus = new EventBus();
    
    const badHandler = vi.fn().mockRejectedValue(new Error('Test error'));
    const goodHandler = vi.fn().mockResolvedValue(true);

    eventBus.subscribe('ResponseGenerated', badHandler);
    eventBus.subscribe('ResponseGenerated', goodHandler);

    const payload: ResponseGeneratedPayload = {
      eventId: 'evt-3',
      missionId: 'm-3',
      timestamp: Date.now(),
      response: 'Safe'
    };

    // Should not throw
    await eventBus.publish('ResponseGenerated', payload);
    
    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });
});
