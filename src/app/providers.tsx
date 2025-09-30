// src/app/providers.tsx

'use client';

import { SessionProvider } from 'next-auth/react';

export default function Providers({ children }: { children: React.ReactNode }) {
  // Add the refetchOnWindowFocus prop here
  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>;
}