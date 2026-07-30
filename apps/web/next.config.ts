import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (ADR-0001) — Next compiles them.
  transpilePackages: ["@vaanidesk/shared", "@vaanidesk/core", "@vaanidesk/db"],
  // postgres-js and friends stay server-side native.
  serverExternalPackages: ["postgres"],
  // Workspace source uses NodeNext-style ".js" specifiers for ".ts" files
  // (required by tsx/Node in the services). Teach webpack the TS resolution.
  webpack: (config: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default config;
