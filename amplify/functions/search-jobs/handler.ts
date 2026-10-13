import type { Schema } from "../../data/resource";
import { env } from "$amplify/env/search-jobs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ADZUNA_URL = "https://api.adzuna.com/v1/api/jobs/us/search";
const CACHE_TTL_SECONDS = 6 * 60 * 60; // reuse identical searches for 6 hours
const RESULTS_PER_PAGE = 50;
const MILES_TO_KM = 1.609;
const REMOTE_PATTERN = /\b(remote|work from home|wfh|telecommute|fully remote)\b/i;

type AdzunaJob = {
  id: string | number;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  latitude?: number;
  longitude?: number;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
};

type AdzunaResponse = { count?: number; results?: AdzunaJob[] };

type JobResult = {
  sourceId: string;
  title: string;
  companyName: string;
  normalizedCompanyName: string;
  description: string | null;
  url: string | null;
  locationName: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  isRemote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryIsEstimated: boolean;
  postedAt: string | null;
  duplicateCount: number;
};

type SearchPayload = { totalCount: number; results: JobResult[] };

// Must match normalizeCompanyName in src/lib.ts so search results line up with tracked companies.
function normalizeCompanyName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[.,'"&()!]/g, " ")
    .replace(/\b(the|inc|incorporated|corp|corporation|llc|ltd|co|company|group)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || name.toLowerCase().trim();
}

// Adzuna text sometimes contains zero-width characters and stray whitespace.
function cleanText(value?: string): string {
  return (value ?? "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

// Cleans results and merges duplicates (same company + same title posted in several towns).
function transform(jobs: AdzunaJob[]): JobResult[] {
  const byKey = new Map<string, JobResult>();

  for (const job of jobs) {
    const companyName = cleanText(job.company?.display_name) || "Unknown company";
    const normalizedCompanyName = normalizeCompanyName(companyName);
    const title = cleanText(job.title) || "Untitled role";
    const description = cleanText(job.description);
    const key = `${normalizedCompanyName}|${title.toLowerCase()}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.duplicateCount += 1;
      continue;
    }

    const area = job.location?.area ?? [];
    byKey.set(key, {
      sourceId: String(job.id),
      title,
      companyName,
      normalizedCompanyName,
      description: description || null,
      url: job.redirect_url ?? null,
      locationName: cleanText(job.location?.display_name) || null,
      city: area.length >= 4 ? area[area.length - 1] : null,
      state: area.length >= 2 ? area[1] : null,
      latitude: job.latitude ?? null,
      longitude: job.longitude ?? null,
      isRemote: REMOTE_PATTERN.test(`${title} ${description}`),
      salaryMin: job.salary_min ?? null,
      salaryMax: job.salary_max ?? null,
      salaryIsEstimated: job.salary_is_predicted === "1",
      postedAt: job.created ?? null,
      duplicateCount: 0,
    });
  }

  return [...byKey.values()];
}

async function readCache(tableName: string, cacheKey: string): Promise<SearchPayload | null> {
  try {
    const result = await ddb.send(new GetCommand({ TableName: tableName, Key: { cacheKey } }));
    const item = result.Item;
    if (item && typeof item.expiresAt === "number" && item.expiresAt > Math.floor(Date.now() / 1000)) {
      return item.payload as SearchPayload;
    }
  } catch (err) {
    console.warn("Cache read failed; continuing without cache.", err);
  }
  return null;
}

async function writeCache(tableName: string, cacheKey: string, payload: SearchPayload): Promise<void> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          cacheKey,
          payload,
          expiresAt: Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS,
        },
      })
    );
  } catch (err) {
    console.warn("Cache write failed; results still returned.", err);
  }
}

export const handler: Schema["searchJobs"]["functionHandler"] = async (event) => {
  const what = (event.arguments.what ?? "").trim().slice(0, 100);
  const where = (event.arguments.where ?? "").trim().slice(0, 100);
  if (!what || !where) {
    throw new Error("Enter both a job title and a location.");
  }

  const distanceMiles = clamp(event.arguments.distance ?? 25, 1, 100);
  const page = clamp(event.arguments.page ?? 1, 1, 10);
  const cacheKey = `v1|us|${what.toLowerCase()}|${where.toLowerCase()}|${distanceMiles}|${page}`;
  const tableName = process.env.CACHE_TABLE_NAME;

  if (tableName) {
    const cached = await readCache(tableName, cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  // Adzuna measures distance in kilometers.
  const params = new URLSearchParams({
    app_id: env.ADZUNA_APP_ID,
    app_key: env.ADZUNA_APP_KEY,
    what,
    where,
    distance: String(Math.round(distanceMiles * MILES_TO_KM)),
    results_per_page: String(RESULTS_PER_PAGE),
    "content-type": "application/json",
  });

  // Never log the full URL: it contains the API credentials.
  const response = await fetch(`${ADZUNA_URL}/${page}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    console.error(`Adzuna request failed with HTTP ${response.status}`);
    if (response.status === 401 || response.status === 403) {
      throw new Error("Job search credentials were rejected. Check the Adzuna secrets.");
    }
    if (response.status === 429) {
      throw new Error("Job search rate limit reached. Try again in a minute.");
    }
    throw new Error(`Job search failed (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as AdzunaResponse;
  const payload: SearchPayload = {
    totalCount: body.count ?? 0,
    results: transform(body.results ?? []),
  };

  if (tableName) await writeCache(tableName, cacheKey, payload);
  return { ...payload, cached: false };
};