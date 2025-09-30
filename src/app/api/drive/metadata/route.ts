// src/app/api/drive/metadata/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("fileId");

    if (!fileId) {
        return new NextResponse("Missing fileId", { status: 400 });
    }

    try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const drive = google.drive({ version: "v3", auth });

        const file = await drive.files.get({
            fileId: fileId,
            fields: 'id, name, mimeType',
        });

        return NextResponse.json(file.data);
    } catch (error) {
        console.error("Error fetching file metadata:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}