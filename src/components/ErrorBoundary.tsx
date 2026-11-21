import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected application error occurred.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-rose-200 rounded-xl shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-700 font-semibold text-base">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              Hospital Management System — Recovery Mode
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              An unexpected operation error occurred. Your server database remains safely preserved.
            </p>
            {this.state.errorMessage && (
              <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 font-mono text-[11px] text-slate-700 break-words max-h-36 overflow-y-auto">
                {this.state.errorMessage}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
