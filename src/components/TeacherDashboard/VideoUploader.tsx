import { useState, useRef, DragEvent, ChangeEvent, useEffect } from "react";
import { UploadCloud, Video as VideoIcon, CheckCircle2, AlertCircle, Loader2, Trash2, Play } from "lucide-react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { auth, storage } from "../../lib/firebase";

interface VideoUploaderProps {
  videoUrl: string | undefined;
  thumbnailUrl?: string | undefined;
  storagePath?: string | undefined;
  duration?: number | undefined;
  onVideoUploaded: (url: string, thumbnail?: string, duration?: number, storagePath?: string) => void;
}

export default function VideoUploader({ videoUrl, thumbnailUrl, storagePath, duration, onVideoUploaded }: VideoUploaderProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedMeta, setUploadedMeta] = useState<{ name: string; size: string } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [extractedThumbnail, setExtractedThumbnail] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [videoDuration, setVideoDuration] = useState<number>(duration || 0);
  const [scrubTime, setScrubTime] = useState<number>(0.5);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState<boolean>(false);
  const inlineVideoRef = useRef<HTMLVideoElement | null>(null);
  const isResolvingRef = useRef(false);

  const bucket = storage.app.options.storageBucket || "gen-lang-client-0781925544.firebasestorage.app";
  const displayedVideoUrl = videoUrl || (storagePath ? (storagePath.startsWith("uploads/") ? `/${storagePath}` : `https://firebasestorage.googleapis.com/v1/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`) : "");

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === Infinity) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  // Automated resolver to check if a saved storagePath is present in database but URL hasn't been retrieved
  useEffect(() => {
    if (storagePath && !videoUrl && !isResolvingRef.current) {
      if (storagePath.startsWith("uploads/")) {
        onVideoUploaded(`/${storagePath}`, thumbnailUrl || extractedThumbnail || undefined, duration, storagePath);
        return;
      }
      isResolvingRef.current = true;
      const fileRef = ref(storage, storagePath);
      getDownloadURL(fileRef)
        .then((url) => {
          onVideoUploaded(url, thumbnailUrl || extractedThumbnail || undefined, duration, storagePath);
        })
        .catch((err) => {
          console.error("Auto-resolving storage path URL failed, using fallback:", err);
          const fallbackUrl = `https://firebasestorage.googleapis.com/v1/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`;
          onVideoUploaded(fallbackUrl, thumbnailUrl || extractedThumbnail || undefined, duration, storagePath);
        })
        .finally(() => {
          isResolvingRef.current = false;
        });
    }
  }, [storagePath, videoUrl]);

  const extractFrameAtTime = (time: number) => {
    const video = inlineVideoRef.current;
    if (!video || !displayedVideoUrl) return;

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
          onVideoUploaded(displayedVideoUrl, dataUrl, video.duration || videoDuration, storagePath);
        }
      } catch (err) {
        console.warn("Failed manual frame selection:", err);
      } finally {
        setIsGeneratingThumbnail(false);
        video.removeEventListener("seeked", handleSeekComplete);
      }
    };

    video.removeEventListener("seeked", handleSeekComplete);
    video.addEventListener("seeked", handleSeekComplete);
    
    video.currentTime = Math.min(Math.max(0.1, time), video.duration || videoDuration || 0.1);
  };

  // Extract duration and grab a thumbnail frame locally before uploading
  const extractLocalVideoMetadata = (file: File): Promise<{ duration: number; thumbnail: string | null }> => {
    return new Promise((resolve) => {
      try {
        const video = document.createElement("video");
        const objectUrl = URL.createObjectURL(file);
        video.src = objectUrl;
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;

        const finish = (duration: number, thumbnail: string | null) => {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch (e) {
            console.warn("Revoking object URL failed", e);
          }
          resolve({ duration, thumbnail });
        };

        video.onloadedmetadata = () => {
          video.currentTime = Math.min(0.5, video.duration || 0.1);
        };

        video.onseeked = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = 160;
            canvas.height = 90;
            const ctx = canvas.getContext("2d");
            let thumbnail: string | null = null;
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              thumbnail = canvas.toDataURL("image/jpeg", 0.7);
            }
            finish(video.duration || 0, thumbnail);
          } catch (e) {
            console.warn("Local thumbnail extraction failed:", e);
            finish(video.duration || 0, null);
          }
        };

        video.onerror = () => {
          console.warn("Local video metadata load failed.");
          finish(0, null);
        };
      } catch (e) {
        console.warn("Local video metadata reader setup failed:", e);
        resolve({ duration: 0, thumbnail: null });
      }
    });
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

    try {
      // 1. Asynchronously extract local video metadata (duration & thumbnail frame)
      const localMeta = await extractLocalVideoMetadata(file);
      setVideoDuration(localMeta.duration);
      if (localMeta.thumbnail) {
        setExtractedThumbnail(localMeta.thumbnail);
      }

      // 2. Fetch teacher's firebase auth check
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : "";

      let result: { videoUrl: string; storagePath: string };
      let uploadedViaClient = false;

      // Primary Attempt: Try Direct Client-Side Firebase Storage upload
      try {
        if (!user) {
          throw new Error("No authenticated teacher session found. Please sign in to Google classroom.");
        }

        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const dotIndex = file.name.lastIndexOf(".");
        const ext = dotIndex !== -1 ? file.name.slice(dotIndex) : "";
        const base = dotIndex !== -1 ? file.name.slice(0, dotIndex).replace(/[^a-zA-Z0-9]/g, "_") : file.name.replace(/[^a-zA-Z0-9]/g, "_");
        const filename = `${base}-${uniqueSuffix}${ext}`;
        const fileStoragePath = `videos/${filename}`;
        const fileRef = ref(storage, fileStoragePath);

        const uploadTask = uploadBytesResumable(fileRef, file, {
          contentType: file.type
        });

        const performClientSideUpload = () => {
          return new Promise<{ videoUrl: string; storagePath: string }>((resolve, reject) => {
            uploadTask.on(
              "state_changed",
              (snapshot) => {
                const progress = Math.round(
                  (snapshot.bytesTransferred / snapshot.totalBytes) * 100
                );
                setUploadProgress(progress);
              },
              (error) => {
                reject(new Error(error.message || "Firebase Storage client upload failed."));
              },
              async () => {
                try {
                  const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                  resolve({
                    videoUrl: downloadURL,
                    storagePath: fileStoragePath
                  });
                } catch (err: any) {
                  reject(new Error(err.message || "Failed to retrieve direct bucket download URL."));
                }
              }
            );
          });
        };

        result = await performClientSideUpload();
        uploadedViaClient = true;
        console.log("VERITAS Learn - Direct Firebase Storage client-side upload succeeded:", result);
      } catch (clientErr: any) {
        console.warn("VERITAS Learn - Firebase Client SDK write failed or uninitialized, falling back to server-side upload proxy. error:", clientErr.message || clientErr);
        
        // Secondary Fallback: Upload via server-side API proxy with XMLHttpRequest progress tracking
        const uploadWithProgress = () => {
          return new Promise<{ videoUrl: string; storagePath: string }>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/video/upload");
            if (token) {
              xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            }
            
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const progress = Math.round((event.loaded / event.total) * 100);
                setUploadProgress(progress);
              }
            };
            
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  const response = JSON.parse(xhr.responseText);
                  if (response.success) {
                    resolve({
                      videoUrl: response.videoUrl,
                      storagePath: response.storagePath
                    });
                  } else {
                    reject(new Error(response.error || "Failed file payload response from proxy server."));
                  }
                } catch (e) {
                  reject(new Error("Invalid response form from proxy server."));
                }
              } else {
                try {
                  const res = JSON.parse(xhr.responseText);
                  reject(new Error(res.error || `Proxy server returned status code: ${xhr.status}`));
                } catch {
                  reject(new Error(`Proxy server returned status code: ${xhr.status}`));
                }
              }
            };
            
            xhr.onerror = () => {
              reject(new Error("Network connection error connecting to server-side upload proxy."));
            };
            
            const formData = new FormData();
            formData.append("video", file);
            xhr.send(formData);
          });
        };

        result = await uploadWithProgress();
      }

      onVideoUploaded(
        result.videoUrl,
        localMeta.thumbnail || undefined,
        localMeta.duration,
        result.storagePath
      );
      setUploadedMeta({
        name: file.name,
        size: formatBytes(file.size)
      });
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
    onVideoUploaded("", "", 0, "");
    setExtractedThumbnail(null);
    setUploadedMeta(null);
    setUploadError(null);
  };

  const activeThumbnail = thumbnailUrl || extractedThumbnail;

  return (
    <div className="space-y-4 font-sans" id="block-video-uploader-container">
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

      {isUploading ? (
        // Actively uploading progress view
        <div className="flex flex-col sm:flex-row gap-4 items-stretch border border-slate-200 bg-slate-50 rounded-lg p-5">
          <div className="flex flex-col gap-2 shrink-0 w-full sm:w-32">
            {/* Thumbnail Placeholder */}
            <div 
              className="w-full h-24 rounded-lg border border-slate-200 bg-slate-950 overflow-hidden flex items-center justify-center relative shadow-sm text-center"
              id="thumbnail-preview-frame"
            >
              <div className="flex flex-col items-center justify-center gap-1.5 p-2 text-slate-400">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                <span className="text-[9px] uppercase tracking-wider font-semibold">Extracting...</span>
              </div>
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                <span className="text-[9px] font-bold text-white tracking-widest bg-black/60 px-2 py-0.5 rounded border border-white/20 uppercase">
                  ANALYZING
                </span>
              </div>
            </div>

            {/* Progress indicator */}
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
          </div>

          <div 
            className="flex-1 border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition"
            id="ready-video-card"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-md border border-blue-100 flex items-center justify-center shrink-0">
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-800 block uppercase tracking-wide">
                  Uploading Lecture Material...
                </span>
                <p className="text-[11px] text-slate-500 font-mono select-all line-clamp-1 mt-0.5" id="active-video-path">
                  Streaming secure multipart chunk sequence...
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
              <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded px-3 py-1.5 text-[10px] font-mono text-slate-600 font-bold select-none uppercase tracking-wide shadow-xs">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping" />
                {uploadProgress}% done
              </div>
            </div>
          </div>
        </div>
      ) : displayedVideoUrl ? (
        // RENDER INLINE VIDEO PLAYER PREVIEW DIRECTLY!
        <div className="border border-slate-200 bg-slate-900 rounded-lg p-4 flex flex-col gap-4 shadow-sm" id="inline-video-preview-wrapper">
          <div className="relative rounded-lg overflow-hidden bg-black border border-slate-850 flex items-center justify-center aspect-video w-full max-h-[300px]" id="inline-video-player-container">
            <video 
              ref={inlineVideoRef}
              src={displayedVideoUrl} 
              controls 
              preload="metadata" 
              crossOrigin="anonymous"
              className="w-full h-full max-h-[300px] rounded-lg object-contain"
              referrerPolicy="no-referrer"
              onLoadedMetadata={(e) => {
                const dur = e.currentTarget.duration || 0;
                if (dur > 0 && dur !== videoDuration) {
                  setVideoDuration(dur);
                }
              }}
            />
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs text-slate-300 font-sans">
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-[10px] font-bold rounded-sm border border-green-500/20 uppercase tracking-wide">
                  Active Video Lecture
                </span>
                {videoDuration > 0 && (
                  <span className="text-slate-300 font-mono text-[10px] font-semibold bg-slate-800 px-2 py-0.5 rounded-sm">
                    Duration: {formatTime(videoDuration)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-mono break-all line-clamp-1 select-all" title={displayedVideoUrl}>
                Source: {displayedVideoUrl}
              </p>
              {uploadedMeta && (
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                  <span>Name: {uploadedMeta.name}</span>
                  <span>•</span>
                  <span>Size: {uploadedMeta.size}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
              <button
                type="button"
                onClick={handleClearVideo}
                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-350 border border-red-500/15 hover:border-red-500/30 text-[10px] font-bold px-3.5 py-1.5 rounded-md flex items-center gap-1.5 cursor-pointer transition uppercase tracking-wide shadow-sm"
                id="delete-video-btn"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove Video
              </button>
            </div>
          </div>

          {/* COURSE REPRESENTATIVE THUMBNAIL FRAME SLIDER INTEGRATION */}
          {videoDuration > 0 && (
            <div className="bg-slate-950/45 border border-slate-800/40 rounded-lg p-3 space-y-2 text-slate-300">
              <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-400">
                <span className="flex items-center gap-1.5">
                  {activeThumbnail && (
                    <img 
                      src={activeThumbnail} 
                      alt="Thumbnail Frame" 
                      className="w-10 h-6 object-cover rounded border border-slate-700 inline-block mr-1" 
                      referrerPolicy="no-referrer"
                    />
                  )}
                  Select Course Representative Thumbnail
                </span>
                <span>{formatTime(scrubTime)} / {formatTime(videoDuration)}</span>
              </div>
              <div className="flex items-center gap-2">
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
                  className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-ew-resize accent-blue-500 hover:accent-blue-400 focus:outline-none"
                  id="thumbnail-scrub-slider"
                />
              </div>
              {isGeneratingThumbnail && (
                <div className="flex items-center gap-1 text-[9px] font-mono text-blue-400 font-bold justify-center" id="scrubber-rendering-loader">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  <span>EXTRACTING FRAME SNAPSHOT...</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        // Standard Dotted Drag / Drop area when no video is present
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
                Drag and drop video stream, or <span className="text-blue-600 hover:underline">browse files</span>
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
                <span className="font-sans font-bold text-sm tracking-tight text-slate-300 uppercase">Lecture Material Interactive Previewer</span>
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
                src={displayedVideoUrl} 
                controls 
                autoPlay 
                crossOrigin="anonymous"
                className="w-full max-h-[60vh] rounded bg-black"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="p-4 bg-slate-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs border-t border-slate-800">
              <span className="line-clamp-1 select-all text-slate-400 font-mono text-[10px]">{displayedVideoUrl}</span>
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
