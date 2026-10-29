"use client";

import React, { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error | null, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(this.state.error, this.handleReset);
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          data-testid="error-boundary-fallback"
          className="flex flex-col items-center justify-center min-h-[200px] p-6 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
        >
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h3
            data-testid="error-boundary-title"
            className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2"
          >
            Something went wrong
          </h3>
          <p
            data-testid="error-boundary-message"
            className="text-sm text-red-600 dark:text-red-400 mb-4 text-center max-w-md"
          >
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            data-testid="error-boundary-reset-btn"
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Functional wrapper for easier use
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode | ((error: Error | null, reset: () => void) => ReactNode),
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

// Chat-specific error boundary
export function ChatErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div
          role="alert"
          data-testid="chat-error-boundary-fallback"
          className="flex flex-col items-center justify-center h-full p-6"
        >
          <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
            Chat encountered an error
          </p>
          <button
            type="button"
            data-testid="chat-error-boundary-reload-btn"
            onClick={() => window.location.reload()}
            className="text-sm accent-text hover:underline"
          >
            Refresh page
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

// Map-specific error boundary
export function MapErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div
          role="alert"
          data-testid="map-error-boundary-fallback"
          className="flex flex-col items-center justify-center h-full bg-zinc-100 dark:bg-zinc-900 rounded-lg p-6"
        >
          <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
            Map failed to load
          </p>
          <p className="text-xs text-zinc-500 mb-3">
            Check your internet connection
          </p>
          <button
            type="button"
            data-testid="map-error-boundary-reload-btn"
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm accent-bg text-white rounded-lg accent-bg-hover"
          >
            <RefreshCw className="w-3 h-3" />
            Reload
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
