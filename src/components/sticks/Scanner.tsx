"use client";

// ---------------------------------------------------------------------------
// Scanner — camera capture / photo upload / manual entry, with tesseract.js
// OCR (dynamically imported client-side only, exactly like the original) to
// pull a TILT serial number out of the image. Ported from tiltinventory's
// components/Scanner.tsx and restyled to the hub's dark theme.
// ---------------------------------------------------------------------------
import { useRef, useState, useCallback } from "react";

interface ScannerProps {
  onSerialDetected: (serial: string) => void;
  disabled?: boolean;
}

export default function Scanner({ onSerialDetected, disabled = false }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [manualSerial, setManualSerial] = useState("");
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStreaming(true);
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Unable to access camera. Please use the file upload or manual entry instead.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
  }, []);

  const captureAndProcess = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const imageDataUrl = canvas.toDataURL("image/png");

    await processImage(imageDataUrl);
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const imageDataUrl = event.target?.result as string;
      await processImage(imageDataUrl);
    };
    reader.readAsDataURL(file);
  }, []);

  const processImage = async (imageDataUrl: string) => {
    setProcessing(true);
    try {
      const Tesseract = await import("tesseract.js");
      const { data: { text } } = await Tesseract.recognize(imageDataUrl, "eng", {
        logger: () => {},
      });

      // Look for TILT serial number pattern: H followed by 4 digits, dash, 5 digits
      const serialPattern = /[HhHl][0-9]{4}[-–—][0-9]{5}/g;
      const matches = text.match(serialPattern);

      if (matches && matches.length > 0) {
        // Normalize: uppercase and use standard dash
        const serial = matches[0].toUpperCase().replace(/[–—]/g, "-").replace(/^[Ll]/, "H");
        onSerialDetected(serial);
      } else {
        // Try a more relaxed pattern - just look for something resembling the format
        const relaxedPattern = /[A-Za-z][0-9]{4}[-–—\s]?[0-9]{5}/g;
        const relaxedMatches = text.match(relaxedPattern);
        if (relaxedMatches && relaxedMatches.length > 0) {
          let serial = relaxedMatches[0].toUpperCase().replace(/[–—\s]/g, "-");
          if (!serial.includes("-")) {
            serial = serial.slice(0, 5) + "-" + serial.slice(5);
          }
          onSerialDetected(serial);
        } else {
          alert(
            `Could not detect a serial number in the image.\n\nOCR detected text: "${text.trim().substring(0, 200)}"\n\nPlease try again or enter the serial number manually.`
          );
        }
      }
    } catch (err) {
      console.error("OCR error:", err);
      alert("Failed to process image. Please try again or enter the serial number manually.");
    } finally {
      setProcessing(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualSerial.trim()) {
      onSerialDetected(manualSerial.trim().toUpperCase());
      setManualSerial("");
    }
  };

  return (
    <div className="space-y-6">
      {/* Camera Section */}
      <div className="bg-[#101010] rounded-xl border border-gray-800 overflow-hidden">
        <div className="p-5">
          <h2 className="text-lg font-bold text-gray-200 mb-4">Scan Serial Number</h2>

          <div className="relative bg-black rounded-lg overflow-hidden mb-4" style={{ minHeight: streaming ? 300 : 0 }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={`w-full ${streaming ? "block" : "hidden"}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {streaming && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="border-2 border-[#00d6ff] rounded-lg w-3/4 h-16 opacity-70" />
              </div>
            )}
          </div>

          <div className="flex gap-3">
            {!streaming ? (
              <button
                onClick={startCamera}
                disabled={disabled || processing}
                className="flex-1 bg-[#00d6ff] text-black py-3 px-4 rounded-lg font-semibold
                  hover:bg-[#33e0ff] focus:outline-none focus:ring-2 focus:ring-[#00d6ff]/60 focus:ring-offset-2 focus:ring-offset-[#101010]
                  disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Open Camera
              </button>
            ) : (
              <>
                <button
                  onClick={captureAndProcess}
                  disabled={disabled || processing}
                  className="flex-1 bg-emerald-600 text-white py-3 px-4 rounded-lg font-semibold
                    hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-[#101010]
                    disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {processing ? "Reading..." : "Capture"}
                </button>
                <button
                  onClick={stopCamera}
                  className="bg-gray-800 text-gray-200 py-3 px-4 rounded-lg font-semibold
                    hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-[#101010]
                    transition-colors"
                >
                  Stop
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* File Upload */}
      <div className="bg-[#101010] rounded-xl border border-gray-800 overflow-hidden">
        <div className="p-5">
          <h2 className="text-lg font-bold text-gray-200 mb-4">Upload Photo</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
            disabled={disabled || processing}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4
              file:rounded-lg file:border-0 file:text-sm file:font-semibold
              file:bg-gray-800 file:text-gray-200 hover:file:bg-gray-700
              disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {processing && (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-300">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing image...
            </div>
          )}
        </div>
      </div>

      {/* Manual Entry */}
      <div className="bg-[#101010] rounded-xl border border-gray-800 overflow-hidden">
        <div className="p-5">
          <h2 className="text-lg font-bold text-gray-200 mb-4">Manual Entry</h2>
          <form onSubmit={handleManualSubmit} className="flex gap-3">
            <input
              type="text"
              value={manualSerial}
              onChange={(e) => setManualSerial(e.target.value)}
              placeholder="e.g. H2304-02571"
              disabled={disabled || processing}
              className="flex-1 px-4 py-2.5 bg-black/40 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder:text-gray-600
                focus:ring-2 focus:ring-[#00d6ff]/50 focus:border-[#00d6ff]/60 focus:outline-none
                disabled:opacity-50 disabled:cursor-not-allowed font-mono"
            />
            <button
              type="submit"
              disabled={disabled || processing || !manualSerial.trim()}
              className="bg-[#00d6ff] text-black py-2.5 px-6 rounded-lg font-semibold text-sm
                hover:bg-[#33e0ff] focus:outline-none focus:ring-2 focus:ring-[#00d6ff]/60 focus:ring-offset-2 focus:ring-offset-[#101010]
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Search
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
