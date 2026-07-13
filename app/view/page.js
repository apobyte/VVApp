"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ViewClient from "@/components/ViewClient";

function ViewInner() {
  const params = useSearchParams();
  const roomId = (params.get("room") || "").trim();

  if (!roomId) {
    return (
      <main className="home">
        <section className="home-card">
          <h1 className="brand">Missing room</h1>
          <p className="lead">
            Open a view link with a room id, e.g. /view?room=myroom
          </p>
          <Link className="btn primary" href="/">
            Back home
          </Link>
        </section>
      </main>
    );
  }

  return <ViewClient roomId={roomId} />;
}

export default function ViewPage() {
  return (
    <Suspense
      fallback={
        <main className="home">
          <p className="lead">Loading…</p>
        </main>
      }
    >
      <ViewInner />
    </Suspense>
  );
}
