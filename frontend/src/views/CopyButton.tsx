import { useEffect, useRef, useState } from "react";

/**
 * Copy a string, and say so.
 *
 * `navigator.clipboard` needs a secure context — a served canister is one, a
 * plain-http dev origin is not — so there is a fallback for the case where it
 * is missing or refused.
 */
export function CopyButton({
  value,
  label = "Copy",
  className = "btn ghost small",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A copy right before unmount would otherwise set state on a gone component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const field = document.createElement("textarea");
      field.value = value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" className={className} onClick={copy} title={value} aria-live="polite">
      {copied ? "Copied" : label}
    </button>
  );
}
