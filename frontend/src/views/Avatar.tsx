import * as api from "../api";
import type { User } from "../api";

/**
 * Avatar keys are asset paths in this same canister, so they are plain
 * same-origin URLs — no gateway or agent involved.
 */
/** Everything Avatar reads. Entry views carry an identity but are not Users. */
export type Face = Pick<User, "avatar" | "displayName" | "handle">;

export function Avatar({ user, size = 40 }: { user: Face; size?: number }) {
  const url = api.avatarUrl(user);
  const style = { width: size, height: size, fontSize: Math.round(size / 2.4) };

  if (url) {
    return (
      <img
        className="avatar"
        style={style}
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
      />
    );
  }

  const initial = (user.displayName || user.handle).trim().charAt(0).toUpperCase();
  return (
    <span className="avatar placeholder" style={style} aria-hidden="true">
      {initial || "?"}
    </span>
  );
}
