/**
 * P007 FocusWitness — Client Entry Point
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./app.css";

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("missing #root element for FocusWitness mounting");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
