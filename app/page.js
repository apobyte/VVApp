"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoomId } from "@/lib/webrtc";

export default function HomePage() {
  const router = useRouter();
  const suggested = useMemo(() => createRoomId(), []);
  const [roomId, setRoomId] = useState(suggested);

  function go(role) {
    const id = roomId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!id) return;
    router.push(`/${role}/${id}`);
  }

  return (
    <main className="home">
      <section className="home-card">
        <h1 className="brand">VVApp</h1>
        <p className="lead">
          Push your camera and mic from one device, then open the view link
          anywhere — including OBS Browser Source.
        </p>

        <div className="home-actions">
          <div className="room-field">
            <label htmlFor="room">Room id</label>
            <input
              id="room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="my-stream"
              autoComplete="off"
            />
          </div>

          <div className="btn-row">
            <button className="btn primary" type="button" onClick={() => go("push")}>
              Push camera
            </button>
            <button className="btn" type="button" onClick={() => go("view")}>
              View stream
            </button>
          </div>
        </div>

        <p className="hint">
          Same room id on both sides. Start push first, then open view. Works
          best on the same network; public STUN is included for simple remote use.
        </p>
      </section>
    </main>
  );
}
