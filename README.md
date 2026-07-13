# VVApp

Push / view WebRTC app. On VPS run **both** Windows exes:

| Exe | Role | Port |
|-----|------|------|
| `vvapp-frontend-win.exe` | Website | **8001** |
| `vvapp-backend-win.exe` | WebSocket signaling | **8002** |

## Build the Windows exes (on your PC)

```bash
npm install
npm run build:exes
```

Output in `dist/`:

- `vvapp-frontend-win.exe`
- `vvapp-backend-win.exe`

## Run on Windows VPS

1. Copy both exe files to the VPS (same folder is fine).
2. Open firewall TCP **8001** and **8002**.
3. Start backend first, then frontend:

```bat
vvapp-backend-win.exe
vvapp-frontend-win.exe
```

4. Open `http://YOUR_VPS_IP:8001`

The website connects to `ws://YOUR_VPS_IP:8002/ws` automatically.

## Local development

```bash
# terminal 1 — backend
npm run dev:backend

# terminal 2 — frontend
npm run dev
```

Then open http://localhost:8001

## Routes

- Home: `/`
- Push: `/push?room=myroom`
- View: `/view?room=myroom`
