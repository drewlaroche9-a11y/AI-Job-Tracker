import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  CLEARANCE_PATTERN,
  buildScoringProfile,
  cleanList,
  client,
  daysAgo,
  errorText,
  fitBand,
  formatSalary,
  unwrap,
} from "./lib";
import type { Company, FitScore, JobResult, Message, Posting, Profile } from "./lib";
import RoleSuggestions from "./RoleSuggestions";

type Props = {
  profile: Profile | null;
  profileLoaded: boolean;
  profileDirty: boolean;
  onProfileUpdated: (profile: Profile) => void;
  companies: Company[];
  postings: Posting[];
  onMessage: (message: Message | null) => void;
  onOpenCompany: (companyId: string) => void;
  onOpenProfile: () => void;
};

type Filter = "all" | "onsite" | "remote";
type SortBy = "fit" | "newest" | "source";

const DISTANCES = [10, 25, 50, 100];

function closestDistance(miles: number): number {
  return DISTANCES.reduce((best, d) => (Math.abs(d - miles) < Math.abs(best - miles) ? d : best), DISTANCES[0]);
}

export default function JobSearch({
  profile,
  profileLoaded,
  profileDirty,
  onProfileUpdated,
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
  const [scores, setScores] = useState<Record<string, FitScore>>({});
  const [scoring, setScoring] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("fit");
  const searchRun = useRef(0); // ignores scores that arrive after a newer search started

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

  const hasScores = Object.keys(scores).length > 0;

  const visible = useMemo(() => {
    const list = results.filter((r) =>
      filter === "all" ? true : filter === "remote" ? Boolean(r.isRemote) : !r.isRemote
    );
    if (sortBy === "fit" && hasScores) {
      return [...list].sort((a, b) => (scores[b.sourceId]?.score ?? -1) - (scores[a.sourceId]?.score ?? -1));
    }
    if (sortBy === "newest") {
      return [...list].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
    }
    return list;
  }, [results, filter, sortBy, scores, hasScores]);
  const remoteCount = results.filter((r) => r.isRemote).length;

  // Sends the results and the profile to the score-jobs Lambda (Claude on Bedrock).
  async function scoreResults(items: JobResult[], run: number) {
    if (!profile || items.length === 0) return;
    setScoring(true);
    try {
      const jobs = items.map((j) => ({
        sourceId: j.sourceId,
        title: j.title,
        companyName: j.companyName,
        locationName: j.locationName,
        isRemote: j.isRemote,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        salaryIsEstimated: j.salaryIsEstimated,
        description: j.description,
      }));
      const { data, errors } = await client.queries.scoreJobs({
        jobsJson: JSON.stringify(jobs),
        profileJson: JSON.stringify(buildScoringProfile(profile)),
      });
      const err = errorText(errors);
      if (err) throw new Error(err);
      if (run !== searchRun.current) return;
      const next: Record<string, FitScore> = {};
      for (const s of data ?? []) {
        if (s) next[s.sourceId] = { score: s.score ?? 0, reason: s.reason ?? "" };
      }
      setScores(next);
      setSortBy("fit");
    } catch (err) {
      if (run === searchRun.current) {
        onMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (run === searchRun.current) setScoring(false);
    }
  }

  function search(e: FormEvent) {
    e.preventDefault();
    void runSearch(what);
  }

  // Used by the role suggestions: fill in the title and search right away.
  function searchFor(query: string) {
    setWhat(query);
    void runSearch(query);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function runSearch(whatValue: string) {
    onMessage(null);
    if (!whatValue.trim() || !where.trim()) {
      onMessage({ kind: "error", text: "Enter a job title and a location." });
      return;
    }
    const run = ++searchRun.current;
    setLoading(true);
    setScores({});
    try {
      const { data, errors } = await client.queries.searchJobs({
        what: whatValue.trim(),
        where: where.trim(),
        distance,
      });
      const err = errorText(errors);
      if (err) throw new Error(err);
      const items = (data?.results ?? []).filter((r): r is JobResult => r != null);
      setResults(items);
      setTotalCount(data?.totalCount ?? 0);
      setCached(Boolean(data?.cached));
      const pref = profile?.remotePreference;
      setFilter(pref === "REMOTE" ? "remote" : pref === "ONSITE" ? "onsite" : "all");
      void scoreResults(items, run);
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
          relevanceScore: scores[job.sourceId]?.score,
          relevanceReason: scores[job.sourceId]?.reason || undefined,
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
      <RoleSuggestions
        profile={profile}
        profileDirty={profileDirty}
        onSearchRole={searchFor}
        onProfileUpdated={onProfileUpdated}
        onMessage={onMessage}
        onOpenProfile={onOpenProfile}
      />

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
            <div className="result-controls">
            <label className="sort">
              <span>Sort</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                <option value="fit" disabled={!hasScores}>Best fit</option>
                <option value="newest">Newest</option>
                <option value="source">Adzuna order</option>
              </select>
            </label>
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
            </div>
          )}
        </div>
      )}

      {scoring && <p className="company-meta scoring-note">Scoring how well each job fits your profile...</p>}
      {totalCount !== null && totalCount > 0 && !profile && (
        <p className="company-meta scoring-note">Fill in your profile to get AI fit scores for these results.</p>
      )}

      {totalCount === 0 && (
        <p className="empty">No jobs found. Try a broader title, a bigger radius, or a nearby larger city.</p>
      )}

      <ul className="results">
        {visible.map((job) => {
          const saved = savedBySourceId.get(job.sourceId);
          const duplicates = job.duplicateCount ?? 0;
          const needsClearance = CLEARANCE_PATTERN.test(`${job.title} ${job.description ?? ""}`);
          const fit = scores[job.sourceId];
          return (
            <li key={job.sourceId} className="result">
              <div className="result-main">
                <div className="result-title">
                  {fit && (
                    <span className={`fit fit-${fitBand(fit.score)}`} aria-label={`Fit score ${fit.score} out of 100`}>
                      {fit.score}
                    </span>
                  )}
                  <h3>{job.title}</h3>
                </div>
                {fit?.reason && <p className="fit-reason">{fit.reason}</p>}
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