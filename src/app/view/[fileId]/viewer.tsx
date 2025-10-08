'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Document, Page, pdfjs } from 'react-pdf';

// --- THE FIX: Use the single, stable CSS import path ---
import 'pdfjs-dist/web/pdf_viewer.css';

// Configure the worker from a reliable CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;

type FileMetadata = {
    id: string;
    name: string;
    mimeType: string;
};

export default function Viewer() {
    const { data: session } = useSession();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const fileId = params.fileId as string;
    const initialPage = parseInt(searchParams.get('page') || '1', 10);
    const query = searchParams.get('query') || '';

    const [metadata, setMetadata] = useState<FileMetadata | null>(null);
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [numPages, setNumPages] = useState<number>();
    const [pageNumber, setPageNumber] = useState(initialPage);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (session?.accessToken && fileId) {
            const fetchFile = async () => {
                try {
                    setIsLoading(true);
                    setError('');
                    
                    const metaResponse = await fetch(`/api/drive/metadata?fileId=${fileId}`);
                    if (!metaResponse.ok) throw new Error('Failed to fetch metadata.');
                    const metaData: FileMetadata = await metaResponse.json();
                    setMetadata(metaData);

                    if (metaData.mimeType === 'application/pdf') {
                        const fileResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                            headers: { 'Authorization': `Bearer ${session.accessToken}` }
                        });
                        if (!fileResponse.ok) throw new Error('Failed to download PDF.');
                        
                        const blob = await fileResponse.blob();
                        const url = URL.createObjectURL(blob);
                        setFileUrl(url);
                    }
                    setIsLoading(false);
                } catch (err) {
                    setError(err instanceof Error ? err.message : 'An unknown error occurred.');
                    setIsLoading(false);
                }
            };
            fetchFile();
        }
    }, [session, fileId]);

    // This function is now the definitive place to set the page number.
    function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
        setNumPages(numPages);
        // After the document is loaded, immediately jump to the correct initial page from the URL.
        setPageNumber(initialPage);
    }

    const goToPreviousPage = () => setPageNumber(prev => Math.max(1, prev - 1));
    const goToNextPage = () => setPageNumber(prev => Math.min(numPages || 0, prev + 1));

    const highlightText = useCallback((textItem: { str: string; }) => {
        if (!query || !textItem.str) return textItem.str;
        const regex = new RegExp(query, 'gi');
        // Use a trick to render HTML by returning a string
        return textItem.str.replace(regex, (match) => `<mark>${match}</mark>`);
    }, [query]);

    return (
        <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white p-8">
            <style>
                {/* Add styles for the <mark> tag used in highlighting */}
                {`
                    mark {
                        background-color: yellow;
                        color: black;
                    }
                `}
            </style>
            <div className="w-full max-w-5xl">
                <button onClick={() => router.back()} className="mb-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                    &larr; Back to Library
                </button>
                <h1 className="text-2xl font-bold mb-4">{metadata?.name}</h1>

                {isLoading && <p>Loading document...</p>}
                {error && <p className="text-red-500">Error: {error}</p>}

                {!isLoading && metadata && (
                    metadata.mimeType === 'application/pdf' && fileUrl ? (
                        <div className="flex flex-col items-center">
                            {numPages && numPages > 1 && (
                                <div className="flex items-center gap-4 mb-4">
                                    <button onClick={goToPreviousPage} disabled={pageNumber <= 1} className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50">Previous</button>
                                    <span>Page {pageNumber} of {numPages}</span>
                                    <button onClick={goToNextPage} disabled={pageNumber >= numPages} className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50">Next</button>
                                </div>
                            )}
                            <div className="border border-gray-600 rounded-md">
                                <Document file={fileUrl} onLoadSuccess={onDocumentLoadSuccess}>
                                    <Page
                                        pageNumber={pageNumber}
                                        renderTextLayer={true}
                                        renderAnnotationLayer={false}
                                        customTextRenderer={highlightText}
                                        scale={1.5}
                                    />
                                </Document>
                            </div>
                        </div>
                    ) : (
                        <div>
                            {query && (
                                <div className="bg-gray-800 p-3 rounded-t-md text-center text-sm text-gray-300">
                                    <span>To find your term, press Ctrl+F and search for: <strong className="text-yellow-400">{query}</strong></span>
                                </div>
                            )}
                            <iframe
                                src={`https://drive.google.com/file/d/${fileId}/preview`}
                                className="w-full h-[80vh] border-0 rounded-b-md"
                                allow="autoplay"
                            ></iframe>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

