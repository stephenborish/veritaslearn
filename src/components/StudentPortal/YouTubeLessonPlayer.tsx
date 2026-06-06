/**
 * YouTubeLessonPlayer — YouTube IFrame API player for VERITAS Learn.
 *
 * Integrates with VERITAS checkpoint/progress behavior:
 *   - Reports currentTime via onTimeUpdate (polled at ~250ms while playing)
 *   - Fires onPlay, onEnded callbacks
 *   - Exposes seekTo, play, pause, setPlaybackRate via imperative ref
 *   - Implements best-effort restricted seeking:
 *       Detects large forward jumps beyond furthestTimestamp + grace window,
 *       seeks back to the furthest allowed time, and calls onSeekBlocked.
 *
 * Loads the YouTube IFrame API once per page (singleton pattern).
 * Destroys player cleanly on unmount.
 */
import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";

// ── YouTube IFrame API singleton loader ──────────────────────────────────────

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  destroy(): void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementOrId: HTMLElement | string,
        config: object,
      ) => YTPlayer;
      PlayerState: {
        UNSTARTED: -1;
        ENDED: 0;
        PLAYING: 1;
        PAUSED: 2;
        BUFFERING: 3;
        CUED: 5;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiReady = false;
let ytApiCallbacks: Array<() => void> = [];
let ytApiLoading = false;

function ensureYtApiLoaded(callback: () => void) {
  if (ytApiReady && window.YT) {
    callback();
    return;
  }
  ytApiCallbacks.push(callback);
  if (!ytApiLoading) {
    ytApiLoading = true;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      ytApiReady = true;
      ytApiLoading = false;
      const cbs = ytApiCallbacks.slice();
      ytApiCallbacks = [];
      cbs.forEach((cb) => cb());
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.id = "yt-iframe-api";
    document.head.appendChild(tag);
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export interface YouTubeLessonPlayerHandle {
  seekTo(seconds: number): void;
  play(): void;
  pause(): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isEnded(): boolean;
  isPaused(): boolean;
}

interface Props {
  videoId: string;
  embedUrl: string;
  blockId: string;
  restrictSeeking: boolean;
  furthestTimestamp: number;
  startTimestamp?: number;
  onReady: (duration: number) => void;
  onPlay: () => void;
  onTimeUpdate: (currentTime: number) => void;
  onEnded: () => void;
  onRateChange?: (rate: number) => void;
  onSeekBlocked?: (requestedTime: number, allowedTime: number) => void;
}

const YouTubeLessonPlayer = forwardRef<YouTubeLessonPlayerHandle, Props>(
  (
    {
      videoId,
      embedUrl,
      blockId,
      restrictSeeking,
      furthestTimestamp,
      startTimestamp,
      onReady,
      onPlay,
      onTimeUpdate,
      onEnded,
      onRateChange,
      onSeekBlocked,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLIFrameElement>(null);
    const playerRef = useRef<YTPlayer | null>(null);
    const endedRef = useRef(false);
    const playingRef = useRef(false);
    const currentTimeRef = useRef(0);
    const furthestRef = useRef(furthestTimestamp);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startTimestampRef = useRef(startTimestamp ?? 0);
    const [playerReady, setPlayerReady] = useState(false);

    // Keep furthest in sync without recreating effect
    useEffect(() => {
      furthestRef.current = furthestTimestamp;
    }, [furthestTimestamp]);

    useEffect(() => {
      startTimestampRef.current = startTimestamp ?? 0;
    }, [startTimestamp]);

    // Polling — runs while the player is mounted, fires onTimeUpdate and restricted-seek check
    const startPolling = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => {
        const player = playerRef.current;
        if (!player) return;
        try {
          const state = player.getPlayerState();
          const isPlaying = state === 1; // YT.PlayerState.PLAYING
          const currentTime = player.getCurrentTime() ?? 0;
          currentTimeRef.current = currentTime;

          if (isPlaying) {
            onTimeUpdate(currentTime);

            if (restrictSeeking) {
              const allowedGap = 3;
              if (currentTime > furthestRef.current + allowedGap) {
                player.seekTo(furthestRef.current, true);
                if (onSeekBlocked) onSeekBlocked(Math.floor(currentTime), furthestRef.current);
              }
            }
          }
        } catch {
          // Player may not be ready yet; ignore
        }
      }, 250);
    };

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    useEffect(() => {
      let destroyed = false;

      ensureYtApiLoaded(() => {
        if (destroyed || !containerRef.current) return;

        playerRef.current = new window.YT!.Player(containerRef.current, {
          events: {
            onReady: (event: any) => {
              if (destroyed) return;
              const player = event.target as YTPlayer;
              playerRef.current = player;
              const dur = player.getDuration() ?? 0;
              onReady(dur);
              setPlayerReady(true);
              if (startTimestampRef.current > 0) {
                player.seekTo(startTimestampRef.current, true);
              }
            },
            onStateChange: (event: any) => {
              if (destroyed) return;
              const state = event.data;
              if (state === 1) {
                // PLAYING
                endedRef.current = false;
                playingRef.current = true;
                startPolling();
                onPlay();
              } else if (state === 0) {
                // ENDED
                endedRef.current = true;
                playingRef.current = false;
                stopPolling();
                onEnded();
              } else if (state === 2 || state === 5) {
                // PAUSED or CUED
                playingRef.current = false;
              }
            },
            onPlaybackRateChange: (event: any) => {
              if (onRateChange) onRateChange(event.data);
            },
            onError: (_event: any) => {
              // Player error — don't crash the lesson
            },
          },
        });
      });

      return () => {
        destroyed = true;
        stopPolling();
        try {
          playerRef.current?.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoId]);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        try { playerRef.current?.seekTo(seconds, true); } catch {}
      },
      play: () => {
        try { playerRef.current?.playVideo(); } catch {}
      },
      pause: () => {
        try { playerRef.current?.pauseVideo(); } catch {}
      },
      setPlaybackRate: (rate: number) => {
        try { playerRef.current?.setPlaybackRate(rate); } catch {}
      },
      getCurrentTime: () => currentTimeRef.current,
      getDuration: () => {
        try { return playerRef.current?.getDuration() ?? 0; } catch { return 0; }
      },
      isEnded: () => endedRef.current,
      isPaused: () => !playingRef.current,
    }));

    return (
      <div className="w-full flex-1 flex flex-col min-h-0 bg-black relative" style={{ minHeight: 0 }} id={`yt-player-${blockId}`}>
        <iframe
          ref={containerRef}
          title="YouTube Video Player"
          className="w-full flex-1 bg-black border-none"
          style={{ aspectRatio: "16/9", maxHeight: "calc(100vh - 160px)" }}
          src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&rel=0&modestbranding=1&fs=1&playsinline=1`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation"
        />
        {!playerReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-white text-sm">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-white/70">Loading video…</span>
            </div>
          </div>
        )}
      </div>
    );
  },
);

YouTubeLessonPlayer.displayName = "YouTubeLessonPlayer";

export default YouTubeLessonPlayer;
