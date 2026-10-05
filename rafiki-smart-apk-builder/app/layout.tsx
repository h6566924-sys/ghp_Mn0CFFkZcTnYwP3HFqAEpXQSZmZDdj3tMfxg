import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'محرك رفيقي الذكي لبناء APK',
  description: 'محرك بناء Android حقيقي عبر GitHub Actions',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
