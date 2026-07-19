import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  /**
   * Clears the error when it changes. Without this a single bad model would
   * keep its fallback showing for every subsequent, unrelated reveal.
   */
  resetKey?: unknown;
  label?: string;
}

interface State {
  failed: boolean;
}

/**
 * Suspense handles a pending promise; it does not handle a rejected one. A
 * 404 or corrupt GLB therefore threw straight past the Suspense boundary and
 * took the whole app down with it — on the screen shown immediately after a
 * successful catch.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label ?? "boundary"}] render failed:`, error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
