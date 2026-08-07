import { useEffect, useState } from "react";

import * as api from "../api";
import type { PublicUser } from "../api";
import { Avatar } from "./Avatar";
import { LinkIcon } from "./LinkIcon";

export function PublicProfile({ handle }: { handle: string }) {
  const [user, setUser] = useState<PublicUser | null | "loading">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUser("loading");
    api
      .getProfile(handle)
      .then(setUser)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setUser(null);
      });
  }, [handle]);

  if (user === "loading") return <p className="muted">Loading…</p>;

  if (!user) {
    return (
      <section className="page">
        <h1>Not found</h1>
        {error ? (
          <p className="notice error">{error}</p>
        ) : (
          <p className="muted">No profile with the handle @{handle}.</p>
        )}
        <div className="actions">
          <a className="btn ghost" href="#/people">
            Back to people
          </a>
        </div>
      </section>
    );
  }

  const title = api.title(user);

  return (
    <section className="page profile">
      <header className="profile-head">
        <Avatar user={user} size={88} />
        <div className="profile-id">
          <h1>
            {user.displayName || user.handle}
            {api.isJudge(user) ? <span className="badge">judge</span> : null}
          </h1>
          {title ? <p className="profile-title">{title}</p> : null}
          <p className="muted">@{user.handle}</p>
        </div>
      </header>

      {user.bio ? <p className="profile-bio">{user.bio}</p> : null}

      {user.links.length > 0 ? (
        <ul className="link-list">
          {user.links.map((link, index) => (
            <li key={index}>
              <a href={link.url} target="_blank" rel="noreferrer noopener">
                <LinkIcon kind={link.kind} url={link.url} />
                <span>{link.kind || link.url}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="meta">
        <div>
          <dt>Registered</dt>
          <dd>
            {new Date(Number(user.createdAt / BigInt(1_000_000))).toLocaleDateString()}
          </dd>
        </div>
      </dl>
    </section>
  );
}
