const { createServer } = require("http");
const { randomUUID } = require("crypto");
const next = require("next");
const { WebSocketServer } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

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

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    handle(req, res, {
      pathname: parsedUrl.pathname,
      query: Object.fromEntries(parsedUrl.searchParams),
      path: parsedUrl.pathname + parsedUrl.search,
    });
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

        // Leave previous room if any
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
          // Tell pusher about existing viewers so it can offer to each
          // (viewers list is also on the "joined" payload)
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
          // Re-notify pusher so it creates/refreshes an offer for this viewer.
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

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
