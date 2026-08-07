import { LinkIcon } from "./LinkIcon";

const RESOURCES = [
  {
    href: "https://ntron.net",
    kind: "docs",
    label: "ntron.net",
    description: "Documentation",
  },
  {
    href: "https://github.com/infu/neutron",
    kind: "code",
    label: "github.com/infu/neutron",
    description: "Source repository",
  },
  {
    href: "https://github.com/infu/neutron/tree/main/apps/hello",
    kind: "code",
    label: "apps/hello",
    description: "Starter app",
  },
  {
    href: "https://github.com/infu/neutron/tree/main/apps/kitchensink",
    kind: "code",
    label: "apps/kitchensink",
    description: "Capabilities and tools reference",
  },
] as const;

const BUILD_STEPS = [
  {
    title: "Clone Neutron",
    body: (
      <>
        Clone the{" "}
        <a href="https://github.com/infu/neutron" target="_blank" rel="noreferrer">
          source repository
        </a>{" "}
        and open it in a workspace your coding agent can use.
      </>
    ),
  },
  {
    title: "Let the agent learn the system",
    body: (
      <>
        Ask it to get familiar with the repository before editing: read{" "}
        <code>README.md</code>, <code>doc/index.md</code>, the app-development Markdown
        it links to, and the guides inside <code>apps/hello</code> and{" "}
        <code>apps/kitchensink</code>.
      </>
    ),
  },
  {
    title: "Start Neutron locally",
    body: (
      <>
        Ask the agent to inspect the current repository scripts and local-development
        guide, start a local Neutron, and give you the browser URL. The checked-out
        repository stays the source of truth for commands.
      </>
    ),
  },
  {
    title: "Describe one app",
    body: (
      <>
        Explain your idea, the human workflow, and the agent tools you want. Tell the
        agent to create a new app from the starter and change only that app&apos;s folder;
        shared kernel and tooling stay untouched.
      </>
    ),
  },
  {
    title: "Vibe, test, repeat",
    body: (
      <>
        Use the app in your local Neutron, give concrete feedback, and iterate in small
        passes. Keep both the human interface and agent-tool behaviour clear, bounded,
        and tested.
      </>
    ),
  },
  {
    title: "Package and submit",
    body: (
      <>
        Ask the agent to follow the app&apos;s current packaging workflow and produce the
        final <code>.neutron</code> file. Then open{" "}
        <a href="#/profile/entries">Profile → Entries</a> to add its title, summary, icon,
        screenshots, links, and package.
      </>
    ),
  },
] as const;

export function Build() {
  return (
    <article className="page build-page">
      <header className="build-hero">
        <span className="eyebrow">Builder guide</span>
        <div className="build-title">
          <h1>How to build a Neutron app</h1>
          <p>In under 2 hours</p>
        </div>
        <p className="lede">
          Turn an idea into a user-owned app with an AI agent. Give the agent the
          repository, a clear boundary, and your product idea; Neutron supplies the kernel
          and permission model.
        </p>
        <div className="actions">
          <a
            className="btn"
            href="https://github.com/infu/neutron"
            target="_blank"
            rel="noreferrer"
          >
            Get the source
          </a>
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              document.getElementById("build-workflow")?.scrollIntoView({
                block: "start",
              })
            }
          >
            See the workflow
          </button>
        </div>
      </header>

      <section className="build-section" aria-labelledby="build-target">
        <div className="build-section-head">
          <span className="build-index">01 / The target</span>
          <h2 id="build-target" className="section-title">
            What you&apos;re building for
          </h2>
        </div>
        <p>
          Neutron is a user-controlled kernel for operating systems on ICP. Each user owns
          a Neutron canister and chooses the apps installed into it. A Neutron app is a{" "}
          <code>.neutron</code> package with a Motoko backend and optional frontend assets.
          AI-assisted building is the event theme; judges vote on the app you submit.
        </p>

        <div className="build-surfaces">
          <article>
            <span className="build-surface-label">For people</span>
            <h3>A clear human interface</h3>
            <p>
              Make the app understandable and useful in the browser, with visible state,
              purposeful actions, and helpful feedback.
            </p>
          </article>
          <article>
            <span className="build-surface-label">For agents</span>
            <h3>Narrow, useful tools</h3>
            <p>
              Deliberately expose well-described tools with validated inputs and predictable
              results. Agent calls still pass through Neutron&apos;s permission model.
            </p>
          </article>
        </div>
      </section>

      <section className="build-section" aria-labelledby="build-resources">
        <div className="build-section-head">
          <span className="build-index">02 / Start here</span>
          <h2 id="build-resources" className="section-title">
            Learn from the working source
          </h2>
        </div>
        <ul className="build-resources">
          {RESOURCES.map((resource) => (
            <li key={resource.href}>
              <a href={resource.href} target="_blank" rel="noreferrer">
                <LinkIcon kind={resource.kind} url={resource.href} />
                <span>
                  <strong>{resource.label}</strong>
                  <small>{resource.description}</small>
                </span>
                <span className="build-resource-arrow" aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="build-workflow"
        className="build-section build-workflow"
        aria-labelledby="build-workflow-title"
      >
        <div className="build-section-head">
          <span className="build-index">03 / Agent workflow</span>
          <h2 id="build-workflow-title" className="section-title">
            Vibe it inside a clear boundary
          </h2>
        </div>
        <p className="muted">
          You steer the product; your agent learns the current repository and handles the
          mechanics. Keep changes inside the new app folder so the shared platform remains
          stable.
        </p>
        <ol className="build-steps">
          {BUILD_STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="build-step-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="build-section" aria-labelledby="build-weeks">
        <div className="build-section-head">
          <span className="build-index">04 / Qualifiers</span>
          <h2 id="build-weeks" className="section-title">
            Four weeks, your choice
          </h2>
        </div>
        <p>
          You get one submission slot in each qualifier week. Choose a rhythm that fits
          your idea, for up to four qualifier entries across the season.
        </p>
        <div className="build-reward-note">
          <strong>Win up to 4 rewards</strong>
          <span>
            One for each distinct app that places across the four qualifier weeks.
            Re-entering the same app is paid once, for its best finish.
          </span>
        </div>
        <div className="build-options">
          <article>
            <span>01</span>
            <h3>Re-enter it</h3>
            <p>Submit the same app again in a later qualifier week.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Improve it</h3>
            <p>Change the app between weeks and submit the stronger version.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Try four ideas</h3>
            <p>Submit a different app in each of the four qualifier weeks.</p>
          </article>
        </div>
        <p className="muted small">
          You may mix these approaches. Every submission is reviewed, and your hacker role
          and reward wallet must be set before you enter.{" "}
          <a href="#/rules">Read the full submission and update rules.</a>
        </p>
      </section>

      <section className="build-submit" aria-labelledby="build-submit">
        <div>
          <span className="build-index">Ready when the package is</span>
          <h2 id="build-submit" className="section-title">
            Submit your app
          </h2>
          <p>
            Add the finished <code>.neutron</code> package and the material judges need to
            understand it.
          </p>
        </div>
        <a className="btn build-submit-button" href="#/profile/entries">
          Open Profile → Entries
        </a>
      </section>
    </article>
  );
}
