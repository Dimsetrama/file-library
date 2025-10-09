import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

const INDEX_FILE_NAME = 'search_index.json';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken });
    const drive = google.drive({ version: "v3", auth });

    const searchRes = await drive.files.list({
      q: `name='${INDEX_FILE_NAME}' and trashed = false`,
      // Ask for the description field, which contains our timestamp
      fields: 'files(id, description)', 
    });

    const indexFile = searchRes.data.files?.[0];

    // The description field now holds our lastBuildTime
    const lastBuildTime = indexFile?.description;

    if (!lastBuildTime) {
      return new NextResponse("Index file or its timestamp not found.", { status: 404 });
    }

    return NextResponse.json({ lastBuildTime: lastBuildTime });

  } catch (error) {
    console.error("Error fetching metadata:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

