import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./views/ErrorBoundary";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// Outside `App` rather than in it: a boundary cannot catch what its own render
// throws, so the one that has to survive everything sits above the tree it is
// guarding.
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
