import { useCallback, useRef } from 'react';

export function useLogoUnlock(onUnlocked: () => void, clicks = 5, windowMs = 3000) {
  const timestamps = useRef<number[]>([]);

  const onClick = useCallback(() => {
    const now = Date.now();
    timestamps.current = timestamps.current.filter((t) => now - t < windowMs);
    timestamps.current.push(now);

    if (timestamps.current.length >= clicks) {
      timestamps.current = [];
      onUnlocked();
    }
  }, [clicks, onUnlocked, windowMs]);

  const reset = useCallback(() => {
    timestamps.current = [];
  }, []);

  return { onClick, reset };
}
