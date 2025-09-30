// src/components/AuthButton.tsx

'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import Image from 'next/image';

export default function AuthButton() {
  const { data: session } = useSession();

  if (session) {
    return (
      <div className="flex items-center gap-4">
        <p>{session.user?.name}</p>
        {session.user?.image && (
          <Image
            src={session.user.image}
            alt={session.user.name ?? 'User avatar'}
            width={32}
            height={32}
            className="rounded-full"
          />
        )}
        <button
          onClick={() => signOut()}
          className="px-4 py-2 font-semibold text-white bg-red-500 rounded-md hover:bg-red-600"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn('google')}
      className="px-4 py-2 font-semibold text-white bg-blue-500 rounded-md hover:bg-blue-600"
    >
      Sign in with Google
    </button>
  );
}