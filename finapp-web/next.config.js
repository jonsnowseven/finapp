/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfjs-dist resolves its worker script via a relative path at runtime
    // ("./pdf.worker.mjs") — webpack bundling that into a vendor chunk breaks
    // the resolution ("Cannot find module .../vendor-chunks/pdf.worker.mjs").
    // Exclude from bundling so Node resolves it against the real node_modules layout.
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },

  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

module.exports = nextConfig;
