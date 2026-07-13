# VVApp

Simple VDO.Ninja-style **push** and **view** over WebRTC.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Click **Push camera** and allow camera/mic.
2. Copy the **View link** (or open **View stream** with the same room id).
3. Optional: paste the view URL into OBS as a Browser Source.

## Stack

- Next.js (React, JavaScript)
- WebRTC (`getUserMedia` + `RTCPeerConnection`)
- WebSocket signaling on the same Node server (`server.js`)
