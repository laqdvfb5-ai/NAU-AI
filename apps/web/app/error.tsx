'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h2>Trang chưa tải được</h2>
      <p>Hãy thử tải lại. Nếu lỗi tiếp diễn, kiểm tra dịch vụ API.</p>
      <button className="button primary" onClick={reset}>
        Thử lại
      </button>
    </div>
  );
}
