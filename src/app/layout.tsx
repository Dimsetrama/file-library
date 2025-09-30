// src/app/layout.tsx

import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Providers from './providers'; // <-- IMPORT

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'File Library',
  description: 'Your personal file library',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers> {/* <-- WRAP HERE */}
          {children}
        </Providers>
      </body>
    </html>
  );
}