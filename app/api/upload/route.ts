import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, route: "upload" });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const blob = await put(`${Date.now()}-${file.name}`, file, {
      access: "public",
      addRandomSuffix: true,
    });

    return Response.json({
      url: blob.url,
      pathname: blob.pathname,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}