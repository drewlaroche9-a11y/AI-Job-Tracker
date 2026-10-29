import { defineBackend } from "@aws-amplify/backend";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";
import { searchJobs } from "./functions/search-jobs/resource";
import { scoreJobs } from "./functions/score-jobs/resource";
import { suggestRoles } from "./functions/suggest-roles/resource";

const backend = defineBackend({
  auth,
  data,
  storage,
  searchJobs,
  scoreJobs,
  suggestRoles,
});

// Invite-only sign-up: nobody can create their own account. New users are added by an
// admin in the Cognito console. This matters once the site is public, because every
// account can run searches and AI calls that are billed to this AWS account.
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true };

const searchFunction = backend.searchJobs.resources.lambda;
const scoreFunction = backend.scoreJobs.resources.lambda;
const suggestFunction = backend.suggestRoles.resources.lambda;

// Shared cache for Adzuna results, AI fit scores, and role suggestions (each uses its own
// key prefix). Created in the functions' stack to avoid circular dependencies.
// Items expire automatically via DynamoDB TTL.
const functionStack = Stack.of(searchFunction);

const searchCache = new Table(functionStack, "JobSearchCache", {
  partitionKey: { name: "cacheKey", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expiresAt",
  removalPolicy: RemovalPolicy.DESTROY,
});

// Least privilege: each function can read/write only this table.
for (const [fn, backendFn] of [
  [searchFunction, backend.searchJobs],
  [scoreFunction, backend.scoreJobs],
  [suggestFunction, backend.suggestRoles],
] as const) {
  searchCache.grantReadWriteData(fn);
  backendFn.addEnvironment("CACHE_TABLE_NAME", searchCache.tableName);
}

// Least privilege for Bedrock: invoke only Claude Haiku and Amazon Nova Lite/Micro models.
// Cross-region inference profiles (us. and global.) route requests to foundation models in
// other regions, so the foundation-model ARNs use a wildcard region. Global profiles use an
// empty region in that ARN, which the "*" also matches.
function allowModelInvoke(fn: IFunction) {
  const { account } = Stack.of(fn);
  fn.addToRolePolicy(
    new PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:*:${account}:inference-profile/us.anthropic.claude-haiku-*`,
        `arn:aws:bedrock:*:${account}:inference-profile/global.anthropic.claude-haiku-*`,
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-*",
        `arn:aws:bedrock:*:${account}:inference-profile/us.amazon.nova-lite-*`,
        `arn:aws:bedrock:*:${account}:inference-profile/us.amazon.nova-micro-*`,
        "arn:aws:bedrock:*::foundation-model/amazon.nova-lite-*",
        "arn:aws:bedrock:*::foundation-model/amazon.nova-micro-*",
      ],
    })
  );
}

allowModelInvoke(scoreFunction);
allowModelInvoke(suggestFunction);