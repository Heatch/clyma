import { defineCloudflareConfig } from "@opennextjs/cloudflare"

// Defaults are fine for Clyma: no ISR/revalidation cache, no image
// optimisation queue. The app renders every page dynamically from D1 and
// serves the client bundle as Worker static assets.
export default defineCloudflareConfig({})
