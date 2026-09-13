/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfjs-dist resolves its worker script via a relative path at runtime
    // ("./pdf.worker.mjs") — webpack bundling that into a vendor chunk breaks
    // the resolution ("Cannot find module .../vendor-chunks/pdf.worker.mjs").
    // Exclude from bundling so Node resolves it against the real node_modules layout.
    serverComponentsExternalPackages: ['pdfjs-dist'],
    // Vercel's deploy bundler (file tracing) only ships files it can see via
    // static require()/import() calls — pdfjs-dist loads its worker via a
    // dynamically-computed path, so the tracer misses it and the deployed
    // function is missing the file ("Cannot find module /var/task/.../pdf.worker.mjs").
    // Force it to be included alongside every route that parses PDFs.
    outputFileTracingIncludes: {
      '/api/import/**/*': ['./node_modules/pdfjs-dist/legacy/build/**/*'],
    },
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
