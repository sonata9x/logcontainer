export default function WorkspaceLogLoading() {
  return (
    <div className="workspace-content log-loading" role="status" aria-live="polite">
      <p className="loading-label">로그 불러오는 중…</p>
      <div className="loading-line loading-title" />
      <div className="loading-line loading-meta" />
      {Array.from({ length: 6 }, (_, index) => <div className="loading-entry" key={index} />)}
    </div>
  );
}
