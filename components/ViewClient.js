"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ICE_SERVERS,
  addIceCandidateSafe,
  createPeerId,
  setRemoteDescriptionSafe,
  toSignalCandidate,
  toSignalSdp,
} from "@/lib/webrtc";
import { useSignaling } from "@/lib/useSignaling";

export default function ViewClient({ roomId }) {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const pcRef = useRef(null);
  const peerIdRef = useRef(createPeerId());
  const sendSignalRef = useRef(null);
  const sendRef = useRef(null);
  const activePusherRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const remoteStreamRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const [muted, setMuted] = useState(true);
  const [localError, setLocalError] = useState("");
  const [connState, setConnState] = useState("new");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const playVideo = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.srcObject) return;

    try {
      // Stay muted for reliable continuous autoplay. User can unmute manually.
      video.muted = true;
      setMuted(true);
      video.playsInline = true;
      await video.play();
      setNeedsTap(false);
    } catch {
      setNeedsTap(true);
      setMuted(true);
      if (video) video.muted = true;
    }
  }, []);

  const attachTrack = useCallback(
    (track) => {
      if (!track) return;

      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      const stream = remoteStreamRef.current;

      stream
        .getTracks()
        .filter((t) => t.kind === track.kind && t.id !== track.id)
        .forEach((t) => {
          stream.removeTrack(t);
        });

      if (!stream.getTracks().some((t) => t.id === track.id)) {
        stream.addTrack(track);
      }

      const video = videoRef.current;
      if (video) {
        if (video.srcObject !== stream) {
          video.srcObject = stream;
        }
        playVideo();
      }

      setConnected(true);
      setWaiting(false);
    },
    [playVideo]
  );

  const cleanupPc = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    activePusherRef.current = null;
    pendingCandidatesRef.current = [];
    remoteStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setConnected(false);
    setNeedsTap(false);
    setConnState("new");
  }, []);

  const createPc = useCallback(
    (pusherId) => {
      cleanupPc();

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      activePusherRef.current = pusherId;
      pendingCandidatesRef.current = [];
      remoteStreamRef.current = new MediaStream();

      pc.ontrack = (event) => {
        if (event.streams?.[0]) {
          const stream = event.streams[0];
          remoteStreamRef.current = stream;
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            playVideo();
          }
          setConnected(true);
          setWaiting(false);
          return;
        }
        if (event.track) attachTrack(event.track);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignalRef.current?.(pusherId, {
            kind: "candidate",
            candidate: toSignalCandidate(event.candidate),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        setConnState(pc.connectionState);
        if (pc.connectionState === "connected") {
          setConnected(true);
          setWaiting(false);
          playVideo();
        }
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          setConnected(false);
          setWaiting(true);
        }
      };

      return pc;
    },
    [attachTrack, cleanupPc, playVideo]
  );

  const handleSignal = useCallback(
    async (fromId, data) => {
      if (!data) return;
      try {
        if (data.kind === "offer" && data.sdp) {
          const pc = createPc(fromId);
          await setRemoteDescriptionSafe(
            pc,
            data.sdp,
            pendingCandidatesRef.current
          );
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignalRef.current?.(fromId, {
            kind: "answer",
            sdp: toSignalSdp(pc.localDescription),
          });
          setWaiting(false);
          setLocalError("");
        } else if (data.kind === "candidate" && data.candidate) {
          const pc = pcRef.current;
          if (pc && activePusherRef.current === fromId) {
            await addIceCandidateSafe(
              pc,
              data.candidate,
              pendingCandidatesRef.current
            );
          }
        }
      } catch (err) {
        console.error("View signal error", err);
        setLocalError("Failed to negotiate media connection.");
      }
    },
    [createPc]
  );

  const requestOffer = useCallback((pusherId) => {
    sendRef.current?.({ type: "request-offer", targetId: pusherId });
  }, []);

  const onMessage = useCallback(
    (message) => {
      if (message.type === "joined") {
        if (!message.pushers?.length) {
          setWaiting(true);
          setConnected(false);
        } else {
          setWaiting(true);
          message.pushers.forEach((pusherId) => requestOffer(pusherId));
        }
      } else if (message.type === "pusher-joined") {
        setWaiting(true);
        requestOffer(message.peerId);
      } else if (message.type === "pusher-left") {
        if (activePusherRef.current === message.peerId) {
          cleanupPc();
          setWaiting(true);
        }
      } else if (message.type === "signal") {
        handleSignal(message.fromId, message.data);
      } else if (message.type === "error") {
        setLocalError(message.message || "Signaling error");
      }
    },
    [cleanupPc, handleSignal, requestOffer]
  );

  const { status, error, send, sendSignal } = useSignaling({
    roomId,
    role: "view",
    peerId: peerIdRef.current,
    enabled: true,
    onMessage,
  });

  useEffect(() => {
    sendSignalRef.current = sendSignal;
    sendRef.current = send;
  }, [send, sendSignal]);

  // If the browser pauses the element after the first frame, keep restarting play.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !connected) return undefined;

    const resume = () => {
      if (video.paused && video.srcObject) {
        playVideo();
      }
    };

    video.addEventListener("pause", resume);
    video.addEventListener("stalled", resume);
    video.addEventListener("suspend", resume);
    const timer = setInterval(resume, 1500);

    return () => {
      video.removeEventListener("pause", resume);
      video.removeEventListener("stalled", resume);
      video.removeEventListener("suspend", resume);
      clearInterval(timer);
    };
  }, [connected, playVideo]);

  useEffect(() => () => cleanupPc(), [cleanupPc]);

  useEffect(() => {
    function onFullscreenChange() {
      const active =
        document.fullscreenElement === stageRef.current ||
        document.webkitFullscreenElement === stageRef.current;
      setIsFullscreen(Boolean(active));
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        onFullscreenChange
      );
    };
  }, []);

  async function enterFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else setIsFullscreen(true);
    } catch (err) {
      console.error("Fullscreen failed", err);
      setIsFullscreen(true);
    }
  }

  async function handleTapToPlay() {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.muted = muted;
      await video.play();
      setNeedsTap(false);
    } catch (err) {
      console.error("Play failed", err);
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  return (
    <div
      ref={stageRef}
      className={`stage view-stage${isFullscreen ? " is-fullscreen" : ""}`}
    >
      {!isFullscreen && (
        <header className="stage-bar overlay-bar">
          <div>
            <p className="eyebrow">View</p>
            <h1>Room {roomId}</h1>
          </div>
          <div className="status-pills">
            <span className={`pill ${connected ? "pill-live" : ""}`}>
              {connected ? "Receiving" : waiting ? "Waiting" : "Idle"}
            </span>
            <span className="pill">{status}</span>
            <span className="pill">{connState}</span>
            {connected && (
              <button type="button" className="btn fullscreen-btn" onClick={toggleMute}>
                {muted ? "Unmute" : "Mute"}
              </button>
            )}
            <button
              type="button"
              className="btn fullscreen-btn"
              onClick={enterFullscreen}
            >
              Full screen
            </button>
          </div>
        </header>
      )}

      <div className="video-shell view-shell">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          controls={false}
          className="preview view-preview"
        />

        {!connected && !isFullscreen && (
          <div className="video-empty">
            {waiting
              ? "Waiting for the pusher to go live…"
              : "No stream connected"}
          </div>
        )}

        {connected && needsTap && (
          <button
            type="button"
            className="tap-to-play"
            onClick={handleTapToPlay}
          >
            Click to play video
          </button>
        )}
      </div>

      {!isFullscreen && (localError || error) && (
        <p className="error overlay-error">{localError || error}</p>
      )}
    </div>
  );
}
