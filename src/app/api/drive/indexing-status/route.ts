// src/app/api/drive/indexing-status/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const STATUS_FILE_PATH = path.join(process.cwd(), '.tmp', 'indexing-status.json');

export async function GET() {
    try {
        const data = await fs.readFile(STATUS_FILE_PATH, 'utf-8');
        const status = JSON.parse(data);
        return NextResponse.json(status);
    } catch (error) {
        // If the file doesn't exist, it means no process is running
        return NextResponse.json({ status: 'idle' });
    }
}