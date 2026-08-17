import React, { useState, useEffect } from "react";

class RenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("RenderErrorBoundary caught:", error, info);
  }
  render() {
    if (this.state.error) return <ErrorScreen error={this.state.error} />;
    return this.props.children;
  }
}

function ErrorScreen({ error }) {
  return (
    <div style={{ minHeight: "100vh", background: "#fef2f2", padding: 16, fontFamily: "monospace" }}>
      <h1 style={{ color: "#b91c1c", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
        Terjadi Error pada Aplikasi
      </h1>
      <p style={{ fontSize: 13, color: "#7f1d1d", marginBottom: 12 }}>
        Silakan screenshot seluruh teks di bawah ini dan kirimkan untuk diperbaiki.
      </p>
      <pre style={{
        whiteSpace: "pre-wrap", wordBreak: "break-word", background: "white",
        border: "2px solid #fca5a5", borderRadius: 8, padding: 12, fontSize: 12, color: "#1c1917",
      }}>
        {String(error?.stack || error?.message || error)}
      </pre>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 16, width: "100%", padding: "12px", borderRadius: 8,
          background: "#b91c1c", color: "white", fontWeight: 700, border: "none",
        }}
      >
        Muat Ulang Halaman
      </button>
    </div>
  );
}

function GlobalErrorCatcher({ children }) {
  const [error, setError] = useState(null);
  useEffect(() => {
    const onError = (e) => setError(e.error || new Error(e.message));
    const onRejection = (e) => setError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  if (error) return <ErrorScreen error={error} />;
  return children;
}

export default function ErrorBoundary({ children }) {
  return (
    <GlobalErrorCatcher>
      <RenderErrorBoundary>{children}</RenderErrorBoundary>
    </GlobalErrorCatcher>
  );
}
