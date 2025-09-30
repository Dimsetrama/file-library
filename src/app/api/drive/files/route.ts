// src/app/api/drive/files/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  // Get pagination and search query from the request
  const pageToken = searchParams.get("pageToken") || undefined;
  const query = searchParams.get("q") || '';

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken });
    const drive = google.drive({ version: "v3", auth });

    let fileQuery = `(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation') and trashed = false`;

    // Add the user's search query for the file name
    if (query) {
      // Use "\\'" to escape single quotes in the search query
      fileQuery += ` and name contains '${query.replace(/'/g, "\\'")}'`;
    }

    const res = await drive.files.list({
      pageSize: 10, // How many files to show per page
      // Ask for the new fields: createdTime and size
      fields: "nextPageToken, files(id, name, mimeType, createdTime, size)",
      orderBy: "createdTime desc", // Order by creation time
      q: fileQuery,
      pageToken: pageToken, // Tell Google which page we're on
    });

    // The res.data already includes 'files' and 'nextPageToken'
    return NextResponse.json(res.data);
  } catch (error) {
    console.error("Error fetching Google Drive files", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}