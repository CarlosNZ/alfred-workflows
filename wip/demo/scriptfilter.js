#!/usr/bin/osascript -l JavaScript

// Script Filter for the "demo" keyword. Alfred passes the typed query as the
// first argument and reads Script Filter JSON from stdout:
// https://www.alfredapp.com/help/workflows/inputs/script-filter/json/

function run(argv) {
  const query = (argv[0] ?? "").trim()

  const items = [
    {
      uid: "echo",
      title: query ? `You typed: ${query}` : "Type something…",
      subtitle: "Press ↩ to show it in Large Type",
      arg: query,
      valid: query.length > 0,
    },
  ]

  return JSON.stringify({ items })
}
