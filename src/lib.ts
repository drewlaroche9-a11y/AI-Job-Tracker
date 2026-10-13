import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

export const client = generateClient<Schema>();

export type Profile = Schema["Profile"]["type"];
export type Company = Schema["Company"]["type"];
export type Posting = Schema["Posting"]["type"];
export type Application = Schema["Application"]["type"];
export type AppEvent = Schema["ApplicationEvent"]["type"];
export type JobResult = Schema["JobSearchResult"]["type"];
export type Status = NonNullable<Application["status"]>;
export type Message = { kind: "error" | "info"; text: string };
export type RemotePreference = NonNullable<Profile["remotePreference"]>;
export type ExperienceLevel = NonNullable<Profile["experienceLevel"]>;
export type ClearanceLevel = NonNullable<Profile["clearanceLevel"]>;

export const REMOTE_LABELS: Record<RemotePreference, string> = {
  ANY: "No preference",
  REMOTE: "Remote only",
  HYBRID: "Hybrid",
  ONSITE: "On-site",
};

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  INTERN: "Internship",
  ENTRY: "Entry level",
  MID: "Mid level",
  SENIOR: "Senior",
  LEAD: "Lead or manager",
};

export const CLEARANCE_LABELS: Record<ClearanceLevel, string> = {
  NONE: "None",
  PUBLIC_TRUST: "Public Trust",
  SECRET: "Secret",
  TOP_SECRET: "Top Secret",
  TS_SCI: "TS/SCI",
};

// Matches postings that mention a security clearance requirement.
export const CLEARANCE_PATTERN =
  /\b(security clearance|secret clearance|top secret|ts\/sci|clearance required|active clearance|public trust)\b/i;

export const STATUSES: Status[] = [
  "SAVED",
  "APPLIED",
  "SCREENING",
  "INTERVIEWING",
  "OFFER",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
];

export const STATUS_LABELS: Record<Status, string> = {
  SAVED: "Saved",
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEWING: "Interviewing",
  OFFER: "Offer",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

// Array fields from Amplify can contain nulls; this returns clean, non-empty strings.
export function cleanList(values?: (string | null)[] | null): string[] {
  return (values ?? []).filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

// Must match normalizeCompanyName in amplify/functions/search-jobs/handler.ts.
export function normalizeCompanyName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[.,'"&()!]/g, " ")
    .replace(/\b(the|inc|incorporated|corp|corporation|llc|ltd|co|company|group)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || name.toLowerCase().trim();
}

// Empty form fields must be sent as undefined; empty strings fail URL/email validation.
export function blank(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function normalizeUrl(value: string): string | undefined {
  const trimmed = blank(value);
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function errorText(errors: { message: string }[] | undefined): string | null {
  return errors && errors.length ? errors.map((e) => e.message).join("; ") : null;
}

// Returns data from an Amplify call or throws a readable error.
export function unwrap<T>(
  result: { data: T | null; errors?: { message: string }[] },
  action: string
): T {
  const err = errorText(result.errors);
  if (err || !result.data) throw new Error(`${action}: ${err ?? "no data returned"}`);
  return result.data;
}

export function formatSalary(min?: number | null, max?: number | null, estimated?: boolean | null): string {
  if (!min && !max) return "Salary not listed";
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  const range = min && max && Math.round(min) !== Math.round(max) ? `${k(min)} to ${k(max)}` : k((min || max) as number);
  return estimated ? `${range} (estimated)` : range;
}

export function daysAgo(iso?: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  return `Posted ${days} days ago`;
}