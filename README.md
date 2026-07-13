# VVApp

Simple VDO.Ninja-style **push** and **view** over WebRTC.

## Run website locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Signaling is hardcoded to the VPS:

`ws://31.220.80.36:8000/ws`

## VPS signaling server

On the VPS, run the signaling binary (or Node script) on port **8000**:

```bash
# binary
chmod +x vvapp-signaling-linux
PORT=8000 ./vvapp-signaling-linux

# or Node
cd signaling
npm install
PORT=8000 node signaling-server.js
```

Open firewall for TCP **8000**.

### Important (HTTPS website)

If the website is served over **HTTPS** (e.g. Vercel), browsers block insecure `ws://`.
You must put TLS in front of the VPS and switch the URL in `lib/webrtc.js` to:

`wss://31.220.80.36:8000/ws` (or your domain with SSL)

## Build signaling exe

```bash
cd signaling
npm install
npm run build:exe
```

Outputs in `dist/`:

- `vvapp-signaling-win.exe`
- `vvapp-signaling-linux`

## Stack

- Next.js website
- Standalone WebSocket signaling on VPS (`31.220.80.36:8000`)
- WebRTC in the browser
