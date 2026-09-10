import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>Không tìm thấy trang</h1>
      <p>Đường dẫn này không tồn tại trong NAU AI.</p>
      <Link className="button primary" href="/">
        Trở về trò chuyện
      </Link>
    </div>
  );
}
