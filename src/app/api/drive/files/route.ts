// src/app/api/drive/files/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pageToken = searchParams.get("pageToken") || undefined;
    const userSearchQuery = searchParams.get("q") || '';

    try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth });

        // Base query to find all relevant, non-trashed files
        const baseQuery = `(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation') and trashed = false`;
        
        // Add the user's search query if it exists
        const finalQuery = userSearchQuery 
            ? `${baseQuery} and name contains '${userSearchQuery.replace(/'/g, "\\'")}'` 
            : baseQuery;

        const pageSize = 10; // Explicitly set the number of files per page

        const res = await drive.files.list({
            pageSize: pageSize,
            pageToken: pageToken,
            q: finalQuery,
            orderBy: "createdTime desc", // Sort by newest files first
            // Ensure we ask for nextPageToken and all the fields we need
            fields: "nextPageToken, files(id, name, mimeType, createdTime, size, webViewLink)",
        });

        // --- ADD THIS LOGGING LINE ---
    console.log("--- GOOGLE API RESPONSE ---", res.data);

        // Return the files AND the token for the next page
        return NextResponse.json({
            files: res.data.files || [],
            nextPageToken: res.data.nextPageToken || null,
        });

    } catch (error) {
        console.error("Error fetching files:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}