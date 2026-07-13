/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict Mode double-mounts effects in dev and breaks WebSocket/WebRTC joins.
  reactStrictMode: false,
};

export default nextConfig;
