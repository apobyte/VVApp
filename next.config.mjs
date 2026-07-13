/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict Mode double-mounts effects in dev and breaks WebSocket/WebRTC joins.
  reactStrictMode: false,
  // Static HTML export so we can ship a simple Windows frontend .exe
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
