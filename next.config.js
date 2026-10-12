/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  env: {
    // Baked into the page at build time; the app compares it with /version to spot a newer deploy.
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || 'dev'
  }
}

module.exports = nextConfig
