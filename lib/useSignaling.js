"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getWsUrl } from "./webrtc";

/**
 * WebSocket signaling hook for push/view rooms.
 */
export function useSignaling({ roomId, role, peerId, enabled = true, onMessage }) {
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const send = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    if (!enabled || !roomId || !role || !peerId) return undefined;

    let closed = false;
    let reconnectTimer = null;
    let ws;

    const connect = () => {
      setStatus("connecting");
      setError("");
      ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        setStatus("connected");
        ws.send(JSON.stringify({ type: "join", roomId, role, peerId }));
      };

      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        onMessageRef.current?.(message);
      };

      ws.onerror = () => {
        setError("Signaling connection error.");
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closed) {
          setStatus("closed");
          return;
        }
        setStatus("reconnecting");
        reconnectTimer = setTimeout(connect, 1500);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "leave" }));
        ws.close();
      } else if (ws) {
        ws.close();
      }
      wsRef.current = null;
      setStatus("closed");
    };
  }, [enabled, roomId, role, peerId]);

  const sendSignal = useCallback(
    (targetId, data) => {
      send({ type: "signal", targetId, data });
    },
    [send]
  );

  return { status, error, send, sendSignal };
}
