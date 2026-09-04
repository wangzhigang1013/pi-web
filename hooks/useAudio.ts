"use client";

import { useState, useRef, useCallback, useEffect } from "react";

function playTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  const freqs = [523.25, 659.25];
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

export function useAudio() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("pi-sound-enabled");
    return stored === null ? true : stored === "true";
  });

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const ctxRef = useRef<AudioContext | null>(null);
  const keepAliveOscRef = useRef<AudioNode | null>(null);
  const htmlAudioRef = useRef<HTMLAudioElement | null>(null);

  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      ctxRef.current = new AudioCtx();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  // Pre-warm the HTML5 audio element
  const getHtmlAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === "undefined" || typeof Audio === "undefined") return null;
    if (!htmlAudioRef.current) {
      try {
        htmlAudioRef.current = new Audio("/chime.wav");
        htmlAudioRef.current.preload = "auto";
      } catch {
        return null;
      }
    }
    return htmlAudioRef.current;
  }, []);

  // Connect a silent node so Chrome's audio engine thread will NOT auto-suspend
  // the AudioContext after 20-30s of silence during long background runs.
  const ensureKeepAlive = useCallback((ctx: AudioContext) => {
    if (keepAliveOscRef.current || ctx.state === "closed") return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0; // completely silent
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      keepAliveOscRef.current = osc;
    } catch {
      // ignore
    }
  }, []);

  const unlockAudio = useCallback((force = false) => {
    if (!force && !enabledRef.current) return;
    const ctx = getCtx();
    if (ctx) {
      if (ctx.state === "suspended") {
        ctx.resume().then(() => ensureKeepAlive(ctx)).catch(() => {});
      } else {
        ensureKeepAlive(ctx);
      }
    }
    const audio = getHtmlAudio();
    if (audio) {
      try {
        audio.load();
      } catch {
        // ignore
      }
    }
  }, [getCtx, ensureKeepAlive, getHtmlAudio]);

  // Unlock audio automatically on the user's first click or keypress anywhere on the page
  useEffect(() => {
    const handleUserGesture = () => {
      unlockAudio(false);
    };
    window.addEventListener("pointerdown", handleUserGesture, { passive: true });
    window.addEventListener("keydown", handleUserGesture, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handleUserGesture);
      window.removeEventListener("keydown", handleUserGesture);
    };
  }, [unlockAudio]);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    if (next) unlockAudio(true);
    enabledRef.current = next;
    localStorage.setItem("pi-sound-enabled", String(next));
    setEnabled(next);
  }, [unlockAudio]);

  const playDone = useCallback(() => {
    if (!enabledRef.current) return;

    let played = false;
    const ctx = getCtx();

    if (ctx && ctx.state === "running") {
      try {
        playTone(ctx);
        played = true;
      } catch {
        // ignore
      }
    }

    // If WebAudio was not running or failed, immediately play via HTML5 Audio element fallback!
    // Ensures audio plays instantaneously even when browser suspended WebAudio in the background.
    if (!played) {
      const audio = getHtmlAudio();
      if (audio) {
        try {
          audio.currentTime = 0;
          audio.play().catch(() => {});
          played = true;
        } catch {
          // ignore
        }
      }
    }

    // Resume ctx for future calls, but DO NOT replay the sound so it never sounds twice
    if (ctx && ctx.state === "suspended") {
      ctx.resume().then(() => {
        ensureKeepAlive(ctx);
      }).catch(() => {});
    }
  }, [getCtx, getHtmlAudio, ensureKeepAlive]);

  return {
    soundEnabled: enabled,
    onSoundToggle: toggle,
    playDoneSound: playDone,
    unlockAudio,
    soundEnabledRef: enabledRef,
  };
}
