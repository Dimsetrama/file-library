// src/app/api/search/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
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
        
        // DEBUG LOG: Let's see if the index is structured correctly
        console.log("--- Loaded Search Index ---");
        // console.log(searchIndex); // This might be too long, let's log keys instead
        console.log("Indexed File IDs:", Object.keys(searchIndex));
        console.log("--------------------------");


        const results: { id: string, name: string, snippet: string, pageNumber: number }[] = [];
        console.log(`\nSearching for: "${query}"`);
        for (const fileId in searchIndex) {
            const file = searchIndex[fileId];

            if (!Array.isArray(file.pages) || file.pages.length === 0) {
                continue;
            }

            if (file.name.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                    id: fileId, name: file.name,
                    pageNumber: 1, snippet: createSnippet(file.pages[0]?.content || "", query),
                });
                continue;
            }
            for (const page of file.pages) {
                // DEBUG LOG: Check the content of each page
                // console.log(`Checking Page ${page.pageNumber} of ${file.name}`);
                if (page.content.toLowerCase().includes(query.toLowerCase())) {
                    console.log(`   ---> Found a match in ${file.name} on page ${page.pageNumber}!`);
                    results.push({
                        id: fileId, name: file.name,
                        pageNumber: page.pageNumber, snippet: createSnippet(page.content, query),
                    });
                    break; 
                }
            }
        }
        
        console.log(`Search complete. Found ${results.length} results.`);
        return NextResponse.json({ results });
    } catch (error) {
        console.error("Error during search:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}