import type { NextConfig } from 'next'

const isGitHubPages = process.env.GITHUB_PAGES === 'true'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: isGitHubPages ? 'export' : undefined,
  basePath: isGitHubPages ? '/hellbreak' : '',
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? '/hellbreak' : '',
  },
  trailingSlash: isGitHubPages,
  images: {
    unoptimized: isGitHubPages,
  },
}

export default nextConfig
