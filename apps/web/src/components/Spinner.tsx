// Adapted from Craft Agents LoadingIndicator.tsx at 1627c43e.
// Copyright 2026 Craft Docs Ltd. Apache-2.0. Removed i18next/cn dependency.
export function Spinner() {
  return (
    <span className="spinner" role="status" aria-label="加载中">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="spinner-cube" />
      ))}
    </span>
  );
}
