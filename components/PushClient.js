"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ICE_SERVERS,
  AUDIO_CONSTRAINTS_HQ,
  VIDEO_CONSTRAINTS_FALLBACK,
  VIDEO_CONSTRAINTS_HQ,
  addIceCandidateSafe,
  applyHighQualityEncoding,
  createPeerId,
  preferVp9OrH264,
  setRemoteDescriptionSafe,
  toSignalCandidate,
  toSignalSdp,
} from "@/lib/webrtc";
import { useSignaling } from "@/lib/useSignaling";

const NONE = "none";
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const PAN_STEP = 0.12;

function deviceLabel(device, index, kind) {
  if (device.label) return device.label;
  return `${kind} ${index + 1}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function PushClient({ roomId }) {
  const sourceVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const streamRef = useRef(null);
  const canvasStreamRef = useRef(null);
  const canvasTrackRef = useRef(null);
  const rafRef = useRef(0);
  const peersRef = useRef(new Map());
  const peerIdRef = useRef(createPeerId());
  const sendSignalRef = useRef(null);
  const offerTimersRef = useRef(new Map());
  const videoDeviceRef = useRef(NONE);
  const audioDeviceRef = useRef(NONE);
  const startingMediaRef = useRef(false);
  const zoomRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const camEnabledRef = useRef(true);

  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasVideo, setHasVideo] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [localError, setLocalError] = useState("");
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [videoDeviceId, setVideoDeviceId] = useState(NONE);
  const [audioDeviceId, setAudioDeviceId] = useState(NONE);
  const [devicesReady, setDevicesReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  videoDeviceRef.current = videoDeviceId;
  audioDeviceRef.current = audioDeviceId;
  zoomRef.current = zoom;
  panXRef.current = panX;
  panYRef.current = panY;
  camEnabledRef.current = camOn;

  const refreshOutboundTracks = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0] || null;
    const audioTrack = stream.getAudioTracks()[0] || null;

    for (const entry of peersRef.current.values()) {
      if (entry.videoSender) {
        await entry.videoSender.replaceTrack(videoTrack);
        if (videoTrack) await applyHighQualityEncoding(entry.videoSender);
      }
      if (entry.audioSender) {
        await entry.audioSender.replaceTrack(audioTrack);
      }
    }
  }, []);

  const rebuildPublishStream = useCallback(async () => {
    const camera = cameraStreamRef.current;
    const audioTracks = camera?.getAudioTracks() || [];
    const canvasTrack = canvasTrackRef.current;
    const next = new MediaStream();

    if (canvasTrack && camera?.getVideoTracks().length) {
      next.addTrack(canvasTrack);
    }
    audioTracks.forEach((track) => next.addTrack(track));

    streamRef.current = next;
    setHasVideo(Boolean(canvasTrack && camera?.getVideoTracks().length));
    setHasAudio(audioTracks.length > 0);
    setMicOn(audioTracks[0]?.enabled ?? false);
    setPreviewReady(next.getTracks().length > 0);

    if (live) await refreshOutboundTracks();
  }, [live, refreshOutboundTracks]);

  const ensureCanvasCapture = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    if (!canvasTrackRef.current || canvasTrackRef.current.readyState === "ended") {
      // Prefer manual frames (0 + requestFrame). Fall back to timed capture.
      let canvasStream;
      try {
        canvasStream = canvas.captureStream(0);
      } catch {
        canvasStream = canvas.captureStream(30);
      }
      canvasStreamRef.current = canvasStream;
      canvasTrackRef.current = canvasStream.getVideoTracks()[0] || null;
      if (canvasTrackRef.current) {
        canvasTrackRef.current.contentHint = "motion";
        canvasTrackRef.current.enabled = true;
      }
    }
    return canvasTrackRef.current;
  }, []);

  const drawFrame = useCallback(() => {
    const video = sourceVideoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      rafRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    // Keep the source element decoding frames.
    if (video.paused) {
      video.play().catch(() => {});
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw > 0 && vh > 0 && camEnabledRef.current) {
      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width = vw;
        canvas.height = vh;
        // New size → new capture track
        try {
          canvasTrackRef.current?.stop();
        } catch {
          // ignore
        }
        canvasTrackRef.current = null;
        ensureCanvasCapture();
        rebuildPublishStream();
      }

      ensureCanvasCapture();

      const z = clamp(zoomRef.current, ZOOM_MIN, ZOOM_MAX);
      const cropW = vw / z;
      const cropH = vh / z;
      const maxOffsetX = (vw - cropW) / 2;
      const maxOffsetY = (vh - cropH) / 2;
      const px = clamp(panXRef.current, -1, 1);
      const py = clamp(panYRef.current, -1, 1);
      const sx = vw / 2 - cropW / 2 + px * maxOffsetX;
      const sy = vh / 2 - cropH / 2 + py * maxOffsetY;

      ctx.fillStyle = "#070b09";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(
        video,
        sx,
        sy,
        cropW,
        cropH,
        0,
        0,
        canvas.width,
        canvas.height
      );
      ctx.restore();

      // Push a new frame into the captured track for WebRTC.
      const track = canvasTrackRef.current;
      if (track && typeof track.requestFrame === "function") {
        try {
          track.requestFrame();
        } catch {
          // ignore
        }
      }
    } else if (canvas.width > 0 && canvas.height > 0) {
      ctx.fillStyle = "#070b09";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const track = canvasTrackRef.current;
      if (track && typeof track.requestFrame === "function") {
        try {
          track.requestFrame();
        } catch {
          // ignore
        }
      }
    }

    rafRef.current = requestAnimationFrame(drawFrame);
  }, [ensureCanvasCapture, rebuildPublishStream]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [drawFrame]);

  const attachCamera = useCallback(
    async (cameraStream) => {
      cameraStreamRef.current = cameraStream;
      const source = sourceVideoRef.current;
      const hasVid = cameraStream.getVideoTracks().length > 0;

      if (source) {
        source.srcObject = hasVid ? cameraStream : null;
        if (hasVid) {
          source.muted = true;
          try {
            await source.play();
          } catch (err) {
            console.warn("Source video play blocked", err);
          }
        }
      }

      ensureCanvasCapture();
      await rebuildPublishStream();

      const videoTrack = cameraStream.getVideoTracks()[0];
      const audioTrack = cameraStream.getAudioTracks()[0];
      setCamOn(videoTrack ? videoTrack.enabled : false);
      setMicOn(audioTrack ? audioTrack.enabled : false);
    },
    [ensureCanvasCapture, rebuildPublishStream]
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return { videos: [], audios: [] };

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter(
        (d) => d.kind === "videoinput" && d.deviceId
      );
      const audios = devices.filter(
        (d) => d.kind === "audioinput" && d.deviceId
      );
      setVideoDevices(videos);
      setAudioDevices(audios);
      setDevicesReady(true);
      return { videos, audios };
    } catch (err) {
      console.error("enumerateDevices failed", err);
      return { videos: [], audios: [] };
    }
  }, []);

  const acquireStream = useCallback(async (nextVideoId, nextAudioId) => {
    if (nextVideoId === NONE && nextAudioId === NONE) {
      throw new Error("Select at least a camera or a microphone.");
    }

    const wantVideo = nextVideoId !== NONE;
    const wantAudio = nextAudioId !== NONE;

    const attempts = [
      {
        video: wantVideo
          ? {
              ...VIDEO_CONSTRAINTS_HQ,
              deviceId: nextVideoId ? { ideal: nextVideoId } : undefined,
            }
          : false,
        audio: wantAudio
          ? {
              ...AUDIO_CONSTRAINTS_HQ,
              deviceId: nextAudioId ? { ideal: nextAudioId } : undefined,
            }
          : false,
      },
      {
        video: wantVideo
          ? {
              ...VIDEO_CONSTRAINTS_FALLBACK,
              deviceId: nextVideoId ? { ideal: nextVideoId } : undefined,
            }
          : false,
        audio: wantAudio
          ? {
              ...AUDIO_CONSTRAINTS_HQ,
              deviceId: nextAudioId ? { ideal: nextAudioId } : undefined,
            }
          : false,
      },
      {
        video: wantVideo ? VIDEO_CONSTRAINTS_FALLBACK : false,
        audio: wantAudio ? AUDIO_CONSTRAINTS_HQ : false,
      },
      { video: wantVideo, audio: wantAudio },
    ];

    let lastError;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack?.applyConstraints) {
          try {
            await videoTrack.applyConstraints(VIDEO_CONSTRAINTS_HQ);
          } catch {
            try {
              await videoTrack.applyConstraints(VIDEO_CONSTRAINTS_FALLBACK);
            } catch {
              // keep default
            }
          }
        }
        if (videoTrack?.contentHint !== undefined) {
          videoTrack.contentHint = "detail";
        }
        return stream;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Could not access camera/microphone.");
  }, []);

  const startMedia = useCallback(
    async (nextVideoId, nextAudioId) => {
      if (startingMediaRef.current) return;
      startingMediaRef.current = true;
      setLocalError("");
      try {
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;

        const stream = await acquireStream(nextVideoId, nextAudioId);
        await attachCamera(stream);

        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        const openedVideoId = videoTrack?.getSettings?.().deviceId;
        const openedAudioId = audioTrack?.getSettings?.().deviceId;
        if (openedVideoId) setVideoDeviceId(openedVideoId);
        else if (!videoTrack) setVideoDeviceId(NONE);
        if (openedAudioId) setAudioDeviceId(openedAudioId);
        else if (!audioTrack) setAudioDeviceId(NONE);

        await refreshDevices();
      } catch (err) {
        console.error(err);
        setLocalError(
          err?.message ||
            "Could not access camera/microphone. Check browser permissions."
        );
        throw err;
      } finally {
        startingMediaRef.current = false;
      }
    },
    [acquireStream, attachCamera, refreshDevices]
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: VIDEO_CONSTRAINTS_HQ,
          audio: AUDIO_CONSTRAINTS_HQ,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const vTrack = stream.getVideoTracks()[0];
        if (vTrack?.contentHint !== undefined) vTrack.contentHint = "detail";
        await attachCamera(stream);

        const videoId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
        const audioId = stream.getAudioTracks()[0]?.getSettings?.().deviceId;
        if (videoId) setVideoDeviceId(videoId);
        if (audioId) setAudioDeviceId(audioId);
      } catch (err) {
        console.warn("Initial AV open failed, trying video only", err);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          await attachCamera(stream);
          const videoId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
          if (videoId) setVideoDeviceId(videoId);
          setAudioDeviceId(NONE);
        } catch (err2) {
          console.error(err2);
          if (!cancelled) {
            setLocalError(
              "Camera permission denied or unavailable. Allow camera access and reload."
            );
          }
        }
      }

      if (!cancelled) await refreshDevices();
    }

    bootstrap();
    const onDeviceChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        onDeviceChange
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      peersRef.current.forEach((entry) => entry.pc?.close());
      peersRef.current.clear();
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      canvasTrackRef.current?.stop();
      cameraStreamRef.current = null;
      canvasTrackRef.current = null;
      streamRef.current = null;
    };
  }, []);

  const cleanupPeer = useCallback((viewerId) => {
    const entry = peersRef.current.get(viewerId);
    if (entry?.pc) {
      entry.pc.onicecandidate = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
      peersRef.current.delete(viewerId);
    }
    setViewerCount(peersRef.current.size);
  }, []);

  const createOfferForViewer = useCallback(
    async (viewerId) => {
      if (!streamRef.current) return;
      if (peersRef.current.has(viewerId)) cleanupPeer(viewerId);

      const stream = streamRef.current;
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const pendingCandidates = [];

      const videoTrack = stream.getVideoTracks()[0] || null;
      const audioTrack = stream.getAudioTracks()[0] || null;

      const videoSender = videoTrack
        ? pc.addTrack(videoTrack, stream)
        : pc.addTransceiver("video", { direction: "sendonly" }).sender;
      const audioSender = audioTrack
        ? pc.addTrack(audioTrack, stream)
        : pc.addTransceiver("audio", { direction: "sendonly" }).sender;

      preferVp9OrH264(pc);
      if (videoTrack) await applyHighQualityEncoding(videoSender);

      peersRef.current.set(viewerId, {
        pc,
        pendingCandidates,
        videoSender,
        audioSender,
      });
      setViewerCount(peersRef.current.size);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignalRef.current?.(viewerId, {
            kind: "candidate",
            candidate: toSignalCandidate(event.candidate),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          cleanupPeer(viewerId);
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignalRef.current?.(viewerId, {
          kind: "offer",
          sdp: toSignalSdp(pc.localDescription),
        });
      } catch (err) {
        console.error("createOffer failed", err);
        cleanupPeer(viewerId);
      }
    },
    [cleanupPeer]
  );

  const scheduleOfferForViewer = useCallback(
    (viewerId) => {
      const existing = offerTimersRef.current.get(viewerId);
      if (existing) clearTimeout(existing);
      offerTimersRef.current.set(
        viewerId,
        setTimeout(() => {
          offerTimersRef.current.delete(viewerId);
          createOfferForViewer(viewerId);
        }, 250)
      );
    },
    [createOfferForViewer]
  );

  const handleSignal = useCallback(async (fromId, data) => {
    const entry = peersRef.current.get(fromId);
    if (!entry?.pc || !data) return;
    const { pc, pendingCandidates } = entry;

    try {
      if (data.kind === "answer" && data.sdp) {
        await setRemoteDescriptionSafe(pc, data.sdp, pendingCandidates);
      } else if (data.kind === "candidate" && data.candidate) {
        await addIceCandidateSafe(pc, data.candidate, pendingCandidates);
      }
    } catch (err) {
      console.error("Push signal error", err);
    }
  }, []);

  const onMessage = useCallback(
    (message) => {
      if (message.type === "joined") {
        (message.viewers || []).forEach((viewerId) => {
          scheduleOfferForViewer(viewerId);
        });
      } else if (message.type === "viewer-joined") {
        scheduleOfferForViewer(message.peerId);
      } else if (message.type === "viewer-left") {
        const timer = offerTimersRef.current.get(message.peerId);
        if (timer) {
          clearTimeout(timer);
          offerTimersRef.current.delete(message.peerId);
        }
        cleanupPeer(message.peerId);
      } else if (message.type === "signal") {
        handleSignal(message.fromId, message.data);
      } else if (message.type === "error") {
        setLocalError(message.message || "Signaling error");
      }
    },
    [cleanupPeer, handleSignal, scheduleOfferForViewer]
  );

  const { status, error, sendSignal } = useSignaling({
    roomId,
    role: "push",
    peerId: peerIdRef.current,
    enabled: live,
    onMessage,
  });

  useEffect(() => {
    sendSignalRef.current = sendSignal;
  }, [sendSignal]);

  async function startPush() {
    setStarting(true);
    setLocalError("");
    try {
      if (!cameraStreamRef.current || cameraStreamRef.current.getTracks().length === 0) {
        await startMedia(videoDeviceId, audioDeviceId);
      } else {
        ensureCanvasCapture();
        await rebuildPublishStream();
      }
      setLive(true);
    } catch (err) {
      console.error(err);
      setLocalError(
        err?.message ||
          "Could not access camera/microphone. Check browser permissions."
      );
    } finally {
      setStarting(false);
    }
  }

  function stopPush() {
    peersRef.current.forEach((entry) => entry.pc?.close());
    peersRef.current.clear();
    setViewerCount(0);
    setLive(false);
  }

  async function changeVideoDevice(nextId) {
    const previous = videoDeviceRef.current;
    setVideoDeviceId(nextId);
    setLocalError("");
    try {
      if (nextId === NONE && audioDeviceRef.current === NONE) {
        setLocalError("Select at least a camera or a microphone.");
        setVideoDeviceId(previous);
        return;
      }
      setStarting(true);
      await startMedia(nextId, audioDeviceRef.current);
    } catch {
      setVideoDeviceId(previous);
      setLocalError("Could not switch camera device.");
    } finally {
      setStarting(false);
    }
  }

  async function changeAudioDevice(nextId) {
    const previous = audioDeviceRef.current;
    setAudioDeviceId(nextId);
    setLocalError("");
    try {
      if (nextId === NONE && videoDeviceRef.current === NONE) {
        setLocalError("Select at least a camera or a microphone.");
        setAudioDeviceId(previous);
        return;
      }
      setStarting(true);
      await startMedia(videoDeviceRef.current, nextId);
    } catch {
      setAudioDeviceId(previous);
      setLocalError("Could not switch microphone device.");
    } finally {
      setStarting(false);
    }
  }

  function toggleMic() {
    const track = cameraStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  function toggleCam() {
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
    camEnabledRef.current = track.enabled;
  }

  function nudgeZoom(delta) {
    setZoom((z) => clamp(Number((z + delta).toFixed(2)), ZOOM_MIN, ZOOM_MAX));
  }

  function nudgePan(dx, dy) {
    if (zoom <= 1.01) return;
    setPanX((x) => clamp(Number((x + dx).toFixed(3)), -1, 1));
    setPanY((y) => clamp(Number((y + dy).toFixed(3)), -1, 1));
  }

  function resetFraming() {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }

  // When zoom returns to 1, clear pan.
  useEffect(() => {
    if (zoom <= 1.01 && (panX !== 0 || panY !== 0)) {
      setPanX(0);
      setPanY(0);
    }
  }, [zoom, panX, panY]);

  const viewUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/view?room=${encodeURIComponent(roomId)}`
      : `/view?room=${encodeURIComponent(roomId)}`;

  async function copyViewLink() {
    try {
      await navigator.clipboard.writeText(viewUrl);
    } catch {
      // ignore
    }
  }

  const canStart = !starting && (hasVideo || hasAudio || previewReady);
  const canPan = zoom > 1.01 && hasVideo;

  return (
    <div className="stage">
      <header className="stage-bar">
        <div>
          <p className="eyebrow">Push</p>
          <h1>Room {roomId}</h1>
        </div>
        <div className="status-pills">
          <span className={`pill ${live ? "pill-live" : ""}`}>
            {live ? "Live" : previewReady ? "Preview" : "Idle"}
          </span>
          <span className="pill">Viewers {viewerCount}</span>
          <span className="pill">{status}</span>
        </div>
      </header>

      <div className="video-shell">
        <video
          ref={sourceVideoRef}
          autoPlay
          muted
          playsInline
          className="source-video"
        />
        <canvas ref={canvasRef} className="preview preview-canvas" />
        {!hasVideo && (
          <div className="video-empty">
            {localError
              ? "Camera unavailable"
              : videoDeviceId === NONE
                ? "No camera selected"
                : "Starting camera… allow permission if asked"}
          </div>
        )}
      </div>

      <div className="framing-panel">
        <div className="framing-zoom">
          <span>Zoom {zoom.toFixed(2)}x</span>
          <div className="framing-row">
            <button
              type="button"
              className="btn"
              onClick={() => nudgeZoom(-ZOOM_STEP)}
              disabled={!hasVideo || zoom <= ZOOM_MIN}
            >
              −
            </button>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              value={zoom}
              disabled={!hasVideo}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <button
              type="button"
              className="btn"
              onClick={() => nudgeZoom(ZOOM_STEP)}
              disabled={!hasVideo || zoom >= ZOOM_MAX}
            >
              +
            </button>
          </div>
        </div>

        <div className="framing-pan">
          <span>Move</span>
          <div className="pan-pad">
            <button
              type="button"
              className="btn pan-btn"
              disabled={!canPan}
              onClick={() => nudgePan(0, -PAN_STEP)}
              aria-label="Move up"
            >
              Up
            </button>
            <div className="pan-mid">
              <button
                type="button"
                className="btn pan-btn"
                disabled={!canPan}
                onClick={() => nudgePan(-PAN_STEP, 0)}
                aria-label="Move left"
              >
                Left
              </button>
              <button
                type="button"
                className="btn pan-btn"
                disabled={!hasVideo}
                onClick={resetFraming}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn pan-btn"
                disabled={!canPan}
                onClick={() => nudgePan(PAN_STEP, 0)}
                aria-label="Move right"
              >
                Right
              </button>
            </div>
            <button
              type="button"
              className="btn pan-btn"
              disabled={!canPan}
              onClick={() => nudgePan(0, PAN_STEP)}
              aria-label="Move down"
            >
              Down
            </button>
          </div>
        </div>
      </div>

      <div className="device-pickers">
        <label className="device-field">
          <span>Camera</span>
          <select
            value={videoDeviceId}
            onChange={(e) => changeVideoDevice(e.target.value)}
            disabled={starting}
          >
            <option value={NONE}>No camera</option>
            {videoDevices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceLabel(device, index, "Camera")}
              </option>
            ))}
          </select>
        </label>

        <label className="device-field">
          <span>Microphone</span>
          <select
            value={audioDeviceId}
            onChange={(e) => changeAudioDevice(e.target.value)}
            disabled={starting}
          >
            <option value={NONE}>No audio</option>
            {audioDevices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceLabel(device, index, "Microphone")}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!devicesReady && (
        <p className="hint-inline">
          Loading devices… allow permissions if prompted.
        </p>
      )}

      <div className="controls">
        {!live ? (
          <button
            className="btn primary"
            onClick={startPush}
            disabled={!canStart}
          >
            {starting ? "Starting…" : "Go live"}
          </button>
        ) : (
          <>
            <button className="btn" onClick={toggleMic} disabled={!hasAudio}>
              {micOn ? "Mute mic" : "Unmute mic"}
            </button>
            <button className="btn" onClick={toggleCam} disabled={!hasVideo && !cameraStreamRef.current?.getVideoTracks()?.[0]}>
              {camOn ? "Camera off" : "Camera on"}
            </button>
            <button className="btn danger" onClick={stopPush}>
              Stop
            </button>
          </>
        )}
      </div>

      <div className="link-box">
        <label>View link</label>
        <div className="link-row">
          <input readOnly value={viewUrl} />
          <button className="btn" onClick={copyViewLink}>
            Copy
          </button>
          <a
            className="btn primary"
            href={viewUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open view
          </a>
        </div>
      </div>

      {(localError || error) && (
        <p className="error">{localError || error}</p>
      )}
    </div>
  );
}
