"use client";

import { useSyncExternalStore } from "react";

// One shared timer for every countdown on the page: the clock ticks once per second.
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) clearInterval(timer);
  };
}

/** The current time in ms, updated every second (for live countdowns). */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => current || (current = Date.now()),
    () => 0,
  );
}
