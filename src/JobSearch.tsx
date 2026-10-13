import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CLEARANCE_PATTERN, cleanList, client, daysAgo, errorText, formatSalary, unwrap } from "./lib";
import type { Company, JobResult, Message, Posting, Profile } from "./lib";

type Props = {
  profile: Profile | null;
  profileLoaded: boolean;
  companies: Company[];
  postings: Posting[];
  onMessage: (message: Message | null) => void;
  onOpenCompany: (companyId: string) => void;
  onOpenProfile: () => void;
};

type Filter = "all" | "onsite" | "remote";

const DISTANCES = [10, 25, 50, 100];

function closestDistance(miles: number): number {
  return DISTANCES.reduce((best, d) => (Math.abs(d - miles) < Math.abs(best - miles) ? d : best), DISTANCES[0]);
}

export default function JobSearch({
  profile,
  profileLoaded,
  companies,
  postings,
  onMessage,
  onOpenCompany,
  onOpenProfile,
}: Props) {
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [distance, setDistance] = useState(25);
  const [results, setResults] = useState<JobResult[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [prefilled, setPrefilled] = useState(false);

  const targetRoles = cleanList(profile?.targetRoles);
  const hasClearance = Boolean(profile?.clearanceLevel && profile.clearanceLevel !== "NONE");

  // Prefill the search form from the profile once it loads.
  useEffect(() => {
    if (prefilled || !profile) return;
    const roles = cleanList(profile.targetRoles);
    if (roles[0]) setWhat((w) => w || roles[0]);
    const home = profile.homeLocation ?? "";
    if (home) setWhere((w) => w || home);
    if (profile.searchRadiusMiles) setDistance(closestDistance(profile.searchRadiusMiles));
    setPrefilled(true);
  }, [profile, prefilled]);

  // Postings already saved from Adzuna, keyed by Adzuna's job id.
  const savedBySourceId = useMemo(() => {
    const map = new Map<string, Posting>();
    for (const p of postings) {
      if (p.source === "adzuna" && p.sourceId) map.set(p.sourceId, p);
    }
    return map;
  }, [postings]);

  const visible = results.filter((r) =>
    filter === "all" ? true : filter === "remote" ? Boolean(r.isRemote) : !r.isRemote
  );
  const remoteCount = results.filter((r) => r.isRemote).length;

  async function search(e: FormEvent) {
    e.preventDefault();
    onMessage(null);
    if (!what.trim() || !where.trim()) {
      onMessage({ kind: "error", text: "Enter a job title and a location." });
      return;
    }
    setLoading(true);
    try {
      const { data, errors } = await client.queries.searchJobs({
        what: what.trim(),
        where: where.trim(),
        distance,
      });
      const err = errorText(errors);
      if (err) throw new Error(err);
      setResults((data?.results ?? []).filter((r): r is JobResult => r != null));
      setTotalCount(data?.totalCount ?? 0);
      setCached(Boolean(data?.cached));
      const pref = profile?.remotePreference;
      setFilter(pref === "REMOTE" ? "remote" : pref === "ONSITE" ? "onsite" : "all");
    } catch (err) {
      setResults([]);
      setTotalCount(null);
      onMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  // Saves the company (reusing an existing match), the posting, and a SAVED application.
  async function save(job: JobResult) {
    setSavingId(job.sourceId);
    onMessage(null);
    try {
      const existing = companies.find((c) => c.normalizedName === job.normalizedCompanyName);
      const companyId = existing
        ? existing.id
        : unwrap(
            await client.models.Company.create({
              name: job.companyName,
              normalizedName: job.normalizedCompanyName,
              city: job.city ?? undefined,
              state: job.state ?? undefined,
            }),
            "Saving company"
          ).id;
      const companyName = existing?.name ?? job.companyName;

      const posting = unwrap(
        await client.models.Posting.create({
          companyId,
          source: "adzuna",
          sourceId: job.sourceId,
          title: job.title,
          description: job.description ?? undefined,
          url: job.url ?? undefined,
          locationName: job.locationName ?? undefined,
          latitude: job.latitude ?? undefined,
          longitude: job.longitude ?? undefined,
          isRemote: job.isRemote ?? false,
          salaryMin: job.salaryMin ?? undefined,
          salaryMax: job.salaryMax ?? undefined,
          salaryIsEstimated: job.salaryIsEstimated ?? false,
          postedAt: job.postedAt ?? undefined,
        }),
        "Saving posting"
      );

      const application = unwrap(
        await client.models.Application.create({
          companyId,
          postingId: posting.id,
          roleTitle: job.title,
          status: "SAVED",
        }),
        "Saving application"
      );

      unwrap(
        await client.models.ApplicationEvent.create({
          applicationId: application.id,
          eventType: "STATUS_CHANGE",
          summary: "Saved from job search",
          source: "adzuna",
          occurredAt: new Date().toISOString(),
        }),
        "Logging timeline event"
      );

      onMessage({ kind: "info", text: `Saved ${job.title} at ${companyName} to your tracker.` });
    } catch (err) {
      onMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="panel search">
      {profileLoaded && !profile && (
        <div className="message info">
          <span>Set up your profile to prefill searches and flag jobs that don't fit.</span>
          <button type="button" className="ghost" onClick={onOpenProfile}>Go to profile</button>
        </div>
      )}
      <form onSubmit={search} className="search-form">
        <input
          placeholder="Job title or keywords"
          aria-label="Job title or keywords"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
        />
        <input
          placeholder="City or ZIP code"
          aria-label="City or ZIP code"
          value={where}
          onChange={(e) => setWhere(e.target.value)}
        />
        <select aria-label="Distance" value={distance} onChange={(e) => setDistance(Number(e.target.value))}>
          {DISTANCES.map((d) => (
            <option key={d} value={d}>Within {d} miles</option>
          ))}
        </select>
        <button type="submit" disabled={loading}>{loading ? "Searching..." : "Search"}</button>
      </form>

      {targetRoles.length > 1 && (
        <div className="filters role-chips" role="group" aria-label="Your target roles">
          {targetRoles.map((role) => (
            <button
              key={role}
              type="button"
              className={`filter ${what === role ? "active" : ""}`}
              aria-pressed={what === role}
              onClick={() => setWhat(role)}
            >
              {role}
            </button>
          ))}
        </div>
      )}

      {totalCount !== null && (
        <div className="search-summary">
          <p className="company-meta">
            {totalCount} matching jobs. Showing {results.length} after merging duplicate postings
            {cached ? ", from a search made in the last 6 hours." : "."}
          </p>
          {results.length > 0 && (
            <div className="filters" role="group" aria-label="Filter results">
              {(["all", "onsite", "remote"] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`filter ${filter === f ? "active" : ""}`}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? `All (${results.length})` : f === "remote" ? `Remote (${remoteCount})` : `On-site or hybrid (${results.length - remoteCount})`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {totalCount === 0 && (
        <p className="empty">No jobs found. Try a broader title, a bigger radius, or a nearby larger city.</p>
      )}

      <ul className="results">
        {visible.map((job) => {
          const saved = savedBySourceId.get(job.sourceId);
          const duplicates = job.duplicateCount ?? 0;
          const needsClearance = CLEARANCE_PATTERN.test(`${job.title} ${job.description ?? ""}`);
          return (
            <li key={job.sourceId} className="result">
              <div className="result-main">
                <h3>{job.title}</h3>
                <p className="result-company">
                  {job.companyName}
                  {job.isRemote && <span className="badge">Remote</span>}
                  {needsClearance && (
                    <span className={`badge ${hasClearance ? "" : "badge-warn"}`}>
                      {hasClearance ? "Mentions clearance" : "Clearance required"}
                    </span>
                  )}
                </p>
                <p className="company-meta">
                  {[job.locationName, daysAgo(job.postedAt)].filter(Boolean).join(" / ")}
                </p>
                <p className="company-meta">{formatSalary(job.salaryMin, job.salaryMax, job.salaryIsEstimated)}</p>
                {duplicates > 0 && (
                  <p className="company-meta">
                    Also posted in {duplicates} other {duplicates === 1 ? "location" : "locations"}
                  </p>
                )}
                {job.description && <p className="result-desc">{job.description}</p>}
              </div>
              <div className="result-actions">
                {saved ? (
                  <button type="button" className="secondary" onClick={() => onOpenCompany(saved.companyId)}>
                    View in tracker
                  </button>
                ) : (
                  <button type="button" disabled={savingId !== null} onClick={() => save(job)}>
                    {savingId === job.sourceId ? "Saving..." : "Save to tracker"}
                  </button>
                )}
                {job.url && (
                  <a href={job.url} target="_blank" rel="noreferrer">View full posting</a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {totalCount !== null && (
        <p className="attribution">
          <a href="https://www.adzuna.com" target="_blank" rel="noreferrer">Jobs by Adzuna</a>
        </p>
      )}
    </section>
  );
}