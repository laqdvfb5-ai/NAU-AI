import { Suspense } from 'react';
import { Chat } from '../../components/chat';
import { Brand } from '../../components/shell';
export default function Embed() {
  return (
    <div className="embed-shell">
      <header>
        <Brand compact />
        <a href="/" target="_blank" rel="noreferrer">
          Mở website ↗
        </a>
      </header>
      <Suspense>
        <Chat embed />
      </Suspense>
    </div>
  );
}
