import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient();
  const { id } = params;

  const { data, error } = await supabase
    .from("backtest_results")
    .select(
      `
      *,
      strategies (
        name,
        description,
        code,
        selected_assets,
        parameters,
        user_id
      )
    `
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Backtest not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
