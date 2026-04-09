import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Camera, CameraOff, Loader2 } from 'lucide-react';
import { HandUpdate, HandGesture } from '../types';

interface HandTrackerProps {
  enabled: boolean;
  showPreview: boolean;
  onHandUpdate: (handPos: HandUpdate | null) => void;
}

function detectGesture(landmarks: NormalizedLandmark[]): { gesture: HandGesture; pinchDistance: number; fingers: boolean[] } {
  // Finger tip and MCP landmarks
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const indexMCP = landmarks[5];
  const middleMCP = landmarks[9];
  const ringMCP = landmarks[13];
  const pinkyMCP = landmarks[17];

  // Check which fingers are extended (tip above MCP in y)
  const indexUp = indexTip.y < indexMCP.y;
  const middleUp = middleTip.y < middleMCP.y;
  const ringUp = ringTip.y < ringMCP.y;
  const pinkyUp = pinkyTip.y < pinkyMCP.y;

  // Thumb: compare x distance from palm center
  const thumbUp = Math.abs(thumbTip.x - landmarks[0].x) > Math.abs(landmarks[2].x - landmarks[0].x) * 1.2;

  const fingers = [thumbUp, indexUp, middleUp, ringUp, pinkyUp];

  // Pinch distance (thumb tip to index tip)
  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  const pinchDistance = Math.sqrt(dx * dx + dy * dy);

  // Gesture detection
  if (pinchDistance < 0.06) {
    return { gesture: 'pinch', pinchDistance: pinchDistance * 10, fingers };
  }

  if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
    return { gesture: 'fist', pinchDistance: pinchDistance * 10, fingers };
  }

  if (indexUp && middleUp && ringUp && pinkyUp) {
    return { gesture: 'open_palm', pinchDistance: pinchDistance * 10, fingers };
  }

  if (indexUp && !middleUp && !ringUp && !pinkyUp) {
    return { gesture: 'point', pinchDistance: pinchDistance * 10, fingers };
  }

  return { gesture: 'none', pinchDistance: pinchDistance * 10, fingers };
}

export const HandTracker: React.FC<HandTrackerProps> = ({ enabled, showPreview, onHandUpdate }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentGesture, setCurrentGesture] = useState<HandGesture>('none');
  const requestRef = useRef<number>(0);
  const waveTrackRef = useRef<{ positions: number[]; timestamps: number[] }>({ positions: [], timestamps: [] });

  useEffect(() => {
    if (!enabled) {
      stopCamera();
      return;
    }

    const initHandTracking = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });

        await startCamera();
      } catch (err) {
        console.error("Failed to init hand tracking:", err);
        setError("Could not initialize camera or hand tracking.");
      } finally {
        setIsLoading(false);
      }
    };

    initHandTracking();

    return () => {
      stopCamera();
    };
  }, [enabled]);

  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });
      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener('loadeddata', predictWebcam);
    } catch (err) {
      console.error("Error starting camera:", err);
      setError("Camera access denied.");
    }
  };

  const stopCamera = () => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    onHandUpdate(null);
  };

  const predictWebcam = async () => {
    if (!videoRef.current || !handLandmarkerRef.current) return;

    if (videoRef.current.currentTime !== -1) {
      const results = handLandmarkerRef.current.detectForVideo(videoRef.current, performance.now());

      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        const indexTip = landmarks[8];

        // Mirror the X coordinate for natural interaction
        const x = 1 - indexTip.x;
        const y = indexTip.y;

        // Detect gestures from landmarks
        let { gesture, pinchDistance, fingers } = detectGesture(landmarks);

        // Wave detection: track palm x-position over time
        const now = performance.now();
        const palmX = landmarks[0].x;
        waveTrackRef.current.positions.push(palmX);
        waveTrackRef.current.timestamps.push(now);

        // Keep only last 500ms of data
        while (waveTrackRef.current.timestamps.length > 0 && now - waveTrackRef.current.timestamps[0] > 500) {
          waveTrackRef.current.positions.shift();
          waveTrackRef.current.timestamps.shift();
        }

        if (waveTrackRef.current.positions.length > 5 && gesture === 'open_palm') {
          const positions = waveTrackRef.current.positions;
          const range = Math.max(...positions) - Math.min(...positions);
          if (range > 0.15) {
            gesture = 'wave';
          }
        }

        setCurrentGesture(gesture);

        onHandUpdate({
          x, y,
          active: true,
          gesture,
          pinchDistance,
          fingers
        });

        if (showPreview && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            // Draw landmarks
            for (const lm of landmarks) {
              ctx.fillStyle = "#00FF00";
              ctx.beginPath();
              ctx.arc(lm.x * canvasRef.current.width, lm.y * canvasRef.current.height, 3, 0, Math.PI * 2);
              ctx.fill();
            }
            // Highlight gesture
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "12px monospace";
            ctx.fillText(gesture.toUpperCase(), 8, 16);
          }
        }
      } else {
        onHandUpdate(null);
        setCurrentGesture('none');
      }
    }

    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  const gestureIcons: Record<HandGesture, string> = {
    none: '',
    pinch: '\u{1F90F}',
    fist: '\u{270A}',
    open_palm: '\u{1F91A}',
    point: '\u{261D}',
    wave: '\u{1F44B}',
  };

  return (
    <div className="fixed top-4 right-4 z-50 pointer-events-none">
        {enabled && (
          <div className="relative">
            {/* Camera Preview Container */}
            <div className={`
              w-48 h-36 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden transition-all
              ${showPreview ? 'opacity-100' : 'opacity-0 w-0 h-0'}
            `}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              <canvas
                ref={canvasRef}
                width={192}
                height={144}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            </div>

            {/* Status Indicator */}
            <div className="absolute -bottom-2 -left-2 flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-full pointer-events-auto">
              {isLoading ? (
                <Loader2 size={12} className="text-white animate-spin" />
              ) : error ? (
                <CameraOff size={12} className="text-red-500" />
              ) : (
                <Camera size={12} className="text-green-500" />
              )}
              <span className="text-[10px] font-mono text-white/60 uppercase tracking-widest">
                {isLoading ? 'Calibrating...' : error ? 'Error' : currentGesture !== 'none' ? `${gestureIcons[currentGesture]} ${currentGesture}` : 'Gesture Active'}
              </span>
            </div>
          </div>
        )}
    </div>
  );
};
