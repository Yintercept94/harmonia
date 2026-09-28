import { Component, StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

/**
 * Without this, any render error unmounts the tree and leaves a white page with
 * nothing to go on — which is exactly how the score's rendering bugs presented.
 */
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="mx-auto max-w-[680px] px-6 py-16">
        <h1 className="text-[1.6rem]">Something in this page failed to render.</h1>
        <p className="mt-3 text-[0.92rem] text-[var(--ink-soft)]">
          Please report the message below — it says which browser feature gave out.
        </p>
        <pre className="mt-4 overflow-auto rounded-[3px] border border-[var(--rule)] bg-[var(--paper-2)] p-4 font-[var(--mono)] text-[0.78rem]">
          {this.state.err.message}
          {"\n\n"}
          {this.state.err.stack}
        </pre>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
