// src/app/view/[fileId]/page.tsx

'use client'; // <-- ADD THIS LINE

import dynamic from 'next/dynamic';
import { Suspense } from 'react';

// This dynamically imports our Viewer component and disables Server-Side Rendering (ssr: false)
const Viewer = dynamic(() => import('./viewer'), {
  ssr: false,
  loading: () => <div className="bg-gray-900 text-white text-center p-10">Loading Document...</div>
});

export default function FileViewerPage() {
    return (
        <Suspense fallback={<div className="bg-gray-900 text-white text-center p-10">Loading Viewer...</div>}>
            <Viewer />
        </Suspense>
    );
}