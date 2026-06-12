"use client";

import { useState, useEffect, useCallback } from "react";

interface AnimationConfig {
  autoPlay?: boolean;
  loop?: boolean;
  duration?: number;
  delay?: number;
}

export function useDiagramAnimation<T>(
  sequence: T[],
  config: AnimationConfig = {},
) {
  const { autoPlay = true, loop = true, duration = 500, delay = 100 } = config;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const reset = useCallback(() => setCurrentIndex(0), []);
  const next = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % sequence.length);
  }, [sequence.length]);
  const prev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + sequence.length) % sequence.length);
  }, [sequence.length]);

  useEffect(() => {
    if (!isPlaying || sequence.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        const nextIndex = prev + 1;
        if (nextIndex >= sequence.length) {
          if (loop) return 0;
          setIsPlaying(false);
          return prev;
        }
        return nextIndex;
      });
    }, duration + delay);

    return () => clearInterval(interval);
  }, [isPlaying, sequence.length, duration, delay, loop]);

  return {
    currentItem: sequence[currentIndex],
    currentIndex,
    totalItems: sequence.length,
    isPlaying,
    play,
    pause,
    reset,
    next,
    prev,
  };
}
