import { defineFunction, secret } from "@aws-amplify/backend";

// Server-side job search. Adzuna credentials come from Amplify secrets
// (stored encrypted in SSM Parameter Store) and never reach the browser.
export const searchJobs = defineFunction({
  name: "search-jobs",
  entry: "./handler.ts",
  timeoutSeconds: 20,
  memoryMB: 256,
  environment: {
    ADZUNA_APP_ID: secret("ADZUNA_APP_ID"),
    ADZUNA_APP_KEY: secret("ADZUNA_APP_KEY"),
  },
});