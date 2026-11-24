import { NextResponse } from "next/server";
import { configured } from "@/lib/providers";
import { belvoStart, ebBanks, ebStart, isFeed, newState, validCpf } from "@/lib/providers/feeds";
import { createClient } from "@/utils/supabase/server";

const COOKIE = "bank_connect";

// GET lists banks to pick from (Enable Banking). POST starts consent and returns the page to send the user to.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const country = new URL(request.url).searchParams.get("country") ?? "";
  if (id !== "enablebanking" || !configured("enablebanking") || !/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: "Not available" }, { status: 400 });
  try {
    return NextResponse.json({ banks: (await ebBanks(process.env, country)).map((b) => b.name) });
  } catch (e) {
    console.error("[broke] bank list:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't load the bank list. Try again in a moment." }, { status: 502 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { origin } = new URL(request.url);
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isFeed(id) || !configured(id)) return NextResponse.json({ error: "This connection isn't set up yet." }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { bank?: string; country?: string; cpf?: string; name?: string };
  const state = newState();
  const callback = `${origin}/api/bank/connect/${id}/callback`;
  const saved: { state: string } = { state };
  try {
    let url: string;
    if (id === "enablebanking") {
      if (!body.bank || !/^[A-Z]{2}$/.test(body.country ?? "")) return NextResponse.json({ error: "Pick your bank first." }, { status: 400 });
      url = await ebStart(process.env, { bank: body.bank, country: body.country!, state, redirect: callback });
    } else {
      if (!validCpf(body.cpf ?? "") || (body.name ?? "").trim().split(/\s+/).length < 2) return NextResponse.json({ error: "Enter your 11-digit CPF and full name." }, { status: 400 });
      url = await belvoStart(process.env, { cpf: body.cpf!, name: body.name!, origin, callback, state, externalId: `broke-${user.id}` });
    }
    const res = NextResponse.json({ url });
    res.cookies.set(COOKIE, JSON.stringify(saved), { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), maxAge: 1800, path: "/api/bank/connect" });
    return res;
  } catch (e) {
    console.error(`[broke] ${id} start:`, e instanceof Error ? e.message : e); // the message never holds the CPF or a key
    return NextResponse.json({ error: "Couldn't start the connection. Try again in a moment." }, { status: 502 });
  }
}
