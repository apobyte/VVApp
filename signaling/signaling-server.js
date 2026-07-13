/**
 * VVApp standalone WebSocket signaling server (backend).
 *
 * Port: 8002
 * Frontend: 8001
 *
 * Usage:
 *   PORT=8002 node signaling-server.js
 *   vvapp-backend-win.exe
 */
const http = require("http");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");

const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8002);

/** @type {Map<string, { pushers: Map<string, import('ws').WebSocket>, viewers: Map<string, import('ws').WebSocket> }>} */
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { pushers: new Map(), viewers: new Map() });
  }
  return rooms.get(roomId);
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.pushers.size === 0 && room.viewers.size === 0) {
    rooms.delete(roomId);
  }
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToViewers(room, payload, exceptId = null) {
  for (const [id, viewer] of room.viewers) {
    if (id !== exceptId) send(viewer, payload);
  }
}

function broadcastToPushers(room, payload, exceptId = null) {
  for (const [id, pusher] of room.pushers) {
    if (id !== exceptId) send(pusher, payload);
  }
}

function leaveRoom(ws) {
  const { roomId, peerId, role } = ws.meta || {};
  if (!roomId || !peerId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  if (role === "push") {
    room.pushers.delete(peerId);
    broadcastToViewers(room, { type: "pusher-left", peerId });
  } else if (role === "view") {
    room.viewers.delete(peerId);
    broadcastToPushers(room, { type: "viewer-left", peerId });
  }

  ws.meta = { roomId: null, peerId: null, role: null };
  cleanupRoom(roomId);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "vvapp-signaling",
        rooms: rooms.size,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.meta = { roomId: null, peerId: null, role: null };

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    const { type } = message;

    if (type === "join") {
      const roomId = String(message.roomId || "").trim();
      const role = message.role === "view" ? "view" : "push";
      const peerId = String(message.peerId || randomUUID());

      if (!roomId) {
        send(ws, { type: "error", message: "Room id is required." });
        return;
      }

      if (ws.meta.roomId) {
        leaveRoom(ws);
      }

      const room = getRoom(roomId);
      ws.meta = { roomId, peerId, role };

      if (role === "push") {
        room.pushers.set(peerId, ws);
        send(ws, {
          type: "joined",
          roomId,
          peerId,
          role,
          viewers: [...room.viewers.keys()],
        });
        broadcastToViewers(room, {
          type: "pusher-joined",
          peerId,
        });
      } else {
        room.viewers.set(peerId, ws);
        send(ws, {
          type: "joined",
          roomId,
          peerId,
          role,
          pushers: [...room.pushers.keys()],
        });
        broadcastToPushers(room, {
          type: "viewer-joined",
          peerId,
        });
      }
      return;
    }

    if (!ws.meta.roomId) return;

    const room = rooms.get(ws.meta.roomId);
    if (!room) return;

    if (type === "signal") {
      const { targetId, data } = message;
      if (!targetId || !data) return;

      const target =
        room.pushers.get(targetId) || room.viewers.get(targetId) || null;
      if (target) {
        send(target, {
          type: "signal",
          fromId: ws.meta.peerId,
          data,
        });
      }
      return;
    }

    if (type === "request-offer") {
      const { targetId } = message;
      const pusher = room.pushers.get(targetId);
      if (pusher) {
        send(pusher, {
          type: "viewer-joined",
          peerId: ws.meta.peerId,
        });
      }
      return;
    }

    if (type === "leave") {
      leaveRoom(ws);
    }
  });

  ws.on("close", () => leaveRoom(ws));
});

server.listen(port, hostname, () => {
  console.log(`VVApp backend (signaling) ready`);
  console.log(`  HTTP  http://${hostname}:${port}/`);
  console.log(`  WS    ws://${hostname}:${port}/ws`);
});
