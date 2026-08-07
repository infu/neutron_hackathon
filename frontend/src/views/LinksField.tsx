import type { Link } from "../api";

/**
 * The links editor, shared by the signup wizard and the profile form.
 *
 * A link is a label and a URL — the label is free text because the icon that
 * gets drawn beside it is matched from the URL, not from a fixed list.
 */
const MAX_LINKS = 8;

export function LinksField({
  links,
  disabled = false,
  onChange,
}: {
  links: Link[];
  disabled?: boolean;
  onChange: (links: Link[]) => void;
}) {
  const update = (index: number, patch: Partial<Link>) =>
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));

  return (
    <fieldset className="links-field">
      <legend>
        Links <em className="muted">optional</em>
      </legend>

      {links.map((link, index) => (
        <div className="link-row" key={index}>
          <input
            aria-label="Link label"
            value={link.kind}
            placeholder="github"
            maxLength={24}
            disabled={disabled}
            onChange={(event) => update(index, { kind: event.target.value })}
          />
          <input
            aria-label="Link URL"
            value={link.url}
            placeholder="https://github.com/ada"
            type="url"
            disabled={disabled}
            onChange={(event) => update(index, { url: event.target.value })}
          />
          <button
            type="button"
            className="btn ghost small"
            disabled={disabled}
            onClick={() => onChange(links.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}

      {links.length < MAX_LINKS ? (
        <button
          type="button"
          className="btn ghost small"
          disabled={disabled}
          onClick={() => onChange([...links, { kind: "", url: "" }])}
        >
          Add link
        </button>
      ) : null}
    </fieldset>
  );
}
