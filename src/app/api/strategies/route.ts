import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const supabase = createServerClient();

  // Get auth token from header
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, code, parameters, selected_assets } = body;

  if (!name || !code || !selected_assets?.length) {
    return NextResponse.json(
      { error: "name, code, and selected_assets are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("strategies")
    .insert({
      user_id: user.id,
      name,
      description: description || "",
      code,
      parameters: parameters || {},
      selected_assets,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
