import { defineFunction, secret } from "@aws-amplify/backend";

// Suggests job titles to search for, based on the user's profile (Claude on Bedrock),
// then checks each one against live Adzuna market data (openings and typical pay).
export const suggestRoles = defineFunction({
  name: "suggest-roles",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: {
    MODEL_ID: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    ADZUNA_APP_ID: secret("ADZUNA_APP_ID"),
    ADZUNA_APP_KEY: secret("ADZUNA_APP_KEY"),
  },
});