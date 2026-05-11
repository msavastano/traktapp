import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.trakt.tv",
        pathname: "/images/**",
      },
    ],
  },
};

export default nextConfig;
