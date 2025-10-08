import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

type SearchIndex = {
    [fileId: string]: {
        name: string;
        pages: { pageNumber: number, content: string }[];
    }
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q')?.toLowerCase();
    const page = parseInt(searchParams.get('page') || '1', 10);
    const resultsPerPage = 10;

    if (!query) {
        return new NextResponse("Missing search query", { status: 400 });
    }

    try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth });

        const listRes = await drive.files.list({
            q: "name='search_index.json' and trashed = false",
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        
        const indexFile = listRes.data.files?.[0];

        if (!indexFile || !indexFile.id) {
            return new NextResponse("Search index not found.", { status: 404 });
        }

        const fileRes = await drive.files.get({ fileId: indexFile.id, alt: 'media' });
        const searchIndex: SearchIndex = fileRes.data as SearchIndex;

        // --- THE FIX: Find ALL matches, not just the first one ---
        const allResults: { id: string; name: string; snippet: string; pageNumber: number; }[] = [];

        for (const fileId in searchIndex) {
            const fileData = searchIndex[fileId];
            // Iterate through each page within the file
            for (const pageData of fileData.pages) {
                const contentLower = pageData.content.toLowerCase();
                // If a match is found on this page...
                if (contentLower.includes(query)) {
                    // Create a snippet
                    const index = contentLower.indexOf(query);
                    const start = Math.max(0, index - 50);
                    const end = Math.min(contentLower.length, index + 50);
                    const snippet = `...${pageData.content.substring(start, end)}...`;

                    // ...add a result for EACH page that has a match
                    allResults.push({
                        id: fileId,
                        name: fileData.name,
                        snippet: snippet,
                        pageNumber: pageData.pageNumber
                    });

                    // We have REMOVED the 'break' statement.
                }
            }
        }
        
        const totalPages = Math.ceil(allResults.length / resultsPerPage);
        const startIndex = (page - 1) * resultsPerPage;
        const paginatedResults = allResults.slice(startIndex, startIndex + resultsPerPage);

        return NextResponse.json({
            results: paginatedResults,
            totalPages: totalPages,
            currentPage: page
        });

    } catch (error) {
        console.error("Error during search:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}