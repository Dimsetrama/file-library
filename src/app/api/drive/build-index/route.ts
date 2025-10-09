import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { spawn } from 'child_process';

export async function POST() {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
        return new NextResponse(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }

    const scriptPath = 'scripts/build-index.js';
    const child = spawn('node', [scriptPath, session.accessToken], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();

    return new NextResponse(JSON.stringify({ message: "Indexing process started." }), { status: 202 });
}

export const maxDuration = 300;
