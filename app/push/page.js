"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PushClient from "@/components/PushClient";

function PushInner() {
  const params = useSearchParams();
  const roomId = (params.get("room") || "").trim();

  if (!roomId) {
    return (
      <main className="home">
        <section className="home-card">
          <h1 className="brand">Missing room</h1>
          <p className="lead">
            Open a push link with a room id, e.g. /push?room=myroom
          </p>
          <Link className="btn primary" href="/">
            Back home
          </Link>
        </section>
      </main>
    );
  }

  return <PushClient roomId={roomId} />;
}

export default function PushPage() {
  return (
    <Suspense
      fallback={
        <main className="home">
          <p className="lead">Loading…</p>
        </main>
      }
    >
      <PushInner />
    </Suspense>
  );
}
