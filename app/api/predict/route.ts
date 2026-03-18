import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://kitsakon-culiciodes.hf.space/".replace(/\/+$/, "");

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mlModel = (formData.get("ml_model") as string) || "efficientnet_b0";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const forwardForm = new FormData();
    forwardForm.append("file", file);
    forwardForm.append("ml_model", mlModel);

    const fastapiRes = await fetch(`${API_URL}/predict-with-gradcam`, {
      method: "POST",
      body: forwardForm,
      cache: "no-store",
    });

    if (!fastapiRes.ok) {
      const text = await fastapiRes.text();
      return NextResponse.json(
        { error: text || "Prediction failed from ML API" },
        { status: fastapiRes.status }
      );
    }

    const data = await fastapiRes.json();

    await prisma.prediction.create({
      data: {
        filename: file.name,
        species: data.species,
        genus: data.genus,
        confidence: data.confidence,
        confidenceLevel: data.confidenceLevel,
        gradcam: Boolean(data.gradcam),
        modelUsed: mlModel,
      },
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/predict error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}