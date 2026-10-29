import { defineFunction } from "@aws-amplify/backend";

// Scores job search results against the user's profile with a model on Amazon Bedrock.
// MODEL_ID must be a Bedrock inference profile ID your account can use.
// Find it in the Bedrock console: Model catalog -> the model -> inference profile ID.
//
// Options (the IAM policy in backend.ts allows these families):
//   Claude Haiku 4.5:   "global.anthropic.claude-haiku-4-5-20251001-v1:0"  (global inference profile)
//   Claude Haiku 4.5:   "us.anthropic.claude-haiku-4-5-20251001-v1:0"      (US-only inference profile)
//   Amazon Nova Lite:   "us.amazon.nova-lite-v1:0"                         (enabled by default, good for testing)
export const scoreJobs = defineFunction({
  name: "score-jobs",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: {
    MODEL_ID: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  },
});