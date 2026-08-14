import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Simkl serves all artwork through the wsrv.nl image proxy.
      {
        protocol: "https",
        hostname: "wsrv.nl",
      },
    ],
  },
};

export default nextConfig;
