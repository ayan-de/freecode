import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import "./App.css";

// ---------------------------------------------------------------------------
// Viewport height, measured rather than declared.
//
// `100vh` is unreliable on mobile. Android WebView pins vh units to the
// initial containing block from the document's first layout — load into a
// not-yet-measured view and every 100vh is 0 forever, even once
// innerHeight reports the real height. iOS Safari has its own version of
// this with the collapsing URL bar.
//
// innerHeight is always correct, so publish it as --app-h and let the
// layout use that. Keeps the app upright regardless of when the host
// decides to size us.
// ---------------------------------------------------------------------------
function trackViewportHeight(): void {
  const apply = () =>
    document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  // A WebView measured after load fires resize, but not on every device —
  // visualViewport is the more reliable signal where it exists.
  window.visualViewport?.addEventListener("resize", apply);
}
trackViewportHeight();

const container = document.getElementById("root");
if (container) {
  const root: Root = createRoot(container);
  root.render(React.createElement(App));
}
