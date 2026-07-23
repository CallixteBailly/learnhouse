import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // No incremental cache on Pages — disable ISR caching
  incrementalCache: undefined,
});
