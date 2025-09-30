// src/app/api/search/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

type IndexEntry = { name: string, pages: { pageNumber: number, content: string }[] };

function createSnippet(content: string, query: string): string {
    const queryIndex = content.toLowerCase().indexOf(query.toLowerCase());
    if (queryIndex === -1) return "";
    const start = Math.max(0, queryIndex - 30);
    const end = Math.min(content.length, queryIndex + query.length + 30);
    return `...${content.substring(start, end)}...`;
}

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse("Unauthorized", { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");
    // ADDED: Get the requested page number
    const page = parseInt(searchParams.get("page") || '1', 10);
    if (!query) {
        return new NextResponse("Query parameter 'q' is required", { status: 400 });
    }

    try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth });

        const listRes = await drive.files.list({
            spaces: 'appDataFolder', fields: 'files(id, name)',
        });
        const indexFile = listRes.data.files?.find(file => file.name === 'search_index.json');
        if (!indexFile?.id) {
            return new NextResponse("Search index not found. Please build it first.", { status: 404 });
        }

        const fileRes = await drive.files.get({ fileId: indexFile.id, alt: 'media' });
        const searchIndex = fileRes.data as { [fileId: string]: IndexEntry };

        const allResults: { id: string, name: string, snippet: string, pageNumber: number }[] = [];
        for (const fileId in searchIndex) {
            const file = searchIndex[fileId];
            if (!Array.isArray(file.pages) || file.pages.length === 0) {
                continue;
            }
            if (file.name.toLowerCase().includes(query.toLowerCase())) {
                allResults.push({
                    id: fileId, name: file.name,
                    pageNumber: 1, snippet: createSnippet(file.pages[0]?.content || "", query),
                });
                continue;
            }
            for (const page of file.pages) {
                if (page.content.toLowerCase().includes(query.toLowerCase())) {
                    allResults.push({
                        id: fileId, name: file.name,
                        pageNumber: page.pageNumber, snippet: createSnippet(page.content, query),
                    });
                    break; 
                }
            }
        }
        
        // ADDED: Pagination logic
        const itemsPerPage = 10;
        const totalPages = Math.ceil(allResults.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedResults = allResults.slice(startIndex, endIndex);

        return NextResponse.json({ results: paginatedResults, totalPages: totalPages });
    } catch (error) {
        console.error("Error during search:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}