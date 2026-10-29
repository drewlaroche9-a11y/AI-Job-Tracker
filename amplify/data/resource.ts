import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { searchJobs } from "../functions/search-jobs/resource";
import { scoreJobs } from "../functions/score-jobs/resource";
import { suggestRoles } from "../functions/suggest-roles/resource";

/*
 * Job tracker data model
 *
 * Company          one row per employer (normalizedName merges "RTX" / "RTX Corporation")
 *   Posting        job listings from Adzuna or added manually
 *   Application    what the user actually applied to
 *     ApplicationEvent   timeline: status changes, notes, and (later) parsed emails
 *
 * Profile          the user's job-search profile (one per user); input for search and AI matching
 * searchJobs       custom query backed by the search-jobs Lambda (Adzuna + cache)
 * scoreJobs        custom query backed by the score-jobs Lambda (Claude on Bedrock + cache)
 * suggestRoles     custom query backed by the suggest-roles Lambda (Claude + Adzuna market data)
 *
 * Every stored record is owner-scoped: users can only see and edit their own data.
 */

const schema = a.schema({
  ApplicationStatus: a.enum([
    "SAVED",
    "APPLIED",
    "SCREENING",
    "INTERVIEWING",
    "OFFER",
    "ACCEPTED",
    "REJECTED",
    "WITHDRAWN",
  ]),

  EventType: a.enum([
    "STATUS_CHANGE",
    "NOTE",
    "EMAIL_RECEIVED",
    "EMAIL_SENT",
    "INTERVIEW_SCHEDULED",
    "FOLLOW_UP",
  ]),

  RemotePreference: a.enum(["ANY", "REMOTE", "HYBRID", "ONSITE"]),

  ExperienceLevel: a.enum(["INTERN", "ENTRY", "MID", "SENIOR", "LEAD"]),

  ClearanceLevel: a.enum(["NONE", "PUBLIC_TRUST", "SECRET", "TOP_SECRET", "TS_SCI"]),

  Profile: a
    .model({
      fullName: a.string(),
      headline: a.string(),
      homeLocation: a.string(),
      searchRadiusMiles: a.integer(),
      remotePreference: a.ref("RemotePreference"),
      experienceLevel: a.ref("ExperienceLevel"),
      clearanceLevel: a.ref("ClearanceLevel"),
      minSalary: a.integer(),
      targetRoles: a.string().array(),
      skills: a.string().array(),
      certifications: a.string().array(),
      preferredLocations: a.string().array(),
      resumeText: a.string(),
      resumeFileName: a.string(),
      resumeContentType: a.string(),
      resumeUploadedAt: a.datetime(),
      followUpDays: a.integer(),
    })
    .authorization((allow) => [allow.owner()]),

  Company: a
    .model({
      name: a.string().required(),
      normalizedName: a.string().required(),
      website: a.url(),
      city: a.string(),
      state: a.string(),
      latitude: a.float(),
      longitude: a.float(),
      notes: a.string(),
      postings: a.hasMany("Posting", "companyId"),
      applications: a.hasMany("Application", "companyId"),
    })
    .authorization((allow) => [allow.owner()]),

  Posting: a
    .model({
      companyId: a.id().required(),
      company: a.belongsTo("Company", "companyId"),
      source: a.string().required(),
      sourceId: a.string(),
      title: a.string().required(),
      description: a.string(),
      url: a.url(),
      locationName: a.string(),
      latitude: a.float(),
      longitude: a.float(),
      isRemote: a.boolean().default(false),
      salaryMin: a.float(),
      salaryMax: a.float(),
      salaryIsEstimated: a.boolean().default(false),
      postedAt: a.datetime(),
      relevanceScore: a.float(),
      relevanceReason: a.string(),
      applications: a.hasMany("Application", "postingId"),
    })
    .authorization((allow) => [allow.owner()]),

  Application: a
    .model({
      companyId: a.id().required(),
      company: a.belongsTo("Company", "companyId"),
      postingId: a.id(),
      posting: a.belongsTo("Posting", "postingId"),
      roleTitle: a.string().required(),
      status: a.ref("ApplicationStatus"),
      appliedAt: a.date(),
      contactName: a.string(),
      contactEmail: a.email(),
      notes: a.string(),
      events: a.hasMany("ApplicationEvent", "applicationId"),
    })
    .authorization((allow) => [allow.owner()]),

  ApplicationEvent: a
    .model({
      applicationId: a.id().required(),
      application: a.belongsTo("Application", "applicationId"),
      eventType: a.ref("EventType"),
      summary: a.string().required(),
      details: a.string(),
      source: a.string(),
      occurredAt: a.datetime().required(),
    })
    .authorization((allow) => [allow.owner()]),

  JobSearchResult: a.customType({
    sourceId: a.string().required(),
    title: a.string().required(),
    companyName: a.string().required(),
    normalizedCompanyName: a.string().required(),
    description: a.string(),
    url: a.string(),
    locationName: a.string(),
    city: a.string(),
    state: a.string(),
    latitude: a.float(),
    longitude: a.float(),
    isRemote: a.boolean(),
    salaryMin: a.float(),
    salaryMax: a.float(),
    salaryIsEstimated: a.boolean(),
    postedAt: a.string(),
    duplicateCount: a.integer(),
  }),

  JobSearchResponse: a.customType({
    totalCount: a.integer(),
    cached: a.boolean(),
    results: a.ref("JobSearchResult").array(),
  }),

  searchJobs: a
    .query()
    .arguments({
      what: a.string().required(),
      where: a.string().required(),
      distance: a.integer(),
      page: a.integer(),
    })
    .returns(a.ref("JobSearchResponse"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(searchJobs)),

  JobScore: a.customType({
    sourceId: a.string().required(),
    score: a.integer(),
    reason: a.string(),
  }),

  scoreJobs: a
    .query()
    .arguments({
      jobsJson: a.string().required(),
      profileJson: a.string().required(),
    })
    .returns(a.ref("JobScore").array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(scoreJobs)),

  RoleSuggestion: a.customType({
    title: a.string().required(),
    searchQuery: a.string().required(),
    category: a.string().required(),
    reason: a.string(),
    gaps: a.string(),
    openings: a.integer(),
    averageSalary: a.float(),
    marketArea: a.string(),
  }),

  suggestRoles: a
    .query()
    .arguments({
      profileJson: a.string().required(),
      radiusMiles: a.integer(),
      refresh: a.boolean(),
    })
    .returns(a.ref("RoleSuggestion").array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(suggestRoles)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});