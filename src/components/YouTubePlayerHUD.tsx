import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  X,
  ExternalLink,
  Music,
} from "lucide-react";

export interface ActiveMedia {
  videoId: string;
  title: string;
  query?: string;
}

interface YouTubePlayerHUDProps {
  media: ActiveMedia | null;
  onClose: () => void;
  mediaCommand?: { action: string; value?: number; id: number } | null;
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

export const YouTubePlayerHUD: React.FC<YouTubePlayerHUDProps> = ({
  media,
  onClose,
  mediaCommand,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(80);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isReady, setIsReady] = useState<boolean>(false);

  // Initialize YouTube IFrame Player API
  useEffect(() => {
    if (!media?.videoId) return;

    let isSubscribed = true;

    const loadPlayer = () => {
      if (!window.YT || !window.YT.Player) return;

      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
      }

      const playerElement = document.getElementById("jarvis-youtube-iframe");
      if (!playerElement) return;

      playerRef.current = new window.YT.Player("jarvis-youtube-iframe", {
        videoId: media.videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            if (!isSubscribed) return;
            setIsReady(true);
            try {
              event.target.setVolume(volume);
              event.target.playVideo();
            } catch {}
          },
          onStateChange: (event: any) => {
            if (!isSubscribed) return;
            // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0
            setIsPlaying(event.data === 1);
          },
        },
      });
    };

    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = () => {
        loadPlayer();
      };
    } else {
      loadPlayer();
    }

    return () => {
      isSubscribed = false;
    };
  }, [media?.videoId]);

  // Handle external voice commands on the player
  useEffect(() => {
    if (!mediaCommand || !playerRef.current || !isReady) return;

    try {
      const { action, value } = mediaCommand;
      if (action === "pause" || action === "stop") {
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      } else if (action === "resume" || action === "play") {
        playerRef.current.playVideo();
        setIsPlaying(true);
      } else if (action === "volume_set" && value !== undefined) {
        const clamped = Math.max(0, Math.min(100, value));
        playerRef.current.setVolume(clamped);
        setVolume(clamped);
      } else if (action === "mute") {
        playerRef.current.mute();
        setIsMuted(true);
      } else if (action === "unmute") {
        playerRef.current.unMute();
        setIsMuted(false);
      }
    } catch {}
  }, [mediaCommand, isReady]);

  const togglePlay = useCallback(() => {
    if (!playerRef.current) return;
    try {
      if (isPlaying) {
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      } else {
        playerRef.current.playVideo();
        setIsPlaying(true);
      }
    } catch {}
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (!playerRef.current) return;
    try {
      if (isMuted) {
        playerRef.current.unMute();
        setIsMuted(false);
      } else {
        playerRef.current.mute();
        setIsMuted(true);
      }
    } catch {}
  }, [isMuted]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    if (playerRef.current) {
      try {
        playerRef.current.setVolume(val);
        if (val > 0 && isMuted) {
          playerRef.current.unMute();
          setIsMuted(false);
        }
      } catch {}
    }
  };

  if (!media) return null;

  return (
    <aside
      aria-label="YouTube Media Player"
      ref={containerRef}
      className={`fixed z-40 transition-all duration-300 pointer-events-auto ${
        isMinimized
          ? "bottom-20 right-4 w-72 h-auto"
          : "bottom-24 right-4 sm:right-8 w-80 sm:w-96"
      }`}
    >
      <div className="overflow-hidden rounded-2xl bg-slate-950/90 border border-cyan-500/40 backdrop-blur-xl shadow-[0_10px_40px_rgba(6,182,212,0.25)] flex flex-col animate-in slide-in-from-bottom-5">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900/60 border-b border-white/10 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Music className="w-3.5 h-3.5 text-cyan-400 shrink-0 animate-pulse" />
            <span className="font-display font-medium text-slate-200 truncate">
              {media.title || media.query || "YouTube Playback"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsMinimized((prev) => !prev)}
              className="p-1 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
              title={isMinimized ? "Expand Player" : "Minimize Player"}
            >
              {isMinimized ? (
                <Maximize2 className="w-3.5 h-3.5" />
              ) : (
                <Minimize2 className="w-3.5 h-3.5" />
              )}
            </button>
            <a
              href={`https://www.youtube.com/watch?v=${media.videoId}`}
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
              title="Open on YouTube"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
              title="Close Player"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Video Frame */}
        <div
          className={`relative bg-black transition-all ${
            isMinimized ? "h-0 hidden" : "w-full aspect-video"
          }`}
        >
          <div id="jarvis-youtube-iframe" className="w-full h-full" />
        </div>

        {/* Control Strip */}
        <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/40 gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 transition-colors cursor-pointer shrink-0"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </button>

          <div className="flex items-center gap-2 flex-1">
            <button
              type="button"
              onClick={toggleMute}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
          </div>

          <span className="text-[10px] font-mono text-slate-400 shrink-0">
            {isMuted ? "0%" : `${volume}%`}
          </span>
        </div>
      </div>
    </aside>
  );
};

