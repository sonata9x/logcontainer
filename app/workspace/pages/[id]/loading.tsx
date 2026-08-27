export default function WorkspaceLogLoading() {
  return (
    <div className="workspace-content log-loading" role="status" aria-live="polite">
      <div className="loading-line loading-title" />
      <div className="loading-line loading-meta" />
      {Array.from({ length: 6 }, (_, index) => <div className="loading-entry" key={index} />)}
      <span className="sr-only">로그를 불러오는 중입니다.</span>
    </div>
  );
}
