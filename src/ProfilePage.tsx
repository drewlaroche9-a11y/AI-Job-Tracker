import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import {
  CLEARANCE_LABELS,
  EXPERIENCE_LABELS,
  REMOTE_LABELS,
  blank,
  cleanList,
  client,
  errorText,
} from "./lib";
import type { ClearanceLevel, ExperienceLevel, Message, Profile, RemotePreference } from "./lib";

type Props = {
  profile: Profile | null;
  loaded: boolean;
  onMessage: (message: Message | null) => void;
  onSaved: (profile: Profile) => void;
  onDirtyChange: (dirty: boolean) => void;
};

type Form = {
  fullName: string;
  headline: string;
  homeLocation: string;
  searchRadiusMiles: number;
  remotePreference: RemotePreference;
  experienceLevel: ExperienceLevel;
  clearanceLevel: ClearanceLevel;
  minSalary: string;
  targetRoles: string[];
  skills: string[];
  certifications: string[];
  preferredLocations: string[];
  resumeText: string;
};

const RADIUS_OPTIONS = [10, 25, 50, 100];
const RESUME_MAX_CHARS = 20000;

function toForm(p: Profile | null): Form {
  return {
    fullName: p?.fullName ?? "",
    headline: p?.headline ?? "",
    homeLocation: p?.homeLocation ?? "",
    searchRadiusMiles: p?.searchRadiusMiles ?? 25,
    remotePreference: (p?.remotePreference ?? "ANY") as RemotePreference,
    experienceLevel: (p?.experienceLevel ?? "ENTRY") as ExperienceLevel,
    clearanceLevel: (p?.clearanceLevel ?? "NONE") as ClearanceLevel,
    minSalary: p?.minSalary ? String(p.minSalary) : "",
    targetRoles: cleanList(p?.targetRoles),
    skills: cleanList(p?.skills),
    certifications: cleanList(p?.certifications),
    preferredLocations: cleanList(p?.preferredLocations),
    resumeText: p?.resumeText ?? "",
  };
}

export default function ProfilePage({ profile, loaded, onMessage, onSaved, onDirtyChange }: Props) {
  const [form, setForm] = useState<Form>(() => toForm(profile));
  const [saving, setSaving] = useState(false);
  const loadedProfileId = useRef<string | null>(profile?.id ?? null);

  // Fill the form once when the saved profile first arrives. Later updates
  // never overwrite edits in progress.
  useEffect(() => {
    if (profile && loadedProfileId.current !== profile.id) {
      loadedProfileId.current = profile.id;
      setForm(toForm(profile));
    }
  }, [profile]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(toForm(profile)), [form, profile]);

  // Let the app show "(unsaved)" on the tab, and warn before closing the browser tab.
  useEffect(() => {
    onDirtyChange(dirty);
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, onDirtyChange]);

  const checklist = [
    { label: "Target roles", done: form.targetRoles.length > 0 },
    { label: "Home location", done: form.homeLocation.trim() !== "" },
    { label: "Skills", done: form.skills.length >= 3 },
    { label: "Resume text", done: form.resumeText.trim().length > 200 },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    onMessage(null);

    const salary = form.minSalary.replace(/[$,\s]/g, "");
    if (salary && !/^\d+$/.test(salary)) {
      onMessage({ kind: "error", text: "Minimum salary should be a whole number, like 65000." });
      return;
    }

    const input = {
      fullName: blank(form.fullName) ?? null,
      headline: blank(form.headline) ?? null,
      homeLocation: blank(form.homeLocation) ?? null,
      searchRadiusMiles: form.searchRadiusMiles,
      remotePreference: form.remotePreference,
      experienceLevel: form.experienceLevel,
      clearanceLevel: form.clearanceLevel,
      minSalary: salary ? Number(salary) : null,
      targetRoles: form.targetRoles,
      skills: form.skills,
      certifications: form.certifications,
      preferredLocations: form.preferredLocations,
      resumeText: blank(form.resumeText.slice(0, RESUME_MAX_CHARS)) ?? null,
    };

    setSaving(true);
    try {
      const { data, errors } = profile
        ? await client.models.Profile.update({ id: profile.id, ...input })
        : await client.models.Profile.create(input);
      const err = errorText(errors);
      if (err) throw new Error(err);
      if (!data) throw new Error("The profile was not returned after saving.");

      // Use the saved record right away instead of waiting for the live
      // subscription, and reset the form to the cleaned-up saved values
      // (trimmed text, "60,000" stored as 60000) so it no longer looks unsaved.
      const saved = data as Profile;
      loadedProfileId.current = saved.id;
      onSaved(saved);
      setForm(toForm(saved));
      onMessage({ kind: "info", text: "Profile saved." });
    } catch (err) {
      onMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <section className="panel"><p className="empty">Loading your profile...</p></section>;
  }

  return (
    <form className="panel profile" onSubmit={save}>
      <div className="profile-head">
        <div>
          <h2>Your profile</h2>
          <p className="company-meta">
            Used to prefill job searches and, next, to score how well each job fits you.
          </p>
        </div>
        <div className="checklist" aria-label="Profile completeness">
          <p className="company-meta">{doneCount} of {checklist.length} key sections done</p>
          <ul>
            {checklist.map((c) => (
              <li key={c.label} className={c.done ? "done" : ""}>
                {c.done ? "Done" : "To do"}: {c.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <fieldset>
        <legend>About you</legend>
        <div className="grid-2">
          <Field label="Full name">
            {(id) => <input id={id} value={form.fullName} onChange={(e) => update("fullName", e.target.value)} />}
          </Field>
          <Field label="Headline" hint="One line, like a LinkedIn headline">
            {(id) => (
              <input
                id={id}
                placeholder="Cybersecurity student focused on SOC operations"
                value={form.headline}
                onChange={(e) => update("headline", e.target.value)}
              />
            )}
          </Field>
          <Field label="Experience level">
            {(id) => (
              <select
                id={id}
                value={form.experienceLevel}
                onChange={(e) => update("experienceLevel", e.target.value as ExperienceLevel)}
              >
                {(Object.keys(EXPERIENCE_LABELS) as ExperienceLevel[]).map((k) => (
                  <option key={k} value={k}>{EXPERIENCE_LABELS[k]}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Security clearance" hint="Used to flag jobs that require one">
            {(id) => (
              <select
                id={id}
                value={form.clearanceLevel}
                onChange={(e) => update("clearanceLevel", e.target.value as ClearanceLevel)}
              >
                {(Object.keys(CLEARANCE_LABELS) as ClearanceLevel[]).map((k) => (
                  <option key={k} value={k}>{CLEARANCE_LABELS[k]}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>What you're looking for</legend>
        <TagInput
          label="Target roles"
          hint="The first one prefills job searches"
          placeholder="SOC analyst"
          values={form.targetRoles}
          onChange={(v) => update("targetRoles", v)}
        />
        <div className="grid-2">
          <Field label="Home location" hint="City or ZIP code for searches">
            {(id) => (
              <input
                id={id}
                placeholder="Providence, RI"
                value={form.homeLocation}
                onChange={(e) => update("homeLocation", e.target.value)}
              />
            )}
          </Field>
          <Field label="Search radius">
            {(id) => (
              <select
                id={id}
                value={form.searchRadiusMiles}
                onChange={(e) => update("searchRadiusMiles", Number(e.target.value))}
              >
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>Within {r} miles</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Work arrangement">
            {(id) => (
              <select
                id={id}
                value={form.remotePreference}
                onChange={(e) => update("remotePreference", e.target.value as RemotePreference)}
              >
                {(Object.keys(REMOTE_LABELS) as RemotePreference[]).map((k) => (
                  <option key={k} value={k}>{REMOTE_LABELS[k]}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Minimum salary" hint="Optional, yearly in USD">
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                placeholder="60000"
                value={form.minSalary}
                onChange={(e) => update("minSalary", e.target.value)}
              />
            )}
          </Field>
        </div>
        <TagInput
          label="Other locations you'd consider"
          placeholder="Boston, MA"
          values={form.preferredLocations}
          onChange={(v) => update("preferredLocations", v)}
        />
      </fieldset>

      <fieldset>
        <legend>Skills and credentials</legend>
        <TagInput
          label="Skills"
          hint="Tools, languages, and techniques"
          placeholder="Splunk"
          values={form.skills}
          onChange={(v) => update("skills", v)}
        />
        <TagInput
          label="Certifications"
          placeholder="CompTIA Security+"
          values={form.certifications}
          onChange={(v) => update("certifications", v)}
        />
      </fieldset>

      <fieldset>
        <legend>Resume</legend>
        <Field
          label="Resume text"
          hint={`Paste the text of your resume. ${form.resumeText.length.toLocaleString()} of ${RESUME_MAX_CHARS.toLocaleString()} characters.`}
        >
          {(id) => (
            <textarea
              id={id}
              rows={12}
              maxLength={RESUME_MAX_CHARS}
              value={form.resumeText}
              onChange={(e) => update("resumeText", e.target.value)}
            />
          )}
        </Field>
      </fieldset>

      <div className="save-bar">
        <span className="company-meta">{dirty ? "You have unsaved changes." : "All changes saved."}</span>
        <button type="submit" disabled={!dirty || saving}>{saving ? "Saving..." : "Save profile"}</button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function TagInput({
  label,
  hint,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const next = [...values];
    for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part.slice(0, 60));
    }
    onChange(next.slice(0, 50));
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="tags">
        {values.map((v) => (
          <span key={v} className="tag">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          placeholder={values.length === 0 ? placeholder : "Add another"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
      <p className="hint">{hint ? `${hint}. ` : ""}Press Enter or a comma to add.</p>
    </div>
  );
}
