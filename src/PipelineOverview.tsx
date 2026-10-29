import { useMemo, useState } from "react";
import { STATUS_LABELS, daysSince, lastActivityAt, needsFollowUp } from "./lib";
import type { AppEvent, Application, Company, Status } from "./lib";

type Props = {
  applications: Application[];
  companies: Company[];
  events: AppEvent[];
  followUpDays: number;
  onOpenApplication: (app: Application) => void;
  onLogFollowUp: (app: Application) => Promise<void>;
};

const OPEN_STAGES: Status[] = ["SAVED", "APPLIED", "SCREENING", "INTERVIEWING", "OFFER"];
const CLOSED_STAGES: Status[] = ["ACCEPTED", "REJECTED", "WITHDRAWN"];

export default function PipelineOverview({
  applications,
  companies,
  events,
  followUpDays,
  onOpenApplication,
  onLogFollowUp,
}: Props) {
  const [loggingId, setLoggingId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = {} as Record<Status, number>;
    for (const app of applications) {
      const s = (app.status ?? "SAVED") as Status;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [applications]);

  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);

  // Oldest silence first.
  const followUps = useMemo(
    () =>
      applications
        .filter((a) => needsFollowUp(a, events, followUpDays))
        .map((a) => ({ app: a, days: daysSince(lastActivityAt(a, events)) }))
        .sort((a, b) => b.days - a.days),
    [applications, events, followUpDays]
  );

  // Responses: applications that moved past "Applied" (screening or later, including rejections).
  const applied = applications.filter((a) => a.status && a.status !== "SAVED" && a.status !== "WITHDRAWN").length;
  const responded = applications.filter((a) =>
    ["SCREENING", "INTERVIEWING", "OFFER", "ACCEPTED", "REJECTED"].includes(a.status ?? "")
  ).length;

  async function logFollowUp(app: Application) {
    setLoggingId(app.id);
    try {
      await onLogFollowUp(app);
    } finally {
      setLoggingId(null);
    }
  }

  if (applications.length === 0) return null;

  return (
    <section className="panel pipeline" aria-label="Pipeline overview">
      <div className="pipeline-head">
        <h2>Pipeline</h2>
        {applied > 0 && (
          <p className="company-meta">
            {responded} of {applied} applications got a response ({Math.round((responded / applied) * 100)}%)
          </p>
        )}
      </div>

      <ol className="stages">
        {OPEN_STAGES.map((s) => (
          <li key={s} className={`stage status-${s.toLowerCase()}`}>
            <span className="stage-count">{counts[s] ?? 0}</span>
            <span className="stage-label">{STATUS_LABELS[s]}</span>
          </li>
        ))}
      </ol>
      <p className="company-meta closed-stages">
        Closed: {CLOSED_STAGES.map((s) => `${counts[s] ?? 0} ${STATUS_LABELS[s].toLowerCase()}`).join(", ")}
      </p>

      <div className="followups">
        <h3>
          Needs follow-up {followUps.length > 0 && <span className="badge badge-warn">{followUps.length}</span>}
        </h3>
        {followUps.length === 0 ? (
          <p className="company-meta">
            Nothing waiting. Applications show up here after {followUpDays} days with no activity.
          </p>
        ) : (
          <ul>
            {followUps.map(({ app, days }) => (
              <li key={app.id} className="followup">
                <button type="button" className="followup-title" onClick={() => onOpenApplication(app)}>
                  <span>{app.roleTitle}</span>
                  <span className="company-meta">
                    {companyName.get(app.companyId) ?? "Unknown company"} / {STATUS_LABELS[(app.status ?? "SAVED") as Status]} / no activity for {days} days
                  </span>
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={loggingId !== null}
                  onClick={() => logFollowUp(app)}
                >
                  {loggingId === app.id ? "Logging..." : "I followed up"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}