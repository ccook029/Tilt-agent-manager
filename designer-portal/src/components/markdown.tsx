// Minimal markdown renderer for model replies — paragraphs, headings, bullet
// and numbered lists, `inline code`, ```code fences``` and **bold**. No deps;
// everything renders as text so there's no HTML injection surface.

import { Fragment, type ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // **bold** and `code`
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(re)) {
    if (match.index! > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(
        <strong key={`${keyBase}-b${i++}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      out.push(
        <code
          key={`${keyBase}-c${i++}`}
          className="rounded bg-white/10 px-1 py-0.5 text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    last = match.index! + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-lg bg-black/50 p-3 text-[13px] leading-relaxed"
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={key++} className="font-display text-lg font-bold uppercase tracking-wide text-white">
          {inline(heading[2], `h${key}`)}
        </p>
      );
      i++;
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5">
          {items.map((item, j) => (
            <li key={j}>{inline(item, `li${key}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Plain paragraph: consume consecutive non-empty, non-special lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++}>{inline(para.join("\n"), `p${key}`)}</p>);
  }

  return (
    <div className="space-y-3 whitespace-pre-wrap break-words leading-relaxed">
      {blocks.map((b, j) => (
        <Fragment key={j}>{b}</Fragment>
      ))}
    </div>
  );
}
