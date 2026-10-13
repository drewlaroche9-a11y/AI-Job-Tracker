import { defineBackend } from "@aws-amplify/backend";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { searchJobs } from "./functions/search-jobs/resource";

const backend = defineBackend({
  auth,
  data,
  searchJobs,
});

// Cache table for Adzuna results. Created in the function's own stack to avoid
// circular dependencies. Items expire automatically via DynamoDB TTL.
const searchFunction = backend.searchJobs.resources.lambda;
const functionStack = Stack.of(searchFunction);

const searchCache = new Table(functionStack, "JobSearchCache", {
  partitionKey: { name: "cacheKey", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expiresAt",
  removalPolicy: RemovalPolicy.DESTROY,
});

// Least privilege: the search function can read/write only this table.
searchCache.grantReadWriteData(searchFunction);
backend.searchJobs.addEnvironment("CACHE_TABLE_NAME", searchCache.tableName);