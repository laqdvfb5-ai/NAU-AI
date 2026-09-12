import type { Metadata } from 'next';
import '@fontsource-variable/lora/wght-italic.css';
import './globals.css';
import { AppProvider } from '../components/app-provider';
export const metadata: Metadata = {
  title: 'NAU AI — Đồng hành cùng sinh viên',
  description: 'Trợ lý tư vấn sinh viên Trường Đại học Nghệ An. Bản thử nghiệm với dữ liệu giả.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
