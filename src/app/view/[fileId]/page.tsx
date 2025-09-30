// src/app/view/[fileId]/page.tsx

'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;

function PDFViewer() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileId = params.fileId as string;
  const initialPage = parseInt(searchParams.get('page') || '1', 10);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session?.accessToken && fileId) {
      const fetchAndRenderPdf = async () => {
        try {
          setIsLoading(true);
          setError('');
          const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
          });
          if (!response.ok) throw new Error('Failed to download file.');
          const arrayBuffer = await response.arrayBuffer();
          const doc = await pdfjs.getDocument(arrayBuffer).promise;
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
          setIsLoading(false);
        } catch (err: unknown) {
          if (err instanceof Error) { setError(err.message); } 
          else { setError('An unknown error occurred.'); }
          setIsLoading(false);
        }
      };
      fetchAndRenderPdf();
    }
  }, [session, fileId]);

  useEffect(() => {
    if (pdfDoc) {
      const validPageNumber = Math.max(1, Math.min(pageNumber, pdfDoc.numPages));
      pdfDoc.getPage(validPageNumber).then(page => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        const context = canvas.getContext('2d');
        if (context) { page.render({ canvasContext: context, viewport }); }
      });
    }
  }, [pdfDoc, pageNumber]);

  const goToPreviousPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber(prev => Math.min(totalPages, prev + 1));

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white p-4">
      <div className="w-full max-w-4xl">
        <button onClick={() => router.back()} className="mb-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
          &larr; Back to Library
        </button>
        {isLoading && <p>Loading document...</p>}
        {error && <p className="text-red-500">Error: {error}</p>}
        {pdfDoc && (
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-4 mb-4">
              <button onClick={goToPreviousPage} disabled={pageNumber <= 1} className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50">
                Previous
              </button>
              <span>Page {pageNumber} of {totalPages}</span>
              <button onClick={goToNextPage} disabled={pageNumber >= totalPages} className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50">
                Next
              </button>
            </div>
            <canvas ref={canvasRef} className="border border-gray-600 rounded-md" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function FileViewerPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <PDFViewer />
        </Suspense>
    );
}