import type { NextConfig } from 'next'

const isGitHubPages = process.env.GITHUB_PAGES === 'true'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: isGitHubPages ? 'export' : undefined,
  basePath: isGitHubPages ? '/hellbreak' : '',
  /**
   * The static export is the guest fallback and has no server behind it, so the HIVE route handlers
   * must not be part of it at all. Pages and layouts are `.tsx`; every server route is `route.ts`,
   * so narrowing the recognised extensions removes the whole `src/app/api` tree from the Pages
   * build rather than trying to make request-dependent handlers exportable.
   */
  pageExtensions: isGitHubPages ? ['tsx'] : ['tsx', 'ts'],
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? '/hellbreak' : '',
    // Lets the lobby tell the truth about which topology it is running in.
    NEXT_PUBLIC_STATIC_EXPORT: isGitHubPages ? 'true' : 'false',
  },
  trailingSlash: isGitHubPages,
  images: {
    unoptimized: isGitHubPages,
  },
}

export default nextConfig
