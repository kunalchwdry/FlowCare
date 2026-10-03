/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Allow a production build to use a separate output directory so it cannot
   * clobber the .next tree a running `next dev` is serving from. Use
   * `npm run build:ci` (NEXT_DIST_DIR=.next-build) while a dev server is up.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // The sandboxed preview is served from https://{port}-{sandbox}.e2b.app
  allowedDevOrigins: ['*.e2b.app'],
  images: {
    // Google place photos are proxied through our own API route (/api/places/photo)
    // so that the API key never reaches the browser. No remote patterns needed.
    remotePatterns: [],
  },
  /**
   * Keep the dev file-watcher off runtime state.
   *
   * demoRepo persists every mutation to .data/demo-state.json. That file
   * lives inside the project root, so webpack's watcher picks up each write
   * and the dev server churns — under the HTTP test suite (which mutates on
   * almost every request) it eventually shuts itself down mid-run, producing
   * ECONNREFUSED failures that look like application bugs but are not.
   * Runtime state is not source, so it should never trigger a recompile.
   */
  webpack: (config) => {
    // Next's default `ignored` may be a RegExp or an array mixing RegExps and
    // strings; webpack rejects the array form unless every entry is a
    // non-empty glob string, so keep only the string entries and append ours.
    const current = config.watchOptions?.ignored;
    const asArray = Array.isArray(current) ? current : current ? [current] : [];
    const globs = asArray.filter((p) => typeof p === 'string' && p.length > 0);
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        ...new Set([
          ...globs,
          '**/node_modules/**',
          '**/.git/**',
          '**/.data/**',
          '**/.next-build/**',
        ]),
      ],
    };
    return config;
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // The Arena live preview embeds dev servers in an iframe. Keep the
          // clickjacking protection for production, but do not block the local
          // preview frame while developing.
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }]
            : []),
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
        ],
      },
    ];
  },
};
export default nextConfig;
