// src/app/api/drive/build-index/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from 'googleapis';

// Dynamic imports to avoid webpack bundling issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfParse: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mammoth: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let JSZip: any;

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

type SearchIndex = {
    [fileId: string]: {
        name: string;
        pages: { pageNumber: number; content: string }[];
    };
};

export async function POST() {
    console.log('=== BUILD INDEX STARTED ===');
    
    const session = await getServerSession(authOptions);
    
    if (!session || !session.accessToken) {
        console.error('Unauthorized: No session or access token');
        return new NextResponse(JSON.stringify({ message: "Unauthorized" }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    console.log('Session authenticated, loading libraries...');

    // Load libraries dynamically to avoid webpack issues
    try {
        pdfParse = (await import('pdf-parse')).default;
        mammoth = await import('mammoth');
        JSZip = (await import('jszip')).default;
        console.log('Libraries loaded successfully');
    } catch (err) {
        console.error('Failed to load libraries:', err);
        return new NextResponse(JSON.stringify({ 
            message: "Failed to load required libraries" 
        }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
        async start(controller) {
            try {
                console.log('Stream started, initializing Google Drive API...');
                
                const auth = new google.auth.OAuth2();
                auth.setCredentials({ access_token: session.accessToken });
                const drive = google.drive({ version: "v3", auth });

                console.log('Google Drive API initialized');

                // Search for files to index
                const searchQuery = `(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation') and trashed = false`;
                
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'searching', message: 'Searching for files...' })}\n\n`));
                console.log('Sent: Searching for files...');

                const filesResponse = await drive.files.list({
                    q: searchQuery,
                    fields: 'files(id, name, mimeType)',
                    pageSize: 1000
                });

                console.log(`Files response received: ${filesResponse.data.files?.length || 0} files`);

                const filesToIndex = (filesResponse.data.files || []).filter(
                    (file) => file.id && file.name && file.mimeType
                );

                const totalFiles = filesToIndex.length;
                
                console.log(`Total files to index: ${totalFiles}`);
                
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                    status: 'processing', 
                    message: `Found ${totalFiles} files to process`,
                    total: totalFiles,
                    current: 0
                })}\n\n`));

                const searchIndex: SearchIndex = {};
                let processed = 0;

                // Process files
                for (const file of filesToIndex) {
                    try {
                        console.log(`Processing file ${processed + 1}/${totalFiles}: ${file.name}`);
                        
                        const fileResponse = await drive.files.get(
                            { fileId: file.id!, alt: 'media' },
                            { responseType: 'arraybuffer' }
                        );

                        const buffer = Buffer.from(fileResponse.data as ArrayBuffer);
                        const pages: { pageNumber: number; content: string }[] = [];

                        if (file.mimeType === 'application/pdf') {
                            console.log(`  - Processing PDF: ${file.name}`);
                            const options = {
                                pagerender: (pageData: { getTextContent: () => Promise<{ items: { str: string }[] }> }) => {
                                    return pageData.getTextContent().then((textContent) => {
                                        return textContent.items.map((item) => item.str).join(' ');
                                    }).then((text) => text + '\n<--PAGE_BREAK-->\n');
                                }
                            };

                            const data = await pdfParse(buffer, options);
                            const pageTexts = data.text.split('<--PAGE_BREAK-->').filter((text: string) => text.trim().length > 0);
                            
                            pageTexts.forEach((text: string, index: number) => {
                                pages.push({ pageNumber: index + 1, content: text });
                            });
                            
                            console.log(`  - Extracted ${pages.length} pages`);

                        } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                            console.log(`  - Processing DOCX: ${file.name}`);
                            const docxResult = await mammoth.extractRawText({ buffer });
                            pages.push({ pageNumber: 1, content: docxResult.value });
                            console.log(`  - Extracted text length: ${docxResult.value.length}`);

                        } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
                            console.log(`  - Processing PPTX: ${file.name}`);
                            const zip = await JSZip.loadAsync(buffer);
                            const slideFiles = Object.keys(zip.files).filter(f => 
                                f.startsWith("ppt/slides/") && f.endsWith(".xml")
                            );

                            let fullText = "";
                            for (const slideFile of slideFiles) {
                                const content = await zip.files[slideFile].async("string");
                                const textNodes = content.match(/>(.*?)</g) || [];
                                fullText += textNodes.map((node: string) => node.replace(/[><]/g, "")).join(" ");
                            }
                            pages.push({ pageNumber: 1, content: fullText });
                            console.log(`  - Extracted ${slideFiles.length} slides`);
                        }

                        if (pages.length > 0) {
                            searchIndex[file.id!] = { name: file.name!, pages };
                        }

                        processed++;
                        
                        // Send progress update
                        const percentage = Math.round((processed / totalFiles) * 100);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            status: 'processing',
                            message: `Processing file ${processed}/${totalFiles} (${percentage}%)`,
                            total: totalFiles,
                            current: processed,
                            percentage
                        })}\n\n`));

                    } catch (processError) {
                        console.error(`ERROR processing file ${file.name}:`, processError);
                        processed++;
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            status: 'processing',
                            message: `Skipped ${file.name} (error)`,
                            total: totalFiles,
                            current: processed
                        })}\n\n`));
                    }
                }

                // Save index to Google Drive
                console.log('All files processed, saving to Google Drive...');
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                    status: 'saving', 
                    message: 'Saving index to Google Drive...'
                })}\n\n`));

                const indexContent = JSON.stringify(searchIndex);
                const now = new Date().toISOString();

                console.log(`Index size: ${indexContent.length} bytes`);

                const searchRes = await drive.files.list({
                    q: `name='search_index.json' and trashed = false`,
                    fields: 'files(id)'
                });

                const existingFileId = searchRes.data.files?.[0]?.id;
                console.log(`Existing index file ID: ${existingFileId || 'none'}`);

                const media = {
                    mimeType: 'application/json',
                    body: indexContent
                };

                const requestBody = {
                    name: 'search_index.json',
                    description: now
                };

                if (existingFileId) {
                    console.log('Updating existing index file...');
                    await drive.files.update({
                        fileId: existingFileId,
                        requestBody: { description: now },
                        media
                    });
                } else {
                    console.log('Creating new index file...');
                    await drive.files.create({
                        requestBody,
                        media
                    });
                }

                console.log('Index saved successfully!');

                // Send completion
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                    status: 'complete',
                    message: `Index build complete! Successfully indexed ${Object.keys(searchIndex).length} files.`,
                    filesProcessed: Object.keys(searchIndex).length
                })}\n\n`));

                console.log('=== BUILD INDEX COMPLETED ===');
                controller.close();

            } catch (error) {
                console.error("=== FATAL ERROR IN BUILD INDEX ===");
                console.error("Error type:", error instanceof Error ? error.constructor.name : typeof error);
                console.error("Error message:", error instanceof Error ? error.message : String(error));
                console.error("Error stack:", error instanceof Error ? error.stack : 'No stack trace');
                
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                    status: 'error',
                    message: error instanceof Error ? error.message : 'Unknown error occurred'
                })}\n\n`));
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}