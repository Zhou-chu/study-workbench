import type { NextConfig } from "next";

// Next.js dev server blocks cross-origin requests (including the HMR
// websocket) from any host not in this list, to guard against DNS
// rebinding. Set NEXT_ALLOWED_DEV_ORIGINS (comma-separated hostnames, no
// protocol/port) to access the dev server from a LAN IP or custom hostname.
const allowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS
  ? process.env.NEXT_ALLOWED_DEV_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;

const nextConfig: NextConfig = {
  // Enable standalone output for optimized Docker deployment
  output: "standalone",

  ...(allowedDevOrigins && allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),

  // All /api traffic is handled by Node App Routes. A build-time external
  // rewrite must never bypass device-mode runtime policy; legacy compatibility
  // is explicit inside the same streaming handler, without a request clone cap.

  // Redirect the legacy credentials route to the canonical "Models" route so
  // existing bookmarks and links keep working.
  async redirects() {
    return [
      {
        source: '/settings/api-keys',
        destination: '/settings/models',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
