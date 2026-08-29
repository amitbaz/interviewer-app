import { NextResponse } from "next/server";
import { analyzeProfile, extractPdfText } from "@/lib/coach";
import { getProfile, saveProfile } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ profile: getProfile(), demoMode: !process.env.GEMINI_API_KEY });
}

export async function POST(request: Request) {
  let cvText: unknown;
  let coverLetter: unknown = "";
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const formData = await request.formData();
      const cv = formData.get("cv");
      coverLetter = formData.get("coverLetter") ?? "";
      if (!(cv instanceof File) || cv.type !== "application/pdf") return NextResponse.json({ error: "Upload a PDF CV or paste a professional summary." }, { status: 400 });
      cvText = await extractPdfText(cv);
    } else {
      const body = await request.json();
      cvText = body.cvText;
      coverLetter = body.coverLetter ?? "";
    }
  } catch (caught) {
    return NextResponse.json({ error: caught instanceof Error ? caught.message : "Could not read that CV." }, { status: 400 });
  }
  if (typeof cvText !== "string" || cvText.trim().length < 80) {
    return NextResponse.json({ error: "Paste at least a short CV or professional summary." }, { status: 400 });
  }
  const profile = await analyzeProfile(cvText.trim(), String(coverLetter));
  return NextResponse.json({ profile: saveProfile(profile), demoMode: !process.env.GEMINI_API_KEY });
}

export async function PUT(request: Request) {
  const { profile } = await request.json();
  if (!profile || typeof profile !== "object") return NextResponse.json({ error: "Profile data is required." }, { status: 400 });
  if (typeof profile.role !== "string" || !profile.role.trim() || typeof profile.seniority !== "string" || !profile.seniority.trim()) {
    return NextResponse.json({ error: "Add a role and seniority before confirming your profile." }, { status: 400 });
  }
  if (typeof profile.narrative !== "string" || !profile.narrative.trim() || !Array.isArray(profile.expertise)) {
    return NextResponse.json({ error: "Add a short narrative and at least one area of expertise." }, { status: 400 });
  }
  const expertise = profile.expertise.filter((item: unknown) => typeof item === "string" && item.trim()).map((item: string) => item.trim()).slice(0, 10);
  if (!expertise.length) return NextResponse.json({ error: "Add at least one area of expertise." }, { status: 400 });
  const existing = getProfile();
  if (!existing) return NextResponse.json({ error: "Create a profile first." }, { status: 400 });
  const updated = { ...existing, role: profile.role.trim(), seniority: profile.seniority.trim(), narrative: profile.narrative.trim(), expertise };
  return NextResponse.json({ profile: saveProfile(updated), demoMode: !process.env.GEMINI_API_KEY });
}
