import { useState, useRef, DragEvent, ChangeEvent, useEffect } from "react";
import { UploadCloud, Video as VideoIcon, CheckCircle2, AlertCircle, Loader2, Trash2, Play } from "lucide-react";
import { auth } from "../../lib/firebase";

interface VideoUploaderProps {
  videoUrl: string | undefined;
  thumbnailUrl?: string | undefined;
  onVideoUploaded: (url: string, thumbnail?: string) => void;
}

export default function VideoUploader({ videoUrl, thumbnailUrl, onVideoUploaded }: VideoUploaderProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedMeta, setUploadedMeta] = useState<{ name: string; size: string } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [extractedThumbnail, setExtractedThumbnail] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [scrubTime, setScrubTime] = useState<number>(0.5);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState<boolean>(false);
  const extractorVideoRef = useRef<HTMLVideoElement | null>(null);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === Infinity) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  // Setup offscreen extractor video when videoUrl becomes available
  useEffect(() => {
    if (videoUrl) {
      const video = document.createElement("video");
      video.src = videoUrl;
      video.crossOrigin = "anonymous";
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      
      const onLoaded = () => {
        setVideoDuration(video.duration || 0);
        // If there's no pre-existing thumbnail, do an auto extraction at 0.5 seconds
        if (!thumbnailUrl && !extractedThumbnail) {
          video.currentTime = 0.5;
        }
      };

      const onSeeked = () => {
        // Prevent writing if thumbnail already exists and the seek was from a manual action
        if (!thumbnailUrl && !extractedThumbnail && video.currentTime === 0.5) {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = 160;
            canvas.height = 90;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
              setExtractedThumbnail(dataUrl);
              onVideoUploaded(videoUrl, dataUrl);
            }
          } catch (err) {
            console.warn("Auto frame snapshot skipped or CORS-blocked:", err);
          }
        }
      };

      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("seeked", onSeeked);
      extractorVideoRef.current = video;

      return () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("seeked", onSeeked);
      };
    } else {
      extractorVideoRef.current = null;
      setVideoDuration(0);
      setScrubTime(0.5);
    }
  }, [videoUrl, thumbnailUrl]);

  const extractFrameAtTime = (time: number) => {
    const video = extractorVideoRef.current;
    if (!video || !videoUrl) return;

    setIsGeneratingThumbnail(true);
    
    // Define a robust seek complete function
    const handleSeekComplete = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          setExtractedThumbnail(dataUrl);
          onVideoUploaded(videoUrl, dataUrl);
        }
      } catch (err) {
        console.warn("Failed manual frame selection:", err);
      } finally {
        setIsGeneratingThumbnail(false);
        video.removeEventListener("seeked", handleSeekComplete);
      }
    };

    // Remove any stale listeners first to avoid double draw callbacks
    video.removeEventListener("seeked", handleSeekComplete);
    video.addEventListener("seeked", handleSeekComplete);
    
    video.currentTime = Math.min(Math.max(0.1, time), video.duration || 0.1);
  };

  // Helper to format file sizes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Secures the API request using the teacher's IdToken
  const handleUploadFile = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      setUploadError("Invalid file type. Please select a valid video file.");
      return;
    }

    // Increased 600MB file size limit validation mirroring backend
    const limit = 600 * 1024 * 1024;
    if (file.size > limit) {
      setUploadError(`File too large. Maximum supported limit is ${formatBytes(limit)}.`);
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    setUploadedMeta({
      name: file.name,
      size: formatBytes(file.size)
    });

    // Dynamic client-side first frame extraction before/during upload
    try {
      const tempVideo = document.createElement("video");
      const objectUrl = URL.createObjectURL(file);
      tempVideo.src = objectUrl;
      tempVideo.preload = "metadata";
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      tempVideo.onloadedmetadata = () => {
        tempVideo.currentTime = 0.5;
      };
      tempVideo.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 90;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
            setExtractedThumbnail(canvas.toDataURL("image/jpeg", 0.7));
          }
        } catch (e) {
          console.warn("Pre-flight frame grab skipped", e);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
    } catch (e) {
      console.warn("Pre-flight extractor initialization skipped", e);
    }

    try {
      // Fetch teacher's firebase auth id token
      const user = auth.currentUser;
      if (!user) {
        throw new Error("You must be logged in as an authorized teacher to upload materials.");
      }
      const idToken = await user.getIdToken();

      const formData = new FormData();
      formData.append("video", file);

      // We use XHR to track progress beautifully
      const xhr = new XMLHttpRequest();
      
      // Promise-wrapped xhr
      const xhrUpload = () => {
        return new Promise<{ success: boolean; videoUrl?: string; error?: string }>((resolve, reject) => {
          xhr.open("POST", "/api/video/upload", true);
          xhr.setRequestHeader("Authorization", `Bearer ${idToken}`);

          xhr.upload.onprogress = (progressEvent) => {
            if (progressEvent.lengthComputable) {
              const percentCompleted = Math.round(
                (progressEvent.loaded * 100) / progressEvent.total
              );
              setUploadProgress(percentCompleted);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                resolve(response);
              } catch (e) {
                reject(new Error("Unable to parse server upload response."));
              }
            } else {
              try {
                const errResponse = JSON.parse(xhr.responseText);
                reject(new Error(errResponse.error || "Server responded with an upload error."));
              } catch (e) {
                reject(new Error(`Upload failed with status code ${xhr.status}.`));
              }
            }
          };

          xhr.onerror = () => reject(new Error("Network connection error encountered during upload."));
          xhr.onabort = () => reject(new Error("Video upload operation was canceled."));
          
          xhr.send(formData);
        });
      };

      const result = await xhrUpload();
      if (result.success && result.videoUrl) {
        onVideoUploaded(result.videoUrl, extractedThumbnail || undefined);
        setUploadedMeta({
          name: file.name,
          size: formatBytes(file.size)
        });
      } else {
        setUploadError(result.error || "Failed to process video file.");
      }
    } catch (err: any) {
      console.error("Upload handler failed:", err);
      setUploadError(err.message || "An unexpected error occurred during the upload sequence.");
    } finally {
      setIsUploading(false);
    }
  };

  // Drag-and-drop mechanics
  const handleDrag = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleUploadFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleClearVideo = () => {
    onVideoUploaded("", "");
    setExtractedThumbnail(null);
    setUploadedMeta(null);
    setUploadError(null);
  };

  const activeThumbnail = thumbnailUrl || extractedThumbnail;

  return (
    <div className="space-y-4 font-sans select-none" id="block-video-uploader-container">
      {/* Isolated stylesheet for high-fidelity striped progress bar keyframes */}
      <style>{`
        @keyframes uploaderStripes {
          0% { background-position: 0 0; }
          100% { background-position: 40px 0; }
        }
        .animate-uploader-stripes {
          background-image: linear-gradient(
            45deg,
            rgba(255, 255, 255, 0.15) 25%,
            transparent 25%,
            transparent 50%,
            rgba(255, 255, 255, 0.15) 50%,
            rgba(255, 255, 255, 0.15) 75%,
            transparent 75%,
            transparent
          );
          background-size: 40px 40px;
          animation: uploaderStripes 1s linear infinite;
        }
      `}</style>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        className="hidden"
        id="video-uploader-file-input"
        disabled={isUploading}
      />

      {(videoUrl || isUploading) ? (
        // Actively uploading OR fully loaded video layout state
        <div className="flex flex-col sm:flex-row gap-4 items-stretch">
          <div className="flex flex-col gap-2 shrink-0 w-full sm:w-32">
            {/* Thumbnail Preview Area */}
            <div 
              className="w-full h-24 rounded-lg border border-slate-200 bg-slate-950 overflow-hidden flex items-center justify-center relative group shadow-sm text-center"
              id="thumbnail-preview-frame"
            >
              {activeThumbnail ? (
                <img 
                  src={activeThumbnail} 
                  alt="Lecture Video Thumbnail" 
                  className="w-full h-full object-cover transition duration-300" 
                  referrerPolicy="no-referrer"
                />
              ) : (
                isUploading ? (
                  <div className="flex flex-col items-center justify-center gap-1.5 p-2 text-slate-400">
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    <span className="text-[9px] uppercase tracking-wider font-semibold">Extracting...</span>
                  </div>
                ) : (
                  // Live frame renderer fallback
                  <video 
                    src={videoUrl} 
                    preload="metadata" 
                    muted 
                    className="w-full h-full object-cover opacity-75 group-hover:opacity-95 transition pointer-events-none" 
                  />
                )
              )}
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                <span className="text-[9px] font-bold text-white tracking-widest bg-black/60 px-2 py-0.5 rounded border border-white/20 uppercase">
                  {isUploading ? "ANALYZING" : "THUMBNAIL"}
                </span>
              </div>
            </div>

            {/* PERSISTING ANIMATED PROGRESS BAR REGION RIGHT BELOW THE THUMBNAIL */}
            {isUploading && (
              <div className="w-full space-y-1 block animate-pulse" id="thumbnail-persisting-progress-container">
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden border border-slate-300/40 relative">
                  <div 
                    className="bg-gradient-to-r from-blue-500 via-indigo-600 to-blue-600 h-full rounded-full transition-all duration-300 animate-uploader-stripes relative"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] font-mono font-bold text-slate-500">
                  <span>UPLOADING</span>
                  <span>{uploadProgress}%</span>
                </div>
              </div>
            )}

            {/* MANUALLY SCRUB THUMBNAIL FRAME SLIDER */}
            {!isUploading && videoUrl && videoDuration > 0 && (
              <div className="w-full space-y-1 block mt-1" id="thumbnail-scrubber-container">
                <div className="flex justify-between text-[9px] font-mono font-bold text-slate-500">
                  <span>SCRUB FRAME</span>
                  <span>{formatTime(scrubTime)} / {formatTime(videoDuration)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={videoDuration || 100}
                  step="0.1"
                  value={scrubTime}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setScrubTime(val);
                    extractFrameAtTime(val);
                  }}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-ew-resize accent-blue-600 focus:outline-none"
                  id="thumbnail-scrub-slider"
                />
                {isGeneratingThumbnail && (
                  <div className="flex items-center gap-1 text-[8px] font-mono text-blue-600 font-bold justify-center mt-1" id="scrubber-rendering-loader">
                    <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
                    <span>RENDERING FRAME...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div 
            className="flex-1 border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition"
            id="ready-video-card"
          >
            <div className="flex items-center gap-3">
              {isUploading ? (
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-md border border-blue-100 flex items-center justify-center shrink-0">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                </div>
              ) : (
                <div className="p-2.5 bg-green-50 text-green-600 rounded-md border border-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600 animate-pulse" />
                </div>
              )}
              <div>
                <span className="text-xs font-bold text-slate-800 block uppercase tracking-wide">
                  {isUploading ? "Uploading Lecture Material..." : "Video Lesson Material Active"}
                </span>
                <p className="text-[11px] text-slate-500 font-mono select-all line-clamp-1 mt-0.5" id="active-video-path">
                  {isUploading ? "Streaming secure multipart chunk sequence..." : videoUrl}
                </p>
                {uploadedMeta && (
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 font-mono">
                    <span>Name: {uploadedMeta.name}</span>
                    <span>•</span>
                    <span>Size: {uploadedMeta.size}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
              {isUploading ? (
                <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded px-3 py-1.5 text-[10px] font-mono text-slate-600 font-bold select-none uppercase tracking-wide shadow-xs">
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping" />
                  {uploadProgress}% done
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setIsPreviewOpen(true)}
                    className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[10px] font-bold px-3 py-1.5 rounded flex items-center gap-1 cursor-pointer transition shadow-sm uppercase tracking-wide"
                    id="preview-uploaded-video-button"
                  >
                    <Play className="w-3.5 h-3.5 text-blue-600 fill-current" /> Play Preview
                  </button>

                  <button
                    type="button"
                    onClick={handleClearVideo}
                    disabled={isUploading}
                    className="text-red-700 hover:bg-red-50 border border-transparent hover:border-red-100 text-[10px] font-bold px-3 py-1.5 rounded flex items-center gap-1 cursor-pointer transition uppercase tracking-wide"
                    id="clear-uploaded-video-button"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        // File selection / drag-and-drop dropzone
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={triggerFileInput}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center min-h-[140px] ${
            isDragActive 
              ? "border-blue-500 bg-blue-50/50 scale-[0.99]" 
              : "border-slate-300 hover:border-slate-400 bg-slate-50/70 hover:bg-slate-50"
          }`}
          id="dropzone-area"
        >
          <div className="space-y-2" id="idle-dropzone-state">
            <UploadCloud className="w-9 h-9 text-slate-400 mx-auto" />
            <div>
              <p className="text-xs font-bold text-slate-700">
                Drag and drop lecture video stream, or <span className="text-blue-600 hover:underline">browse files</span>
              </p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide font-medium">
                Supports MP4, WebM up to 600 MB files
              </p>
            </div>
          </div>
        </div>
      )}

      {uploadError && (
        <div 
          className="bg-red-50 border border-red-100 text-red-800 text-[11px] p-3 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 select-text"
          id="video-uploader-error"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Upload Rejected: </span>
              {uploadError}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerFileInput();
            }}
            className="shrink-0 bg-red-100 hover:bg-red-200 text-red-900 border border-red-200 px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider cursor-pointer transition shadow-sm"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Elegant, integrated inline modal video player */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0A192F] text-white rounded-xl shadow-2xl border border-slate-800 w-full max-w-3xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <VideoIcon className="w-5 h-5 text-blue-400" />
                <span className="font-sans font-bold text-sm tracking-tight text-slate-250 uppercase">Lecture Material Interactive Previewer</span>
              </div>
              <button 
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="text-slate-400 hover:text-white font-bold text-sm cursor-pointer p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 transition"
              >
                ✕
              </button>
            </div>
            <div className="bg-black p-2 flex items-center justify-center">
              <video 
                src={videoUrl} 
                controls 
                autoPlay 
                className="w-full max-h-[60vh] rounded bg-black"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="p-4 bg-slate-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs border-t border-slate-800">
              <span className="line-clamp-1 select-all text-slate-400 font-mono text-[10px]">{videoUrl}</span>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded text-[10px] uppercase tracking-wider cursor-pointer transition shadow-sm"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
