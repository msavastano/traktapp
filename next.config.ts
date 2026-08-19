import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Simkl serves all artwork through the wsrv.nl image proxy.
      {
        protocol: "https",
        hostname: "wsrv.nl",
      },
      // TMDB artwork, used by the "New on Streaming" tab. That feed is TMDB
      // end-to-end (Simkl has no streaming-provider data), so its posters
      // come from TMDB's CDN rather than Simkl's proxy.
      {
        protocol: "https",
        hostname: "image.tmdb.org",
      },
    ],
  },
};

export default nextConfig;
