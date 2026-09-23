import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Default incremental cache: R2 bucket binding NEXT_INC_CACHE_R2_BUCKET
  // (see wrangler.jsonc) — persists the ISR/prerender cache across isolates
  // and deployments instead of recomputing every render. The previous
  // `incrementalCache: undefined` was a Pages-era workaround.
});
