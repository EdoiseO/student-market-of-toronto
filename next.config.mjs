const supabaseHostname = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://bmnfynufuqjwjmtlfdxf.supabase.co",
).hostname;

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Private attachments must never enter the shared optimizer cache.
    localPatterns: [
      { pathname: "/SMT_logo.png", search: "" },
      { pathname: "/SMT.png", search: "" },
      { pathname: "/_next/static/media/**", search: "" },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatar.vercel.sh",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
