import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, RefreshCw, X, Loader2, AlertCircle } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  fileNamePrefix?: string;
};

export default function CameraCapture({ open, onClose, onCapture, fileNamePrefix = "foto" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startStream = useCallback(async (mode: "user" | "environment") => {
    stopStream();
    setStatus("loading");
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Tu navegador no soporta acceso a la cámara.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("ready");

      // Detectar si hay más de una cámara para mostrar botón de cambio
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        setHasMultipleCameras(cams.length > 1);
      } catch {
        setHasMultipleCameras(false);
      }
    } catch (err: any) {
      const name = err?.name || "";
      let msg = "No se pudo acceder a la cámara.";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        msg = "Permiso denegado. Habilita el acceso a la cámara en el navegador.";
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        msg = "No se ha detectado ninguna cámara en este dispositivo.";
      } else if (name === "NotReadableError") {
        msg = "La cámara está siendo usada por otra aplicación.";
      } else if (err?.message) {
        msg = err.message;
      }
      setError(msg);
      setStatus("error");
    }
  }, [stopStream]);

  useEffect(() => {
    if (open) {
      startStream(facingMode);
    } else {
      stopStream();
      setStatus("idle");
      setError(null);
    }
    return () => stopStream();
  }, [open, facingMode, startStream, stopStream]);

  const handleSwitchCamera = () => {
    setFacingMode((m) => (m === "user" ? "environment" : "user"));
  };

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || status !== "ready") return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const file = new File([blob], `${fileNamePrefix}-${ts}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        onClose();
      },
      "image/jpeg",
      0.92
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" /> Capturar foto desde webcam
          </DialogTitle>
        </DialogHeader>

        <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain"
          />

          {status === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white gap-2">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="text-sm">Iniciando cámara…</span>
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-3 p-6 text-center">
              <AlertCircle className="w-10 h-10 text-red-400" />
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={() => startStream(facingMode)}>
                Reintentar
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex sm:justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="gap-1.5">
              <X className="w-4 h-4" /> Cancelar
            </Button>
            {hasMultipleCameras && status === "ready" && (
              <Button variant="outline" onClick={handleSwitchCamera} className="gap-1.5">
                <RefreshCw className="w-4 h-4" /> Cambiar cámara
              </Button>
            )}
          </div>
          <Button onClick={handleCapture} disabled={status !== "ready"} className="gap-1.5">
            <Camera className="w-4 h-4" /> Capturar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
