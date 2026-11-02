import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "student-market-free-test",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-02",
    compatibilityFlags: ["nodejs_compat"],
    observability: {
      enabled: true,
      headSamplingRate: 1,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true },
    },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: bindings.text(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? ""),
    },
  }),
});
