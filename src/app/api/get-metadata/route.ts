// src/app/api/drive/get-metadata/route.ts
import { NextResponse } from "next/server";
import fs from 'fs/promises';
import path from 'path';

const METADATA_PATH = path.join(process.cwd(), '.tmp', 'metadata.json');

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const data = await fs.readFile(METADATA_PATH, 'utf-8');
    const metadata = JSON.parse(data);
    return NextResponse.json({ lastBuildTime: metadata.lastBuildTime });
  } catch (error) {
    // If the file can't be read, it means the index hasn't been successfully built yet.
    console.error("Could not read local metadata file:", (error as Error).message);
    return new NextResponse("Metadata file not found.", { status: 404 });
  }
}

