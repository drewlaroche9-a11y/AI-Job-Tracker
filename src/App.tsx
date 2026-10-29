import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Authenticator } from "@aws-amplify/ui-react";
import JobSearch from "./JobSearch";
import ProfilePage from "./ProfilePage";
import PipelineOverview from "./PipelineOverview";
import {
  DEFAULT_FOLLOW_UP_DAYS,
  STATUSES,
  STATUS_LABELS,
  blank,
  client,
  daysSince,
  describeError,
  errorText,
  formatSalary,
  lastActivityAt,
  needsFollowUp,
  normalizeCompanyName,
  normalizeUrl,
} from "./lib";
import type { AppEvent, Application, Company, Message, Posting, Profile, Status } from "./lib";

type Tab = "tracker" | "search" | "profile";

const EMPTY_COMPANY = { name: "", city: "", state: "", website: "" };
const EMPTY_APP = {
  roleTitle: "",
  status: "APPLIED" as Status,
  appliedAt: "",
  contactName: "",
  contactEmail: "",
  notes: "",
};

export default function App() {
  return (
    // Sign-up is hidden because accounts are invite-only (see amplify/backend.ts).
    <Authenticator hideSignUp>
      {({ signOut, user }) => (
        <Tracker email={user?.signInDetails?.loginId ?? ""} onSignOut={() => signOut?.()} />
      )}
    </Authenticator>
  );
}

function Tracker({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("tracker");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [postings, setPostings] = useState<Posting[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [companyForm, setCompanyForm] = useState(EMPTY_COMPANY);
  const [appForm, setAppForm] = useState(EMPTY_APP);
  const [noteText, setNoteText] = useState("");
  const [message, setMessage] = useState<Message | null>(null);

  // Live subscriptions: lists update automatically when data changes.
  useEffect(() => {
    // Name the table in the message so it's clear which live subscription failed.
    const onError = (table: string) => (e: unknown) => {
      console.error(`${table} subscription error`, e);
      setMessage({
        kind: "error",
        text: `Live updates for ${table} stopped: ${describeError(e)}. Reload the page to reconnect.`,
      });
    };
    const subs = [
      client.models.Profile.observeQuery().subscribe({
        next: ({ items, isSynced }) => {
          // One profile per user; if duplicates ever exist, use the oldest.
          const sorted = [...items].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
          setProfile(sorted[0] ?? null);
          if (isSynced) setProfileLoaded(true);
        },
        error: onError("Profile"),
      }),
      client.models.Company.observeQuery().subscribe({ next: ({ items }) => setCompanies([...items]), error: onError("Company") }),
      client.models.Posting.observeQuery().subscribe({ next: ({ items }) => setPostings([...items]), error: onError("Posting") }),
      client.models.Application.observeQuery().subscribe({ next: ({ items }) => setApplications([...items]), error: onError("Application") }),
      client.models.ApplicationEvent.observeQuery().subscribe({ next: ({ items }) => setEvents([...items]), error: onError("ApplicationEvent") }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies]
  );

  const appCountByCompany = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const app of applications) counts[app.companyId] = (counts[app.companyId] ?? 0) + 1;
    return counts;
  }, [applications]);

  const postingsById = useMemo(() => new Map(postings.map((p) => [p.id, p])), [postings]);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;

  const companyApps = useMemo(
    () =>
      applications
        .filter((a) => a.companyId === selectedCompanyId)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [applications, selectedCompanyId]
  );

  function eventsFor(appId: string): AppEvent[] {
    return events
      .filter((e) => e.applicationId === appId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  function openCompany(companyId: string) {
    setTab("tracker");
    setSelectedCompanyId(companyId);
    setExpandedAppId(null);
  }

  // Jumps to an application from the follow-up list, opened and ready to edit.
  function openApplication(app: Application) {
    setTab("tracker");
    setSelectedCompanyId(app.companyId);
    setExpandedAppId(app.id);
    setNoteText("");
  }

  // Logging a follow-up counts as activity, so the reminder clears.
  async function logFollowUp(app: Application) {
    await logEvent(app.id, "FOLLOW_UP", "Followed up");
  }

  const followUpDays = profile?.followUpDays ?? DEFAULT_FOLLOW_UP_DAYS;

  async function logEvent(applicationId: string, eventType: AppEvent["eventType"], summary: string, details?: string) {
    const { errors } = await client.models.ApplicationEvent.create({
      applicationId,
      eventType,
      summary,
      details,
      source: "manual",
      occurredAt: new Date().toISOString(),
    });
    const err = errorText(errors);
    if (err) setMessage({ kind: "error", text: err });
  }

  async function addCompany(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const name = companyForm.name.trim();
    if (!name) {
      setMessage({ kind: "error", text: "Enter a company name." });
      return;
    }
    const normalizedName = normalizeCompanyName(name);
    const existing = companies.find((c) => c.normalizedName === normalizedName);
    if (existing) {
      setSelectedCompanyId(existing.id);
      setCompanyForm(EMPTY_COMPANY);
      setMessage({ kind: "info", text: `"${name}" matches ${existing.name}, so that company is selected instead.` });
      return;
    }
    const { data, errors } = await client.models.Company.create({
      name,
      normalizedName,
      city: blank(companyForm.city),
      state: blank(companyForm.state),
      website: normalizeUrl(companyForm.website),
    });
    const err = errorText(errors);
    if (err) {
      setMessage({ kind: "error", text: err });
      return;
    }
    setCompanyForm(EMPTY_COMPANY);
    if (data) setSelectedCompanyId(data.id);
  }

  async function deleteCompany(company: Company) {
    if ((appCountByCompany[company.id] ?? 0) > 0) {
      setMessage({ kind: "error", text: "Delete this company's applications first." });
      return;
    }
    if (!window.confirm(`Delete ${company.name}?`)) return;
    for (const p of postings.filter((p) => p.companyId === company.id)) {
      await client.models.Posting.delete({ id: p.id });
    }
    const { errors } = await client.models.Company.delete({ id: company.id });
    const err = errorText(errors);
    if (err) setMessage({ kind: "error", text: err });
    else setSelectedCompanyId(null);
  }

  async function addApplication(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!selectedCompanyId) return;
    const roleTitle = appForm.roleTitle.trim();
    if (!roleTitle) {
      setMessage({ kind: "error", text: "Enter the role title." });
      return;
    }
    const { data, errors } = await client.models.Application.create({
      companyId: selectedCompanyId,
      roleTitle,
      status: appForm.status,
      appliedAt: blank(appForm.appliedAt),
      contactName: blank(appForm.contactName),
      contactEmail: blank(appForm.contactEmail),
      notes: blank(appForm.notes),
    });
    const err = errorText(errors);
    if (err) {
      setMessage({ kind: "error", text: err });
      return;
    }
    if (data) {
      await logEvent(data.id, "STATUS_CHANGE", `Added as ${STATUS_LABELS[appForm.status]}`);
      setExpandedAppId(data.id);
    }
    setAppForm(EMPTY_APP);
  }

  async function changeStatus(app: Application, next: Status) {
    const previous = (app.status ?? "SAVED") as Status;
    if (previous === next) return;
    const { errors } = await client.models.Application.update({ id: app.id, status: next });
    const err = errorText(errors);
    if (err) {
      setMessage({ kind: "error", text: err });
      return;
    }
    await logEvent(app.id, "STATUS_CHANGE", `${STATUS_LABELS[previous]} to ${STATUS_LABELS[next]}`);
  }

  async function addNote(app: Application) {
    const text = noteText.trim();
    if (!text) return;
    await logEvent(app.id, "NOTE", "Note", text);
    setNoteText("");
  }

  // Deletes the application, its timeline, and its posting if nothing else uses it.
  async function deleteApplication(app: Application) {
    if (!window.confirm(`Delete the ${app.roleTitle} application and its timeline?`)) return;
    for (const ev of eventsFor(app.id)) {
      await client.models.ApplicationEvent.delete({ id: ev.id });
    }
    const { errors } = await client.models.Application.delete({ id: app.id });
    const err = errorText(errors);
    if (err) {
      setMessage({ kind: "error", text: err });
      return;
    }
    if (app.postingId && !applications.some((a) => a.id !== app.id && a.postingId === app.postingId)) {
      await client.models.Posting.delete({ id: app.postingId });
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Job tracker</h1>
        <nav className="tabs" aria-label="Sections">
          <button
            className={`tab ${tab === "tracker" ? "active" : ""}`}
            aria-current={tab === "tracker" ? "page" : undefined}
            onClick={() => setTab("tracker")}
          >
            Tracker
          </button>
          <button
            className={`tab ${tab === "search" ? "active" : ""}`}
            aria-current={tab === "search" ? "page" : undefined}
            onClick={() => setTab("search")}
          >
            Find jobs
          </button>
          <button
            className={`tab ${tab === "profile" ? "active" : ""}`}
            aria-current={tab === "profile" ? "page" : undefined}
            onClick={() => setTab("profile")}
          >
            Profile{profileDirty ? " (unsaved)" : ""}
          </button>
        </nav>
        <div className="account">
          <span>{profile?.fullName || email}</span>
          <button className="ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {message && (
        <div className={`message ${message.kind}`} role="status">
          <span>{message.text}</span>
          <button className="ghost" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}

      {/* All tabs stay mounted and are only hidden, so search results and
          unsaved profile edits survive switching tabs. */}
      <div hidden={tab !== "profile"}>
        <ProfilePage
          profile={profile}
          loaded={profileLoaded}
          onMessage={setMessage}
          onSaved={setProfile}
          onDirtyChange={setProfileDirty}
        />
      </div>

      <div hidden={tab !== "search"}>
        <JobSearch
          profile={profile}
          profileLoaded={profileLoaded}
          profileDirty={profileDirty}
          onProfileUpdated={setProfile}
          companies={companies}
          postings={postings}
          onMessage={setMessage}
          onOpenCompany={openCompany}
          onOpenProfile={() => setTab("profile")}
        />
      </div>

      <div hidden={tab !== "tracker"}>
        <PipelineOverview
          applications={applications}
          companies={companies}
          events={events}
          followUpDays={followUpDays}
          onOpenApplication={openApplication}
          onLogFollowUp={logFollowUp}
        />

        <div className="layout">
          <aside className="panel companies">
            <h2>Companies</h2>
            <form onSubmit={addCompany} className="stack">
              <input
                placeholder="Company name"
                value={companyForm.name}
                onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
              />
              <div className="row">
                <input
                  placeholder="City"
                  value={companyForm.city}
                  onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
                />
                <input
                  placeholder="State"
                  className="short"
                  value={companyForm.state}
                  onChange={(e) => setCompanyForm({ ...companyForm, state: e.target.value })}
                />
              </div>
              <input
                placeholder="Website (optional)"
                value={companyForm.website}
                onChange={(e) => setCompanyForm({ ...companyForm, website: e.target.value })}
              />
              <button type="submit">Add company</button>
            </form>

            {sortedCompanies.length === 0 ? (
              <p className="empty">Add a company here, or save jobs from Find jobs.</p>
            ) : (
              <ul className="company-list">
                {sortedCompanies.map((c) => (
                  <li key={c.id}>
                    <button
                      className={`company-item ${c.id === selectedCompanyId ? "active" : ""}`}
                      onClick={() => openCompany(c.id)}
                    >
                      <span className="company-name">{c.name}</span>
                      <span className="company-meta">
                        {[c.city, c.state].filter(Boolean).join(", ") || "No location"}
                        {" / "}
                        {appCountByCompany[c.id] ?? 0} applications
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <main className="panel detail">
            {!selectedCompany ? (
              <p className="empty">Select a company to see and add applications.</p>
            ) : (
              <>
                <div className="detail-head">
                  <div>
                    <h2>{selectedCompany.name}</h2>
                    <p className="company-meta">
                      {[selectedCompany.city, selectedCompany.state].filter(Boolean).join(", ") || "No location"}
                      {selectedCompany.website && (
                        <>
                          {" / "}
                          <a href={selectedCompany.website} target="_blank" rel="noreferrer">Website</a>
                        </>
                      )}
                    </p>
                  </div>
                  <button className="ghost danger" onClick={() => deleteCompany(selectedCompany)}>
                    Delete company
                  </button>
                </div>

                <form onSubmit={addApplication} className="app-form">
                  <h3>Add an application</h3>
                  <div className="row">
                    <input
                      placeholder="Role title"
                      value={appForm.roleTitle}
                      onChange={(e) => setAppForm({ ...appForm, roleTitle: e.target.value })}
                    />
                    <select
                      value={appForm.status}
                      aria-label="Status"
                      onChange={(e) => setAppForm({ ...appForm, status: e.target.value as Status })}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      aria-label="Date applied"
                      value={appForm.appliedAt}
                      onChange={(e) => setAppForm({ ...appForm, appliedAt: e.target.value })}
                    />
                  </div>
                  <div className="row">
                    <input
                      placeholder="Contact name (optional)"
                      value={appForm.contactName}
                      onChange={(e) => setAppForm({ ...appForm, contactName: e.target.value })}
                    />
                    <input
                      type="email"
                      placeholder="Contact email (optional)"
                      value={appForm.contactEmail}
                      onChange={(e) => setAppForm({ ...appForm, contactEmail: e.target.value })}
                    />
                  </div>
                  <textarea
                    placeholder="Notes (optional)"
                    rows={2}
                    value={appForm.notes}
                    onChange={(e) => setAppForm({ ...appForm, notes: e.target.value })}
                  />
                  <button type="submit">Add application</button>
                </form>

                {companyApps.length === 0 ? (
                  <p className="empty">No applications at {selectedCompany.name} yet.</p>
                ) : (
                  <ul className="app-list">
                    {companyApps.map((app) => {
                      const status = (app.status ?? "SAVED") as Status;
                      const expanded = expandedAppId === app.id;
                      const posting = app.postingId ? postingsById.get(app.postingId) : undefined;
                      const stale = needsFollowUp(app, events, followUpDays);
                      return (
                        <li key={app.id} className="app-item">
                          <div className="app-row">
                            <button
                              className="app-title"
                              aria-expanded={expanded}
                              onClick={() => {
                                setExpandedAppId(expanded ? null : app.id);
                                setNoteText("");
                              }}
                            >
                              <span>{app.roleTitle}</span>
                              <span className="company-meta">
                                {app.appliedAt ? `Applied ${app.appliedAt}` : "Not applied yet"}
                                {posting?.isRemote ? " / Remote" : ""}
                              </span>
                              {stale && (
                                <span className="badge badge-warn">
                                  No activity for {daysSince(lastActivityAt(app, events))} days
                                </span>
                              )}
                            </button>
                            <select
                              className={`status status-${status.toLowerCase()}`}
                              value={status}
                              aria-label="Status"
                              onChange={(e) => changeStatus(app, e.target.value as Status)}
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          </div>

                          {expanded && (
                            <div className="app-detail">
                              {posting?.relevanceScore != null && (
                                <p className="fit-reason">
                                  Fit {Math.round(posting.relevanceScore)}/100
                                  {posting.relevanceReason ? `: ${posting.relevanceReason}` : ""}
                                </p>
                              )}
                              {posting && (
                                <p className="company-meta">
                                  {[posting.locationName, formatSalary(posting.salaryMin, posting.salaryMax, posting.salaryIsEstimated)]
                                    .filter(Boolean)
                                    .join(" / ")}
                                  {posting.url && (
                                    <>
                                      {" / "}
                                      <a href={posting.url} target="_blank" rel="noreferrer">View posting</a>
                                    </>
                                  )}
                                </p>
                              )}
                              {(app.contactName || app.contactEmail) && (
                                <p className="company-meta">
                                  Contact: {[app.contactName, app.contactEmail].filter(Boolean).join(", ")}
                                </p>
                              )}
                              {app.notes && <p>{app.notes}</p>}

                              <h4>Timeline</h4>
                              <ol className="timeline">
                                {eventsFor(app.id).map((ev) => (
                                  <li key={ev.id}>
                                    <time>{new Date(ev.occurredAt).toLocaleString()}</time>
                                    <span>{ev.summary}</span>
                                    {ev.details && <p>{ev.details}</p>}
                                  </li>
                                ))}
                              </ol>

                              <div className="row">
                                <input
                                  placeholder="Add a note to the timeline"
                                  value={noteText}
                                  onChange={(e) => setNoteText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addNote(app);
                                    }
                                  }}
                                />
                                <button onClick={() => addNote(app)}>Add note</button>
                              </div>
                              <button className="ghost danger" onClick={() => deleteApplication(app)}>
                                Delete application
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}