import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

/**
 * Promise-based confirm dialog.
 *
 * Drops into the same call shape as `window.prompt` — `await ask(...)` gives
 * the note, or `null` if the user backed out — so call sites read the same
 * while losing the native dialog's blocking, unstyled, unlabelled behaviour.
 *
 *   const { ask, dialog } = useConfirm();
 *   const note = await ask({ title: "Approve @ada?", note: "optional" });
 *   if (note === null) return;   // cancelled
 *   ...
 *   return <>{dialog}</>        // render once, anywhere in the tree
 *
 * Built on `<dialog>` so modality, focus containment, Escape-to-close and the
 * inert backdrop come from the platform instead of being reimplemented.
 */

export type ConfirmRequest = {
  title: string;
  body?: string;
  confirm?: string;
  cancel?: string;
  /** Show a note field with this label. Omit for a plain confirm. */
  note?: string;
  notePlaceholder?: string;
  /** Destructive actions get a red confirm button. */
  tone?: "default" | "danger";
};

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const ask = useCallback(
    (options: ConfirmRequest) =>
      new Promise<string | null>((resolve) => {
        // A second ask while one is open would strand the first promise.
        resolver.current?.(null);
        resolver.current = resolve;
        setRequest(options);
      }),
    [],
  );

  const settle = useCallback((value: string | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(value);
  }, []);

  const dialog = request ? (
    <ConfirmDialog request={request} onSettle={settle} />
  ) : null;

  return { ask, dialog };
}

function ConfirmDialog({
  request,
  onSettle,
}: {
  request: ConfirmRequest;
  onSettle: (value: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    // showModal (not `open`) is what gives focus containment and the backdrop.
    ref.current?.showModal();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSettle(note);
  };

  const danger = request.tone === "danger";

  return (
    <dialog
      className="dialog"
      ref={ref}
      // Fires for Escape as well as an explicit close, so cancelling is
      // handled in one place.
      onClose={() => onSettle(null)}
      onCancel={() => onSettle(null)}
      onClick={(event) => {
        // Clicks land on the dialog itself only when they hit the backdrop —
        // anything inside is caught by a child.
        if (event.target === ref.current) onSettle(null);
      }}
      aria-labelledby="dialog-title"
    >
      <form className="dialog-form" onSubmit={submit}>
        <h2 id="dialog-title">{request.title}</h2>
        {request.body ? <p className="muted">{request.body}</p> : null}

        {request.note ? (
          <label>
            <span>{request.note}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder={request.notePlaceholder}
              autoFocus
            />
            <small>{note.length}/280 — recorded in the audit log.</small>
          </label>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn ghost small" onClick={() => onSettle(null)}>
            {request.cancel ?? "Cancel"}
          </button>
          <button
            type="submit"
            className={danger ? "btn small danger" : "btn small"}
            autoFocus={!request.note}
          >
            {request.confirm ?? "Confirm"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
