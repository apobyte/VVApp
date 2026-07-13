export const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

/** High-quality capture defaults (fall back gracefully if unsupported). */
export const VIDEO_CONSTRAINTS_HQ = {
  width: { ideal: 1920, min: 1280 },
  height: { ideal: 1080, min: 720 },
  frameRate: { ideal: 30, min: 24 },
  aspectRatio: { ideal: 16 / 9 },
};

export const VIDEO_CONSTRAINTS_FALLBACK = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

export const AUDIO_CONSTRAINTS_HQ = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: { ideal: 2 },
  sampleRate: { ideal: 48000 },
};

/** Raise outgoing video bitrate so 720p/1080p stays sharp. */
export async function applyHighQualityEncoding(sender) {
  if (!sender || typeof sender.getParameters !== "function") return;

  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    params.encodings = params.encodings.map((encoding, index) => ({
      ...encoding,
      maxBitrate: index === 0 ? 4_000_000 : encoding.maxBitrate || 1_000_000,
      maxFramerate: 30,
      scaleResolutionDownBy: index === 0 ? 1 : encoding.scaleResolutionDownBy,
      priority: index === 0 ? "high" : encoding.priority || "low",
      networkPriority: index === 0 ? "high" : encoding.networkPriority || "low",
    }));

    await sender.setParameters(params);
  } catch (err) {
    console.warn("Could not set video encoding params", err);
  }
}

export function preferVp9OrH264(pc) {
  try {
    if (!pc?.getTransceivers || !window.RTCRtpSender?.getCapabilities) return;

    const caps = RTCRtpSender.getCapabilities("video");
    if (!caps?.codecs?.length) return;

    const preferred = [];
    const rest = [];
    for (const codec of caps.codecs) {
      const mime = codec.mimeType.toLowerCase();
      if (mime === "video/vp9" || mime === "video/h264") preferred.push(codec);
      else rest.push(codec);
    }

    const ordered = [...preferred, ...rest];
    for (const transceiver of pc.getTransceivers()) {
      const kind =
        transceiver.sender?.track?.kind || transceiver.receiver?.track?.kind;
      if (kind === "video" && typeof transceiver.setCodecPreferences === "function") {
        transceiver.setCodecPreferences(ordered);
      }
    }
  } catch (err) {
    console.warn("Codec preference failed", err);
  }
}

export function createPeerId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `peer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createRoomId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

export function getWsUrl() {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function toSignalSdp(description) {
  if (!description) return null;
  return { type: description.type, sdp: description.sdp };
}

export function toSignalCandidate(candidate) {
  if (!candidate) return null;
  return candidate.toJSON ? candidate.toJSON() : candidate;
}

export async function setRemoteDescriptionSafe(pc, description, pendingCandidates) {
  await pc.setRemoteDescription(description);
  if (!pendingCandidates?.length) return;
  const queued = pendingCandidates.splice(0, pendingCandidates.length);
  for (const candidate of queued) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn("Dropped ICE candidate", err);
    }
  }
}

export async function addIceCandidateSafe(pc, candidate, pendingCandidates) {
  if (!pc.remoteDescription) {
    pendingCandidates.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (err) {
    console.warn("addIceCandidate failed", err);
  }
}
