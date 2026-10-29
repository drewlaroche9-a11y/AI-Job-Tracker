import { useState } from "react";
import { buildScoringProfile, cleanList, client, describeError, errorText } from "./lib";
import type { Message, Profile, RoleSuggestion } from "./lib";

type Props = {
  profile: Profile | null;
  profileDirty: boolean;
  onSearchRole: (query: string) => void;
  onProfileUpdated: (profile: Profile) => void;
  onMessage: (message: Message | null) => void;
  onOpenProfile: () => void;
};

const CATEGORY_INFO: Record<string, { label: string; blurb: string }> = {
  direct: { label: "Direct fit", blurb: "Roles you qualify for now" },
  adjacent: { label: "Adjacent", blurb: "Related roles you may not have considered" },
  stretch: { label: "Stretch", blurb: "Higher-paying roles with one gap to close" },
};
const CATEGORY_ORDER = ["direct", "adjacent", "stretch"];

function money(n: number): string {
  return `$${Math.round(n / 1000)}k`;
}

export default function RoleSuggestions({
  profile,
  profileDirty,
  onSearchRole,
  onProfileUpdated,
  onMessage,
  onOpenProfile,
}: Props) {
  const [suggestions, setSuggestions] = useState<RoleSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [addingTitle, setAddingTitle] = useState<string | null>(null);

  const targetRoles = cleanList(profile?.targetRoles);
  const minSalary = profile?.minSalary ?? null;

  async function suggest(refresh: boolean) {
    if (!profile) return;
    onMessage(null);
    setLoading(true);
    try {
      const { data, errors } = await client.queries.suggestRoles({
        profileJson: JSON.stringify(buildScoringProfile(profile)),
        radiusMiles: profile.searchRadiusMiles ?? 25,
        refresh,
      });
      const err = errorText(errors);
      if (err) throw new Error(err);
      setSuggestions((data ?? []).filter((s): s is RoleSuggestion => s != null));
      setOpen(true);
    } catch (err) {
      onMessage({ kind: "error", text: describeError(err) });
    } finally {
      setLoading(false);
    }
  }

  async function addToTargets(title: string) {
    if (!profile) return;
    setAddingTitle(title);
    onMessage(null);
    try {
      const { data, errors } = await client.models.Profile.update({
        id: profile.id,
        targetRoles: [...targetRoles, title],
      });
      const err = errorText(errors);
      if (err) throw new Error(err);
      if (data) onProfileUpdated(data as Profile);
      onMessage({ kind: "info", text: `Added "${title}" to your target roles.` });
    } catch (err) {
      onMessage({ kind: "error", text: describeError(err) });
    } finally {
      setAddingTitle(null);
    }
  }

  if (!profile) {
    return (
      <div className="suggest-panel">
        <p className="company-meta">
          Add your resume, skills, and desired pay to your profile to get AI role suggestions.{" "}
          <button type="button" className="ghost" onClick={onOpenProfile}>Go to profile</button>
        </p>
      </div>
    );
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: suggestions.filter((s) => s.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="suggest-panel">
      <div className="suggest-head">
        <div>
          <h3>Roles to consider</h3>
          <p className="company-meta">
            AI suggestions from your profile, checked against live job counts and typical pay.
          </p>
        </div>
        <div className="suggest-actions">
          {suggestions.length > 0 && (
            <button type="button" className="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide" : "Show"}
            </button>
          )}
          <button type="button" className={suggestions.length ? "secondary" : ""} disabled={loading} onClick={() => suggest(suggestions.length > 0)}>
            {loading ? "Thinking..." : suggestions.length ? "Suggest again" : "Suggest roles for me"}
          </button>
        </div>
      </div>

      {open && grouped.length > 0 && (
        <div className="suggest-groups">
          {grouped.map(({ cat, items }) => (
            <section key={cat} className="suggest-group">
              <h4>
                {CATEGORY_INFO[cat]?.label ?? cat}
                <span className="company-meta"> / {CATEGORY_INFO[cat]?.blurb}</span>
              </h4>
              <ul>
                {items.map((s) => {
                  const alreadyTarget = targetRoles.some((r) => r.toLowerCase() === s.title.toLowerCase());
                  const belowMin = minSalary != null && s.averageSalary != null && s.averageSalary < minSalary;
                  return (
                    <li key={s.title} className="suggestion">
                      <div className="suggestion-main">
                        <p className="suggestion-title">{s.title}</p>
                        {s.reason && <p className="fit-reason">{s.reason}</p>}
                        {s.gaps && <p className="company-meta">To get there: {s.gaps}</p>}
                        <p className="company-meta">
                          {s.openings != null ? `${s.openings.toLocaleString()} openings ${s.marketArea}` : "Market data unavailable"}
                          {s.averageSalary != null && ` / typical ${money(s.averageSalary)} (Adzuna estimate)`}
                        </p>
                        {belowMin && (
                          <p className="pay-warn">Typical pay is below your {money(minSalary ?? 0)} minimum.</p>
                        )}
                      </div>
                      <div className="suggestion-buttons">
                        <button type="button" onClick={() => onSearchRole(s.searchQuery)}>Search this role</button>
                        {alreadyTarget ? (
                          <span className="company-meta">In your target roles</span>
                        ) : (
                          <button
                            type="button"
                            className="ghost"
                            disabled={addingTitle !== null || profileDirty}
                            title={profileDirty ? "Save your profile changes first" : undefined}
                            onClick={() => addToTargets(s.title)}
                          >
                            {addingTitle === s.title ? "Adding..." : "Add to target roles"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}