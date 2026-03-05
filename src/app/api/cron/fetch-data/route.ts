import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    execSync(
      `python3 -c "
import os, sys
sys.path.insert(0, '.')
from supabase import create_client
from data.fetcher import fetch_and_cache, UNIVERSE

url = os.environ['NEXT_PUBLIC_SUPABASE_URL']
key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
client = create_client(url, key)
fetch_and_cache(UNIVERSE, client)
"`,
      { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }
    );

    return NextResponse.json({ success: true, message: "Market data refreshed" });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}
