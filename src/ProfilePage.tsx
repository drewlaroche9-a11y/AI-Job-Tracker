import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from "react";
import {
  CLEARANCE_LABELS,
  EXPERIENCE_LABELS,
  DEFAULT_FOLLOW_UP_DAYS,
  REMOTE_LABELS,
  blank,
  cleanList,
  client,
  describeError,
  errorText,
} from "./lib";
import {
  ACCEPTED_TYPES,
  MAX_RESUME_BYTES,
  deleteResume,
  extractResumeText,
  redactContactInfo,
  resumeDownloadUrl,
  uploadResume,
} from "./resumeFile";
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
  resumeFileName: string;
  resumeContentType: string;
  resumeUploadedAt: string;
  followUpDays: number;
};

const FOLLOW_UP_OPTIONS = [7, 10, 14, 21];
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
    resumeFileName: p?.resumeFileName ?? "",
    resumeContentType: p?.resumeContentType ?? "",
    resumeUploadedAt: p?.resumeUploadedAt ?? "",
    followUpDays: p?.followUpDays ?? DEFAULT_FOLLOW_UP_DAYS,
  };
}

export default function ProfilePage({ profile, loaded, onMessage, onSaved, onDirtyChange }: Props) {
  const [form, setForm] = useState<Form>(() => toForm(profile));
  const [baseline, setBaseline] = useState<Form>(() => toForm(profile));
  const [saving, setSaving] = useState(false);
  const [fileBusy, setFileBusy] = useState<"" | "uploading" | "removing" | "opening">("");
  const fileInput = useRef<HTMLInputElement>(null);
  const baselineRef = useRef<Form>(baseline);
  const syncedVersion = useRef<string | null>(null);

  // When the saved profile changes (first load, or an update from another tab such as
  // "Add to target roles"), refresh the form, but only if there are no edits in progress.
  useEffect(() => {
    if (!profile) return;
    const version = `${profile.id}|${profile.updatedAt}`;
    if (syncedVersion.current === version) return;
    syncedVersion.current = version;
    const incoming = toForm(profile);
    const previousBaseline = baselineRef.current;
    setForm((current) => (JSON.stringify(current) === JSON.stringify(previousBaseline) ? incoming : current));
    baselineRef.current = incoming;
    setBaseline(incoming);
  }, [profile]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);

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

  // Upload a resume: store the file privately in S3, and fill in the resume text from it
  // with email addresses and phone numbers removed. The profile is saved with the Save button.
  async function onResumeChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again later
    if (!file) return;
    onMessage(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      onMessage({ kind: "error", text: "Upload a PDF or a plain text (.txt) file." });
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      onMessage({ kind: "error", text: "That file is over 5 MB. Try a smaller PDF." });
      return;
    }
    if (form.resumeText.trim() && !window.confirm("Replace your current resume text with the text from this file?")) {
      return;
    }

    setFileBusy("uploading");
    try {
      const extracted = await extractResumeText(file);
      const { text, removed } = redactContactInfo(extracted);
      await uploadResume(file);
      setForm((f) => ({
        ...f,
        resumeText: text.slice(0, RESUME_MAX_CHARS),
        resumeFileName: file.name,
        resumeContentType: file.type,
        resumeUploadedAt: new Date().toISOString(),
      }));
      const parts = [`Uploaded ${file.name} and filled in the resume text.`];
      if (removed > 0) parts.push(`Removed ${removed} email address${removed === 1 ? "" : "es"} or phone number${removed === 1 ? "" : "s"}.`);
      if (!text) parts.push("No text could be read from the file, so paste it in instead.");
      parts.push("Check the text for other personal details, then save your profile.");
      onMessage({ kind: "info", text: parts.join(" ") });
    } catch (err) {
      onMessage({ kind: "error", text: `Resume upload failed: ${describeError(err)}` });
    } finally {
      setFileBusy("");
    }
  }

  async function viewResume() {
    setFileBusy("opening");
    try {
      window.open(await resumeDownloadUrl(), "_blank", "noopener,noreferrer");
    } catch (err) {
      onMessage({ kind: "error", text: `Could not open the file: ${describeError(err)}` });
    } finally {
      setFileBusy("");
    }
  }

  async function removeResumeFile() {
    if (!window.confirm("Delete the uploaded resume file? Your resume text stays.")) return;
    setFileBusy("removing");
    try {
      await deleteResume();
      setForm((f) => ({ ...f, resumeFileName: "", resumeContentType: "", resumeUploadedAt: "" }));
      onMessage({ kind: "info", text: "Resume file deleted. Save your profile to finish." });
    } catch (err) {
      onMessage({ kind: "error", text: `Could not delete the file: ${describeError(err)}` });
    } finally {
      setFileBusy("");
    }
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
      resumeFileName: blank(form.resumeFileName) ?? null,
      resumeContentType: blank(form.resumeContentType) ?? null,
      resumeUploadedAt: blank(form.resumeUploadedAt) ?? null,
      followUpDays: form.followUpDays,
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
      const savedForm = toForm(saved);
      syncedVersion.current = `${saved.id}|${saved.updatedAt}`;
      baselineRef.current = savedForm;
      setBaseline(savedForm);
      setForm(savedForm);
      onSaved(saved);
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
                placeholder="One line about your background and goals"
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
          <Field label="Security clearance" hint="Only for government or defense jobs. Leave as None otherwise">
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
          placeholder="A job title you want"
          values={form.targetRoles}
          onChange={(v) => update("targetRoles", v)}
        />
        <div className="grid-2">
          <Field label="Home location" hint="City or ZIP code for searches">
            {(id) => (
              <input
                id={id}
                placeholder="City and state, or ZIP code"
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
          <Field label="Follow-up reminder" hint="Flag applications with no activity after this long">
            {(id) => (
              <select
                id={id}
                value={form.followUpDays}
                onChange={(e) => update("followUpDays", Number(e.target.value))}
              >
                {FOLLOW_UP_OPTIONS.map((d) => (
                  <option key={d} value={d}>After {d} days</option>
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
          placeholder="Another city or ZIP code"
          values={form.preferredLocations}
          onChange={(v) => update("preferredLocations", v)}
        />
      </fieldset>

      <fieldset>
        <legend>Skills and credentials</legend>
        <TagInput
          label="Skills"
          hint="Skills, tools, and software you use"
          placeholder="A skill, tool, or software"
          values={form.skills}
          onChange={(v) => update("skills", v)}
        />
        <TagInput
          label="Certifications and licenses"
          placeholder="A certification or license"
          values={form.certifications}
          onChange={(v) => update("certifications", v)}
        />
      </fieldset>

      <fieldset>
        <legend>Resume</legend>
        <div className="resume-file">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            hidden
            onChange={onResumeChosen}
          />
          {form.resumeFileName ? (
            <div className="resume-current">
              <div>
                <p className="suggestion-title">{form.resumeFileName}</p>
                <p className="company-meta">
                  {form.resumeUploadedAt ? `Uploaded ${new Date(form.resumeUploadedAt).toLocaleDateString()}` : ""}
                  {" / stored privately, only you can open it"}
                </p>
              </div>
              <div className="resume-buttons">
                <button type="button" className="secondary" disabled={fileBusy !== ""} onClick={viewResume}>
                  {fileBusy === "opening" ? "Opening..." : "View"}
                </button>
                <button type="button" className="secondary" disabled={fileBusy !== ""} onClick={() => fileInput.current?.click()}>
                  {fileBusy === "uploading" ? "Uploading..." : "Replace"}
                </button>
                <button type="button" className="ghost danger" disabled={fileBusy !== ""} onClick={removeResumeFile}>
                  {fileBusy === "removing" ? "Deleting..." : "Delete file"}
                </button>
              </div>
            </div>
          ) : (
            <div className="resume-current">
              <p className="company-meta">
                Upload a PDF or .txt resume to fill in the text below automatically. Email addresses and phone numbers are removed from the text before it's used for AI matching.
              </p>
              <button type="button" disabled={fileBusy !== ""} onClick={() => fileInput.current?.click()}>
                {fileBusy === "uploading" ? "Reading and uploading..." : "Upload resume"}
              </button>
            </div>
          )}
        </div>
        <Field
          label="Resume text"
          hint={`Paste or upload your resume. Remove references' names and contact details. ${form.resumeText.length.toLocaleString()} of ${RESUME_MAX_CHARS.toLocaleString()} characters.`}
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