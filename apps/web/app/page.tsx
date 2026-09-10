import { Suspense } from 'react';
import { Shell } from '../components/shell';
import { Chat } from '../components/chat';
export default function Home() {
  return (
    <Shell>
      <Suspense fallback={<div className="loading-state">Đang mở cuộc trò chuyện…</div>}>
        <Chat />
      </Suspense>
    </Shell>
  );
}
