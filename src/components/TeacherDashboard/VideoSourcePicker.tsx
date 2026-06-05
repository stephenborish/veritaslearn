/**
 * VideoSourcePicker — teacher-facing video source selector.
 *
 * Three source modes:
 *   Upload video   – preserves existing Firebase Storage upload behavior
 *   YouTube        – paste a YouTube link, shows validation + preview card
 *   Direct link    – paste an .mp4, .webm, or other browser-playable URL
 *
 * Replaces the old VideoUploader + "Or paste a video link" field combination.
 */
import React, { useState } from "react";
import { Upload, Youtube, Link2, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import VideoUploader from "./VideoUploader";
import {
  parseYouTubeUrl,
  isYouTubeParseError,
  looksLikeYouTubeUrl,
  type YouTubeParseResult,
} from "../../utils/youtubeParser";

type SourceMode = "upload" | "youtube" | "direct";

interface VideoSourcePickerProps {
  // Current block state
  videoUrl?: string;
  thumbnailUrl?: string;
  storagePath?: string;
  duration?: number;
  videoSource?: "upload" | "youtube" | "direct";
  youtubeVideoId?: string;
  youtubeEmbedUrl?: string;

  // Upload path — same signature as VideoUploader
  onVideoUploaded: (url: string, thumbnail?: string, duration?: number, storagePath?: string) => void;
  onThumbnailSelected?: (thumbnailUrl: string) => void;

  // YouTube path
  onYouTubeSelected: (
    videoId: string,
    youtubeUrl: string,
    embedUrl: string,
    thumbnailUrl: string,
    duration?: number,
  ) => void;

  // Direct link path
  onDirectLinkSelected: (url: string) => void;
}

function detectInitialMode(
  videoSource?: string,
  videoUrl?: string,
  storagePath?: string,
  youtubeVideoId?: string,
): SourceMode {
  if (videoSource === "youtube" || youtubeVideoId) return "youtube";
  if (videoSource === "upload" || storagePath) return "upload";
  if (videoSource === "direct") return "direct";
  if (videoUrl && looksLikeYouTubeUrl(videoUrl)) return "youtube";
  if (videoUrl) return "direct";
  return "upload";
}

export default function VideoSourcePicker({
  videoUrl,
  thumbnailUrl,
  storagePath,
  duration,
  videoSource,
  youtubeVideoId,
  youtubeEmbedUrl,
  onVideoUploaded,
  onThumbnailSelected,
  onYouTubeSelected,
  onDirectLinkSelected,
}: VideoSourcePickerProps) {
  const [activeMode, setActiveMode] = useState<SourceMode>(() =>
    detectInitialMode(videoSource, videoUrl, storagePath, youtubeVideoId)
  );

  const [ytInputUrl, setYtInputUrl] = useState<string>(
    youtubeVideoId
      ? `https://www.youtube.com/watch?v=${youtubeVideoId}`
      : (videoUrl && looksLikeYouTubeUrl(videoUrl) ? videoUrl : "")
  );
  const [ytResult, setYtResult] = useState<YouTubeParseResult | null>(() => {
    const init = youtubeVideoId
      ? `https://www.youtube.com/watch?v=${youtubeVideoId}`
      : (videoUrl && looksLikeYouTubeUrl(videoUrl) ? videoUrl : "");
    if (!init) return null;
    const r = parseYouTubeUrl(init);
    return isYouTubeParseError(r) ? null : r;
  });
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytDurationLoaded, setYtDurationLoaded] = useState<number | undefined>(duration);

  const [directUrl, setDirectUrl] = useState<string>(
    videoSource === "direct" ? (videoUrl || "") : (videoUrl && !looksLikeYouTubeUrl(videoUrl) && !storagePath ? videoUrl : "")
  );

  const handleModeSwitch = (mode: SourceMode) => {
    setActiveMode(mode);
  };

  const handleYtUrlChange = (url: string) => {
    setYtInputUrl(url);
    if (!url.trim()) {
      setYtResult(null);
      setYtError(null);
      return;
    }
    const result = parseYouTubeUrl(url);
    if (isYouTubeParseError(result)) {
      setYtResult(null);
      setYtError(result.error);
    } else {
      setYtResult(result);
      setYtError(null);
      onYouTubeSelected(
        result.videoId,
        result.canonicalUrl,
        result.embedUrl,
        result.thumbnailUrl,
        ytDurationLoaded,
      );
    }
  };

  const handleDirectUrlChange = (url: string) => {
    setDirectUrl(url);
    onDirectLinkSelected(url);
  };

  const directLooksPlayable =
    !directUrl ||
    /\.(mp4|webm|ogg|mov|mkv|avi)(\?.*)?$/i.test(directUrl) ||
    /\/[^/?#]+\?.*$/i.test(directUrl);

  const tabs: Array<{ mode: SourceMode; icon: React.ReactNode; label: string }> = [
    { mode: "upload", icon: <Upload className="w-3.5 h-3.5" />, label: "Upload video" },
    { mode: "youtube", icon: <Youtube className="w-3.5 h-3.5" />, label: "YouTube" },
    { mode: "direct", icon: <Link2 className="w-3.5 h-3.5" />, label: "Direct video link" },
  ];

  return (
    <div className="space-y-3" id="video-source-picker">
      {/* Tab row */}
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg" role="tablist">
        {tabs.map(({ mode, icon, label }) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={activeMode === mode}
            onClick={() => handleModeSwitch(mode)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold transition cursor-pointer
              ${activeMode === mode
                ? "bg-white text-[#0A192F] shadow-sm border border-slate-200"
                : "text-slate-500 hover:text-slate-700"
              }`}
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{mode === "upload" ? "Upload" : mode === "youtube" ? "YouTube" : "Link"}</span>
          </button>
        ))}
      </div>

      {/* Upload tab */}
      {activeMode === "upload" && (
        <VideoUploader
          videoUrl={videoSource === "upload" || (!videoSource && storagePath) ? videoUrl : undefined}
          thumbnailUrl={videoSource === "upload" || (!videoSource && storagePath) ? thumbnailUrl : undefined}
          storagePath={storagePath}
          duration={duration}
          onVideoUploaded={onVideoUploaded}
          onThumbnailSelected={onThumbnailSelected}
        />
      )}

      {/* YouTube tab */}
      {activeMode === "youtube" && (
        <div className="space-y-3">
          <div>
            <label className="font-semibold text-slate-700 block mb-1 text-xs">Paste a YouTube link</label>
            <input
              type="url"
              value={ytInputUrl}
              onChange={(e) => handleYtUrlChange(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
              className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-400 text-slate-800"
              id="youtube-url-input"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {ytError && ytInputUrl.trim() && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded p-2.5 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{ytError}</span>
            </div>
          )}

          {ytResult && (
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white" id="youtube-preview-card">
              {/* Thumbnail row */}
              <div className="flex gap-3 p-3 border-b border-slate-100">
                <div className="w-20 h-12 rounded overflow-hidden bg-slate-900 shrink-0 flex items-center justify-center">
                  <img
                    src={ytResult.thumbnailUrl}
                    alt="Video thumbnail"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="text-[11px] font-bold text-emerald-700">YouTube video ready</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono truncate">ID: {ytResult.videoId}</p>
                  <a
                    href={ytResult.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                  >
                    Open on YouTube <ExternalLink className="w-2.5 h-2.5 inline" />
                  </a>
                </div>
              </div>

              {/* Small embedded preview */}
              <div className="bg-black aspect-video w-full max-h-[200px] relative">
                <iframe
                  src={youtubeEmbedUrl || ytResult.embedUrl}
                  title="YouTube preview"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                  id="youtube-embed-preview"
                />
              </div>

              <div className="px-3 py-2 bg-amber-50 border-t border-amber-100 flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-800 leading-snug">
                  This video is hosted on YouTube. Students need access to YouTube to watch it.
                </p>
              </div>
            </div>
          )}

          {!ytResult && !ytInputUrl.trim() && (
            <div className="text-center py-6 border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
              <Youtube className="w-7 h-7 mx-auto mb-1.5 text-slate-300" />
              <p className="text-[11px] font-semibold text-slate-500">Paste a YouTube link to add a video</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Supports watch links, short links, embeds, and Shorts</p>
            </div>
          )}
        </div>
      )}

      {/* Direct link tab */}
      {activeMode === "direct" && (
        <div className="space-y-3">
          <div>
            <label className="font-semibold text-slate-700 block mb-1 text-xs">Paste a direct video link</label>
            <input
              type="url"
              value={directUrl}
              onChange={(e) => handleDirectUrlChange(e.target.value)}
              placeholder="https://example.com/lecture.mp4"
              className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-slate-400 text-slate-800"
              id="direct-video-url-input"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[10px] text-slate-400 mt-1">Supports MP4, WebM, and other browser-playable formats</p>
          </div>

          {directUrl && !directLooksPlayable && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded p-2.5 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>This link may not play in the browser. Make sure it points directly to a video file (MP4, WebM, etc.).</span>
            </div>
          )}

          {directUrl && (
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-black">
              <video
                src={directUrl}
                controls
                preload="metadata"
                className="w-full max-h-[200px] bg-black"
                crossOrigin="anonymous"
                id="direct-video-preview"
              />
            </div>
          )}

          {!directUrl && (
            <div className="text-center py-6 border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
              <Link2 className="w-7 h-7 mx-auto mb-1.5 text-slate-300" />
              <p className="text-[11px] font-semibold text-slate-500">Paste a direct video link</p>
              <p className="text-[10px] text-slate-400 mt-0.5">The URL must point directly to a video file</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
