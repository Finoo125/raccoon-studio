import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler: auto-memoizes components/hooks so re-renders stay cheap
  // across the ~70 client components, without hand-written useMemo/useCallback.
  // It bails out per-component on anything it can't safely compile, so it never
  // changes behaviour — only removes wasted renders. The codebase already
  // follows the react-compiler ESLint rules, so it compiles cleanly.
  reactCompiler: true,

  // Tree-shake barrel imports from framer-motion (lucide-react is already in
  // Next's default list). Keeps the per-page JS shipped to the browser smaller.
  experimental: {
    optimizePackageImports: ["framer-motion"],
  },
};

export default nextConfig;
