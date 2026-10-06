import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/*
 * Job tracker data model
 *
 * Company          one row per employer (normalizedName merges "RTX" / "RTX Corporation")
 *   Posting        job listings from Adzuna or added manually
 *   Application    what the user actually applied to
 *     ApplicationEvent   timeline: status changes, notes, and (later) parsed emails
 *
 * Every record is owner-scoped: users can only see and edit their own data.
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
  ]),

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
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});