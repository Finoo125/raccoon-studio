import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler: auto-memoizes components/hooks so re-renders stay cheap
  // across the ~70 client components, without hand-written useMemo/useCallback.
  // It bails out per-component on anything it can't safely compile, so it never
  // changes behaviour — only removes wasted renders. The codebase already
  // follows the react-compiler ESLint rules, so it compiles cleanly.
  reactCompiler: true,

  // Lets a second dev server run against this same checkout without the two
  // clobbering each other's build output (used to capture manual screenshots
  // from a sandboxed instance). Unset = normal `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Tree-shake barrel imports from framer-motion (lucide-react is already in
  // Next's default list). Keeps the per-page JS shipped to the browser smaller.
  experimental: {
    optimizePackageImports: ["framer-motion"],
  },
};

export default nextConfig;
