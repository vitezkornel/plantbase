import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './global.css';

export const metadata: Metadata = {
  title: 'Plantbase',
  description: 'Kérdezz a Plantbase növénykatalógusról.',
};

// resizes-content: on Android the keyboard shrinks the layout, so the
// composer pinned to the bottom stays visible (iOS Safari ignores it and
// scrolls the focused input into view itself). cover: makes the
// env(safe-area-inset-*) values non-zero for the iPhone home indicator.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
