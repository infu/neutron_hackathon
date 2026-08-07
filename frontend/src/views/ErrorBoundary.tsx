import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The last thing between a render that throws and a blank document.
 *
 * React's response to an uncaught error in render is to unmount the tree it
 * was in, and at the root that is the entire page — white, wordless, with no
 * navigation left to leave by and nothing on screen that anybody could report.
 * A boundary is what turns that into a sentence.
 *
 * Worth having here in particular because not all of the page comes from us. A
 * sponsor may name any canister as an ICRC-1 ledger, and what that canister
 * answers is drawn on the page and calculated with; `tokens.ts` holds the
 * figures it publishes to a range that can be drawn, but that is one boundary
 * guarding one known hazard, and this is the floor under all of them.
 *
 * Reload rather than a bare "try again": clearing this state alone would
 * re-render the same tree from the same data, which is the render that has
 * just failed. Only a different route or a fresh page is a different attempt.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // The console is the only place this can go — there is no error sink to
    // report to, and the component stack is the one part that says *where*,
    // which React hands over here and nowhere else.
    console.error("Render failed", error, info.componentStack);
  }

  // Routing is a hashchange listener inside the app, and the app is what just
  // went away — so without this, the browser's own Back button would appear to
  // do nothing and the site would read as dead until somebody reloaded it. Any
  // route that can be drawn now draws; the one that cannot lands back here.
  componentDidMount() {
    window.addEventListener("hashchange", this.retry);
  }

  componentWillUnmount() {
    window.removeEventListener("hashchange", this.retry);
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app">
        <main className="main">
          <section className="page crashed">
            <h1>This page stopped.</h1>
            <p className="muted">
              Something threw while it was being drawn. React takes the whole
              view down when that happens rather than leaving half of it on
              screen, which is why there is nothing else here. Reloading
              usually gets you back; if the same page keeps stopping, the cause
              is on that page rather than in passing.
            </p>

            {/* The message verbatim: it is frequently the only thing that
                distinguishes one of these from another, and somebody reporting
                this has nothing else to quote. */}
            <p className="notice error" role="alert">
              {error.message || String(error)}
            </p>

            <div className="actions">
              <button className="btn" onClick={() => window.location.reload()}>
                Reload
              </button>
              {/* Reloaded onto the new route rather than left to `retry`,
                  which would not fire when the crash happened on `#/` already:
                  setting a hash to what it is is not a change. */}
              <button
                className="btn ghost"
                onClick={() => {
                  window.location.hash = "#/";
                  window.location.reload();
                }}
              >
                Back to the start
              </button>
            </div>

            <small className="muted">
              Anything typed into a form on this page is gone, but nothing
              already sent to the canister is affected by this.
            </small>
          </section>
        </main>
      </div>
    );
  }
}
