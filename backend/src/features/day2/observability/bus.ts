/**
 * In-process notification bus (FR-5.2). Writers publish AFTER their transaction commits; the WebSocket/SSE hub
 * subscribes per topic (e.g. `chat:chat-cs-session-101`, `match:match-m1`). A throwing subscriber never
 * affects the writer or the other subscribers.
 */
export type BusEvent = { type: string; [k: string]: unknown };
type Handler = (e: BusEvent, topic: string) => void;

const subs = new Map<string, Set<Handler>>();

export function subscribe(topic: string, h: Handler): () => void {
  let set = subs.get(topic);
  if (!set) subs.set(topic, (set = new Set()));
  set.add(h);
  return () => {
    set!.delete(h);
    if (!set!.size) subs.delete(topic);
  };
}

/** Topic that receives every event (cache invalidation, metrics). Handlers get the topic as a second argument. */
export const ALL = '*';

/** Returns how many subscribers received the event. */
export function publish(topic: string, e: BusEvent): number {
  let n = 0;
  for (const h of [...(subs.get(topic) ?? []), ...(topic === ALL ? [] : (subs.get(ALL) ?? []))]) {
    try {
      h(e, topic);
      n++;
    } catch {
      /* a broken subscriber is the hub's problem, not the writer's */
    }
  }
  return n;
}

export const subscriberCount = (topic: string) => subs.get(topic)?.size ?? 0;
