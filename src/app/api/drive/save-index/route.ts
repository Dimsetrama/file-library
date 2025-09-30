// src/app/api/drive/save-index/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const indexContent = await req.json();
        const indexString = JSON.stringify(indexContent);

        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth });

        // Find and delete the old index file if it exists
        const appDataFiles = await drive.files.list({
            spaces: 'appDataFolder',
            fields: 'files(id, name)',
        });
        const oldIndex = appDataFiles.data.files?.find(file => file.name === 'search_index.json');
        if (oldIndex && oldIndex.id) {
            await drive.files.delete({ fileId: oldIndex.id });
        }

        // Upload the new search index
        await drive.files.create({
            requestBody: {
                name: 'search_index.json',
                parents: ['appDataFolder']
            },
            media: {
                mimeType: 'application/json',
                body: indexString,
            },
            fields: 'id',
        });

        return NextResponse.json({ message: `Successfully saved index.` });
    } catch (error) {
        console.error("Error saving search index:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}