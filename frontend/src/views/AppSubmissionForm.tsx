import { useEffect, useState, type FormEvent } from "react";

import * as api from "../api";
import type { Link, SeasonEntry, User } from "../api";

type ShotDraft = {
  id: string;
  key: string | null;
  file: File | null;
};

type PackageDraft = NonNullable<api.UpdateInput["pkg"][0]>;

let draftId = 0;

function storedShot(key: string, index: number): ShotDraft {
  return { id: `stored-${index}-${key}`, key, file: null };
}

function newShot(file: File): ShotDraft {
  draftId += 1;
  return { id: `new-${draftId}`, key: null, file };
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

function normalizedLinks(links: Link[]): Link[] {
  return links
    .filter((link) => link.url.trim() !== "")
    .map((link) => ({ kind: link.kind.trim(), url: link.url.trim() }));
}

function linksEqual(left: Link[], right: Link[]): boolean {
  const a = normalizedLinks(left);
  const b = normalizedLinks(right);
  return (
    a.length === b.length &&
    a.every((link, index) => link.kind === b[index]?.kind && link.url === b[index]?.url)
  );
}

/** A local image preview whose object URL is released when it leaves the form. */
function FileImage({ file, alt = "" }: { file: File; alt?: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return src ? <img src={src} alt={alt} /> : null;
}

/**
 * The only editor for an open-week app.
 *
 * The canister stores app metadata and releases through two calls, but this is
 * deliberately one browser form. A first submission is one entry revision —
 * its mandatory package becomes version 1 when approved. Only an already
 * approved entry can also propose a changelog version.
 *
 * Proposed, not written. Both calls now go through the review queue and answer
 * with a pending revision rather than an entry, and the entry itself keeps
 * showing its last approved state until a moderator has decided. Every sentence
 * this form shows on the way out has to say so — an author who is told their
 * app is published will not come back to find out that it is not.
 */
export function AppSubmissionForm({
  user,
  entry,
  detailsEditable = true,
  pendingReview = null,
  onSaved,
}: {
  user: User;
  entry: SeasonEntry | null;
  detailsEditable?: boolean;
  /** A same-week revision already awaiting a moderator decision. */
  pendingReview?: string | null;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  /** The app's permanent id. Chosen once; the file people download is named after it. */
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [url, setUrl] = useState("");
  const [iconKey, setIconKey] = useState<string | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [shots, setShots] = useState<ShotDraft[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [version, setVersion] = useState("");
  const [note, setNote] = useState("");
  const [packageFile, setPackageFile] = useState<File | null>(null);
  // If publishing fails after an upload, retry with the uploaded key instead
  // of spending another ingress message and leaving another orphaned asset.
  const [uploadedPackage, setUploadedPackage] = useState<PackageDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setTitle(entry?.title ?? "");
    setSlug(entry?.slug ?? "");
    setSummary(entry?.summary ?? "");
    setUrl(entry?.url ?? "");
    setIconKey(entry?.icon[0] ?? null);
    setIconFile(null);
    setShots(entry?.shots.map(storedShot) ?? []);
    setLinks(entry?.links.map((link) => ({ kind: link.kind, url: link.url })) ?? []);
    setVersion("");
    setNote("");
    setPackageFile(null);
    setUploadedPackage(null);
  }, [entry]);

  const updateLink = (index: number, patch: Partial<Link>) =>
    setLinks(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));

  const addShots = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // A FileList belongs to the input and is live in some browsers. The input
    // is cleared immediately after this call so the same file can be chosen
    // again; copy its files before React runs the state updater or that updater
    // can see an already-empty list.
    const selected = Array.from(files);
    setShots((current) => {
      const room = Math.max(0, api.MAX_SHOTS - current.length);
      return [...current, ...selected.slice(0, room).map(newShot)];
    });
  };

  const isNew = entry === null;
  const wantsRelease =
    !isNew &&
    (!detailsEditable ||
      Boolean(version.trim() || note.trim() || packageFile !== null || uploadedPackage !== null));
  const detailsDirty =
    entry !== null &&
    detailsEditable &&
    (title.trim() !== entry.title ||
      slug.trim() !== entry.slug ||
      summary.trim() !== entry.summary ||
      url.trim() !== entry.url ||
      iconFile !== null ||
      iconKey !== (entry.icon[0] ?? null) ||
      shots.length !== entry.shots.length ||
      shots.some((shot, index) => shot.file !== null || shot.key !== entry.shots[index]) ||
      !linksEqual(links, entry.links));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(null);

    if (pendingReview !== null) {
      setError(`${pendingReview} Wait for that decision before submitting another revision.`);
      return;
    }

    if (wantsRelease && entry === null) {
      setError("Choose the app this version belongs to before submitting it.");
      return;
    }

    // Fail before uploading any assets. The canister repeats this check, but
    // discovering it after several image uploads wastes time and leaves files
    // the user never managed to submit.
    if (isNew && user.wallet.length === 0) {
      setError(
        "Set a reward wallet before submitting an app — there has to be somewhere to pay you.",
      );
      return;
    }

    if (wantsRelease && (!version.trim() || !note.trim())) {
      setError("A version and changelog note are both required when submitting an update.");
      return;
    }


    // Details and versions are independent moderator decisions. Enqueuing
    // both lets approval order decide which package/version survives, so the
    // browser makes the author choose one review at a time.
    if (wantsRelease && detailsDirty) {
      setError(
        "Submit one review at a time. Clear the version/package, submit these app details, " +
          "then send the version after a moderator approves the details.",
      );
      return;
    }

    // No size check on images: one too large is scaled to fit on upload
    // rather than refused, and `fitToLimit` says so precisely if it cannot.
    if (packageFile && packageFile.size > api.PACKAGE_MAX_BYTES) {
      setError(
        `${packageFile.name} is ${api.formatBytes(packageFile.size)}; packages may be at most ` +
          `${api.formatBytes(api.PACKAGE_MAX_BYTES)}.`,
      );
      return;
    }

    let appSaved = false;
    let releaseSaved = false;
    // React state set during this handler is not visible to the handler's
    // existing closure. Carry the upload locally so a combined edit/version
    // submission uses the same bytes rather than uploading the package twice.
    let packageDraft = uploadedPackage;
    try {
      if (detailsEditable && !wantsRelease) {
        let nextIcon = iconKey;
        if (iconFile) {
          setBusy("Uploading icon");
          nextIcon = await api.uploadFile(user, iconFile, "icon");
          setIconKey(nextIcon);
          setIconFile(null);
        }

        setBusy("Uploading screenshots");
        const storedShots: ShotDraft[] = [];
        for (const [index, shot] of shots.entries()) {
          const key =
            shot.key ??
            (shot.file ? await api.uploadFile(user, shot.file, "shots") : null);
          if (!key) continue;
          storedShots.push(storedShot(key, index));
          // Keep each completed upload if a later one fails, while retaining
          // the untouched files after it for a retry.
          setShots([...storedShots, ...shots.slice(index + 1)]);
        }
        const shotKeys = storedShots
          .map((shot) => shot.key)
          .filter((key): key is string => key !== null);

        // An app is a `.neutron` package — an entry without one is a
        // description of software rather than software. A new build replaces
        // whatever is there; an edit that ships nothing keeps the old one.
        let buildKey = packageDraft?.key ?? entry?.pkg[0]?.key ?? null;
        if (packageFile && !packageDraft) {
          setBusy("Uploading package");
          buildKey = await api.uploadFile(user, packageFile, "pkg");
          packageDraft = { key: buildKey };
          setUploadedPackage(packageDraft);
        }
        if (!buildKey) {
          throw new Error("An app needs a .neutron package — attach one below.");
        }

        setBusy("Submitting app");
        const icon: api.EntryInput["icon"] = nextIcon ? [nextIcon] : [];
        await api.submitEntry({
          title: title.trim(),
          summary: summary.trim(),
          url: url.trim(),
          icon,
          shots: shotKeys,
          links: normalizedLinks(links),
          pkg: { key: buildKey },
          slug: slug.trim(),
        });
        appSaved = true;
      }

      if (wantsRelease) {
        if (packageFile && !packageDraft) {
          setBusy("Uploading package");
          // Just the key. The canister names the file and reads its size —
          // neither is ours to state.
          packageDraft = { key: await api.uploadFile(user, packageFile, "pkg") };
          setUploadedPackage(packageDraft);
        }

        const pkg: api.UpdateInput["pkg"] = packageDraft ? [packageDraft] : [];
        setBusy("Submitting version");
        // `wantsRelease` cannot be true for a new entry, and the guard above
        // keeps this explicit rather than ever defaulting to the first seat.
        if (entry === null) throw new Error("Choose the app this version belongs to.");
        await api.publishUpdate(entry.id, { version: version.trim(), note: note.trim(), pkg });
        releaseSaved = true;
      }

      await onSaved();
      setVersion("");
      setNote("");
      setPackageFile(null);
      setUploadedPackage(null);
      // What was asked for, and what has not happened yet. A moderator has to
      // approve this before any of it is on the entry, and until then the entry
      // shows what it showed before — so "published" would be describing a
      // state of the world that nobody has agreed to.
      setSaved(
        !detailsEditable
          ? "Version sent for review. It joins the changelog once a moderator approves it."
          : wantsRelease
            ? "Version sent for review. It joins the changelog once a moderator approves it."
            : "App sent for review. Nothing changes on your entry until a moderator approves it.",
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        appSaved || releaseSaved
            ? `Your changes were sent for review, but this page could not refresh: ${message}`
            : message,
      );
    } finally {
      setBusy(null);
    }
  };

  const pkg = entry?.pkg[0] ?? null;
  const submitLabel = busy
    ? `${busy}…`
    : !detailsEditable
      ? "Submit version"
      : wantsRelease
        ? "Submit version"
        : entry
          ? "Submit changes"
          : "Submit app";

  return (
    <form className="form app-entry-form" onSubmit={submit} aria-busy={busy !== null}>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="notice ok" role="status">
          {saved}
        </p>
      ) : null}
      {pendingReview !== null ? (
        <p className="notice warn" role="status">
          {pendingReview} The entry keeps showing its last approved state. Wait
          for that decision before sending different details or a version, so
          reviews cannot be applied against different versions of the app.
        </p>
      ) : null}

      <fieldset className="app-form-fields" disabled={busy !== null}>
        {!detailsEditable && entry ? (
          <section
            className="app-form-section app-locked-entry"
            aria-labelledby="locked-app-heading"
          >
            <div className="app-locked-title">
              {entry.icon[0] ? <img src={entry.icon[0]} alt="" /> : null}
              <div>
                <h3 id="locked-app-heading">{entry.title}</h3>
                <p className="muted small">{entry.summary}</p>
              </div>
            </div>
            <p className="notice">
              App details are locked for this round. You can still submit a version while the
              round is open.
            </p>
          </section>
        ) : null}

        {detailsEditable ? (
          <section className="app-form-section" aria-labelledby="app-details-heading">
            <h3 id="app-details-heading">App details</h3>
            <label>
              <span>Project</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={80}
                required
                placeholder="What are you building?"
              />
            </label>
            <label>
              <span>App id</span>
              <input
                value={slug}
                /*
                  Filtered as it is typed rather than validated on submit. The
                  allowed set is small and unusual enough that a plain "invalid"
                  after the fact reads as a bug in the form; watching the
                  characters you cannot use simply not appear teaches the rule
                  in one attempt.
                */
                onChange={(event) =>
                  setSlug(event.target.value.toLowerCase().replace(/[^a-z_]/g, ""))
                }
                minLength={5}
                maxLength={40}
                required
                readOnly={Boolean(entry?.slug)}
                placeholder="tidy_notes"
              />
              <small className="muted">
                {entry?.slug
                  ? `Downloads as ${entry.slug}.neutron. Set once — it cannot be changed, because links to your build already use it.`
                  : "Lowercase letters and underscores, 5–40 characters. This names the " +
                    "file people download. A short suffix is added so two apps can " +
                    "share a name without clashing, and it cannot be changed afterwards."}
              </small>
            </label>
            <label>
              <span>Summary</span>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={600}
                rows={4}
                required
                placeholder="A few lines for the judges."
              />
              <small className="muted">{summary.length}/600</small>
            </label>
            <label>
              <span>
                Project link <em>optional</em>
              </span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                type="url"
                maxLength={256}
                placeholder="https://…"
                spellCheck={false}
              />
            </label>
          </section>
        ) : null}

        {detailsEditable ? (
          <section className="app-form-section" aria-labelledby="app-media-heading">
            <h3 id="app-media-heading">Images &amp; links</h3>

            <div className="app-icon-field">
              <span className="owner-legend">Icon</span>
              <div className="app-icon-picker">
                <div className="app-icon-preview">
                  {iconFile ? (
                    <FileImage file={iconFile} alt="New app icon preview" />
                  ) : iconKey ? (
                    <img src={iconKey} alt="Current app icon" />
                  ) : (
                    <span aria-hidden="true">
                      {title.trim().charAt(0).toUpperCase() || "+"}
                    </span>
                  )}
                </div>
                <div className="app-image-actions">
                  <label className="btn ghost small file">
                    {iconFile || iconKey ? "Change icon" : "Choose icon"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => setIconFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  {iconFile || iconKey ? (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => {
                        setIconFile(null);
                        setIconKey(null);
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                  <small className="muted">
                    Optional · up to {api.formatBytes(api.ICON_MAX_BYTES)} ·
                    larger images are scaled down
                  </small>
                </div>
              </div>
            </div>

            <div>
              <span className="owner-legend">
                Screenshots {" "}
                <em className="muted">
                  {shots.length}/{api.MAX_SHOTS}
                </em>
              </span>
              <ul className="shot-strip app-shot-strip">
                {shots.map((shot, index) => (
                  <li key={shot.id}>
                    {shot.key ? <img src={shot.key} alt="" /> : null}
                    {shot.file ? <FileImage file={shot.file} /> : null}
                    <div className="shot-controls">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => setShots(move(shots, index, index - 1))}
                        aria-label="Move screenshot left"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setShots((current) => current.filter((_, i) => i !== index))
                        }
                        aria-label="Remove screenshot"
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        disabled={index === shots.length - 1}
                        onClick={() => setShots(move(shots, index, index + 1))}
                        aria-label="Move screenshot right"
                      >
                        ›
                      </button>
                    </div>
                  </li>
                ))}
                {shots.length < api.MAX_SHOTS ? (
                  <li className="shot-add">
                    <label>
                      +
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => {
                          addShots(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </li>
                ) : null}
              </ul>
              <small className="muted">
                Optional · each up to {api.formatBytes(api.SHOT_MAX_BYTES)}, larger are
                scaled down · set the order
                with the arrows
              </small>
            </div>

            <fieldset className="links-field app-links-field">
              <legend>
                Extra links {" "}
                <em className="muted">
                  {links.length}/{api.MAX_LINKS}
                </em>
              </legend>
              {links.map((link, index) => (
                <div className="link-row" key={index}>
                  <input
                    aria-label="Link label"
                    value={link.kind}
                    placeholder="video"
                    maxLength={24}
                    onChange={(event) => updateLink(index, { kind: event.target.value })}
                  />
                  <input
                    aria-label="Link URL"
                    value={link.url}
                    type="url"
                    maxLength={256}
                    placeholder="https://youtu.be/…"
                    onChange={(event) => updateLink(index, { url: event.target.value })}
                  />
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => setLinks(links.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {links.length < api.MAX_LINKS ? (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setLinks([...links, { kind: "", url: "" }])}
                >
                  Add link
                </button>
              ) : null}
            </fieldset>
          </section>
        ) : null}

        <section className="app-form-section" aria-labelledby="app-version-heading">
          <h3 id="app-version-heading">
            {isNew ? (
              "App package"
            ) : (
              <>
                Version &amp; package{" "}
                {detailsEditable ? <em className="muted">optional</em> : null}
              </>
            )}
          </h3>
          <p className="muted small">
            {isNew
              ? "Every app includes one .neutron package. Its first approved build is recorded as version 1."
              : detailsEditable
                ? "Versions are reviewed separately from app details. Leave this blank to submit details; if details changed, submit and get those approved before sending a version."
                : "Send a changelog item for review, with an optional replacement package."}
          </p>
          {wantsRelease && detailsDirty ? (
            <p className="notice warn">
              One review at a time: clear this version/package and submit the app details
              first. You can send the version after those details are approved.
            </p>
          ) : null}
          {pkg ? (
            <p className="current-package">
              Current: <a href={pkg.key}>{pkg.name}</a> · v{pkg.version} · {api.formatBytes(pkg.size)}
            </p>
          ) : null}

          <div className={isNew ? undefined : "field-row"}>
            {!isNew ? (
              <label>
                <span>Version</span>
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  maxLength={24}
                  required={wantsRelease}
                  placeholder="0.1.0"
                  spellCheck={false}
                />
              </label>
            ) : null}
            <div className="app-package-field">
              <span className="app-field-label">
                Package {isNew ? null : <em>optional</em>}
              </span>
              <span className="file-pick">
                <label className="btn ghost small file">
                  {packageFile ? "Change file" : "Choose .neutron"}
                  <input
                    type="file"
                    accept=".neutron,application/octet-stream"
                    required={isNew}
                    onChange={(event) => {
                      setPackageFile(event.target.files?.[0] ?? null);
                      setUploadedPackage(null);
                    }}
                  />
                </label>
                {packageFile ? (
                  <>
                    <small>
                      {packageFile.name} · {api.formatBytes(packageFile.size)}
                    </small>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => {
                        setPackageFile(null);
                        setUploadedPackage(null);
                      }}
                    >
                      Clear package
                    </button>
                  </>
                ) : (
                  <small className="muted">
                    {isNew ? "Required · " : ""}up to {api.formatBytes(api.PACKAGE_MAX_BYTES)}
                  </small>
                )}
              </span>
            </div>
          </div>
          {!isNew ? (
            <label>
              <span>What changed</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                rows={3}
                required={wantsRelease}
                placeholder="What changed in this version?"
              />
              <small className="muted">{note.length}/500 · goes into the changelog</small>
            </label>
          ) : null}
        </section>

        <div className="actions app-submit-actions">
          <button className="btn" type="submit" disabled={pendingReview !== null}>
            {submitLabel}
          </button>
          <small className="muted">
            {pendingReview !== null
              ? "One moderator review at a time for this week's app."
              : detailsEditable
              ? wantsRelease
                ? "Only this version is submitted. A moderator reviews it before the package or changelog changes."
                : "A moderator reviews this before it reaches the bracket. You can change it and submit again until the qualifier week closes; existing votes stay."
              : "Once approved, a package replaces the current file and the changelog keeps the record."}
          </small>
        </div>
      </fieldset>
    </form>
  );
}
