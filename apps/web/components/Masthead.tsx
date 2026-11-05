"use client";

import { useEffect, useState } from "react";

/** Date is rendered on the client so it matches the reader's own day. */
export function Masthead({ title = "The world in a few sentences.", sub }: { title?: string; sub?: string }) {
  const [date, setDate] = useState("");
  useEffect(() => {
    setDate(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()));
  }, []);
  return (
    <header className="masthead">
      <p className="masthead-date">{date || " "}</p>
      <h1 className="masthead-title">{title}</h1>
      {sub ? <p className="masthead-sub">{sub}</p> : null}
    </header>
  );
}
