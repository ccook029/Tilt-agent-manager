"use client";

// The whole Design Portal UI: conversation sidebar, Gemini-style chat thread,
// image uploads (attach / drag-drop / paste), and Nano Banana image results
// with download + "edit this" actions. All state is client-side; the server
// only proxies to Gemini.

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatPart } from "@/lib/gemini";
import { prepareImage, type PreparedImage } from "@/lib/images";
import {
  deleteConversation,
  listConversations,
  loadMessages,
  saveConversation,
  type ConversationMeta,
} from "@/lib/store";
import { Markdown } from "@/components/markdown";
import {
  ChatIcon,
  CloseIcon,
  DownloadIcon,
  LogoutIcon,
  MenuIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/icons";

type Mode = "design" | "chat";

const ASPECTS = ["Auto", "1:1", "4:5", "3:4", "16:9", "9:16"] as const;
const MAX_ATTACHMENTS = 6;
// Keep request bodies under Vercel's ~4.5MB cap: send a bounded window of
// history and only keep inline images from the most recent exchanges.
const HISTORY_MESSAGES = 12;
const HISTORY_MESSAGES_WITH_IMAGES = 4;

const SUGGESTIONS = [
  "Create a moody product hero shot of a hockey stick on dark ice, cyan rim lighting",
  "Make this photo feel like a gritty night-game poster (upload a photo first)",
  "Design a bold Instagram story background — black carbon texture with electric cyan streaks",
];

function trimForApi(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-HISTORY_MESSAGES);
  const imageCutoff = Math.max(0, recent.length - HISTORY_MESSAGES_WITH_IMAGES);
  return recent.map((m, i) => {
    if (i >= imageCutoff) return m;
    const parts: ChatPart[] = m.parts.map((p) =>
      "image" in p ? { text: "(image from earlier in the conversation, omitted)" } : p
    );
    return { ...m, parts };
  });
}

function titleFrom(messages: ChatMessage[]): string {
  for (const m of messages) {
    for (const p of m.parts) {
      if ("text" in p && p.text.trim()) {
        const t = p.text.trim().replace(/\s+/g, " ");
        return t.length > 48 ? `${t.slice(0, 48)}…` : t;
      }
    }
  }
  return "New design";
}

export default function Portal() {
  const router = useRouter();

  const [convos, setConvos] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PreparedImage[]>([]);
  const [mode, setMode] = useState<Mode>("design");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>("Auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    listConversations().then(setConvos).catch(() => setConvos([]));
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: string } | null) => setUser(d?.user ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const newChat = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setAttachments([]);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  }, []);

  const openChat = useCallback(async (id: string) => {
    setActiveId(id);
    setError(null);
    setAttachments([]);
    setSidebarOpen(false);
    setMessages(await loadMessages(id).catch(() => []));
  }, []);

  const removeChat = useCallback(
    async (id: string) => {
      await deleteConversation(id).catch(() => {});
      setConvos((prev) => prev.filter((c) => c.id !== id));
      if (id === activeId) newChat();
    },
    [activeId, newChat]
  );

  const addFiles = useCallback(async (files: Iterable<File>) => {
    setError(null);
    for (const file of files) {
      try {
        const prepared = await prepareImage(file);
        setAttachments((prev) =>
          prev.length >= MAX_ATTACHMENTS ? prev : [...prev, prepared]
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't read that file.");
      }
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (busy || (!text && attachments.length === 0)) return;

    const parts: ChatPart[] = [];
    if (text) parts.push({ text });
    for (const a of attachments) parts.push({ image: { dataUrl: a.dataUrl } });

    const userMsg: ChatMessage = { role: "user", parts };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setAttachments([]);
    setError(null);
    setBusy(true);

    const id = activeId ?? crypto.randomUUID();
    const persist = async (msgs: ChatMessage[]) => {
      const meta: ConversationMeta = { id, title: titleFrom(msgs), updatedAt: Date.now() };
      await saveConversation(meta, msgs).catch(() => {});
      setConvos((prev) => [meta, ...prev.filter((c) => c.id !== id)]);
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: trimForApi(next),
          mode,
          aspectRatio: mode === "design" && aspect !== "Auto" ? aspect : undefined,
        }),
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      const data = (await res.json().catch(() => null)) as
        | { parts?: ChatPart[]; error?: string }
        | null;

      if (!res.ok || !data?.parts) {
        setError(data?.error ?? `The request failed (${res.status}). Try again.`);
        setActiveId(id);
        await persist(next);
        return;
      }

      const withReply = [...next, { role: "model" as const, parts: data.parts }];
      setMessages(withReply);
      setActiveId(id);
      await persist(withReply);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      setActiveId(id);
      await persist(next);
    } finally {
      setBusy(false);
    }
  }, [activeId, aspect, attachments, busy, input, messages, mode, router]);

  const editImage = useCallback((dataUrl: string) => {
    setAttachments((prev) =>
      prev.length >= MAX_ATTACHMENTS
        ? prev
        : [...prev, { dataUrl, name: "previous-result.png" }]
    );
    setMode("design");
    textareaRef.current?.focus();
  }, []);

  const download = useCallback((dataUrl: string, index: number) => {
    const a = document.createElement("a");
    const ext = /^data:image\/(\w+)/.exec(dataUrl)?.[1] ?? "png";
    a.href = dataUrl;
    a.download = `tilt-design-${index + 1}.${ext}`;
    a.click();
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }, [router]);

  let imageCounter = 0;

  return (
    <div
      className="relative flex h-dvh overflow-hidden bg-tilt-black"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-tilt-line bg-tilt-panel transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4">
          <Image
            src="/brand/tilt-logo.png"
            alt="TILT"
            width={120}
            height={32}
            priority
            className="h-auto w-28"
          />
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="cursor-pointer rounded-lg p-2 text-neutral-400 transition-colors duration-200 hover:bg-white/5 hover:text-white md:hidden"
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={newChat}
            className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-tilt-line bg-tilt-card px-3 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:border-tilt-cyan/50 hover:bg-tilt-gray"
          >
            <PlusIcon className="h-4 w-4 text-tilt-cyan" />
            New chat
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3" aria-label="Conversations">
          {convos.length === 0 && (
            <p className="px-2 py-4 text-sm text-neutral-500">
              No conversations yet.
            </p>
          )}
          <ul className="space-y-1">
            {convos.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => void openChat(c.id)}
                  className={`w-full cursor-pointer truncate rounded-lg px-3 py-2 pr-9 text-left text-sm transition-colors duration-200 ${
                    c.id === activeId
                      ? "bg-tilt-gray text-white"
                      : "text-neutral-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => void removeChat(c.id)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-neutral-500 opacity-0 transition-all duration-200 hover:bg-white/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete "${c.title}"`}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-tilt-line p-3">
          {user && (
            <p className="truncate px-3 pb-1 text-xs text-neutral-500" title={user}>
              {user}
            </p>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-400 transition-colors duration-200 hover:bg-white/5 hover:text-white"
          >
            <LogoutIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
          className="absolute inset-0 z-20 bg-black/60 md:hidden"
        />
      )}

      {/* ── Main pane ── */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-tilt-line px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="cursor-pointer rounded-lg p-2 text-neutral-300 transition-colors duration-200 hover:bg-white/5"
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
          <Image
            src="/brand/tilt-logo.png"
            alt="TILT"
            width={90}
            height={24}
            className="h-auto w-20"
          />
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-6">
            {messages.length === 0 && !busy && (
              <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
                <Image
                  src="/brand/tilt-logo.png"
                  alt=""
                  width={220}
                  height={59}
                  className="h-auto w-52"
                />
                <div>
                  <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
                    Tilt Design Portal
                  </h1>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
                    Describe a design, or upload a photo and tell Gemini how to
                    transform it. Generated images can be downloaded or edited
                    again with a follow-up prompt.
                  </p>
                </div>
                <div className="flex w-full max-w-lg flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setInput(s);
                        textareaRef.current?.focus();
                      }}
                      className="cursor-pointer rounded-xl border border-tilt-line bg-tilt-panel px-4 py-3 text-left text-sm text-neutral-300 transition-colors duration-200 hover:border-tilt-cyan/50 hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, mi) => (
              <div
                key={mi}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] space-y-3 rounded-2xl px-4 py-3 text-[15px] ${
                    m.role === "user"
                      ? "border border-tilt-cyan/30 bg-tilt-cyan/10 text-neutral-100"
                      : "border border-tilt-line bg-tilt-panel text-neutral-200"
                  }`}
                >
                  {m.parts.map((p, pi) => {
                    if ("text" in p) {
                      return <Markdown key={pi} text={p.text} />;
                    }
                    const idx = imageCounter++;
                    return (
                      <figure key={pi} className="space-y-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.image.dataUrl}
                          alt={
                            m.role === "model"
                              ? `Generated design ${idx + 1}`
                              : `Uploaded image ${idx + 1}`
                          }
                          className="max-h-[28rem] w-auto max-w-full rounded-xl border border-tilt-line"
                        />
                        {m.role === "model" && (
                          <figcaption className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => download(p.image.dataUrl, idx)}
                              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-tilt-line bg-tilt-card px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors duration-200 hover:border-tilt-cyan/50 hover:text-white"
                            >
                              <DownloadIcon className="h-3.5 w-3.5" />
                              Download
                            </button>
                            <button
                              type="button"
                              onClick={() => editImage(p.image.dataUrl)}
                              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-tilt-line bg-tilt-card px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors duration-200 hover:border-tilt-cyan/50 hover:text-white"
                            >
                              <PencilIcon className="h-3.5 w-3.5" />
                              Edit this
                            </button>
                          </figcaption>
                        )}
                      </figure>
                    );
                  })}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border border-tilt-line bg-tilt-panel px-4 py-3 text-sm text-neutral-400">
                  <span className="thinking-dot h-2 w-2 rounded-full bg-tilt-cyan" />
                  <span className="thinking-dot h-2 w-2 rounded-full bg-tilt-cyan" />
                  <span className="thinking-dot h-2 w-2 rounded-full bg-tilt-cyan" />
                  <span className="ml-1">
                    {mode === "design" ? "Generating design…" : "Thinking…"}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="flex justify-start">
                <p className="max-w-[85%] rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </p>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Composer ── */}
        <div className="border-t border-tilt-line bg-tilt-panel/60 px-4 py-3">
          <div className="mx-auto max-w-3xl">
            {attachments.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attached images">
                {attachments.map((a, i) => (
                  <li key={i} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.dataUrl}
                      alt={a.name}
                      className="h-16 w-16 rounded-lg border border-tilt-line object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="absolute -right-1.5 -top-1.5 cursor-pointer rounded-full border border-tilt-line bg-tilt-black p-0.5 text-neutral-300 transition-colors duration-200 hover:text-red-400"
                      aria-label={`Remove ${a.name}`}
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-2xl border border-tilt-line bg-tilt-black focus-within:border-tilt-cyan/60">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files).filter((f) =>
                    f.type.startsWith("image/")
                  );
                  if (files.length > 0) {
                    e.preventDefault();
                    void addFiles(files);
                  }
                }}
                rows={2}
                placeholder={
                  mode === "design"
                    ? "Describe the design, or upload an image and say how to change it…"
                    : "Ask anything…"
                }
                className="w-full resize-none bg-transparent px-4 pt-3 text-[15px] text-white placeholder-neutral-500 outline-none"
                aria-label="Message"
              />
              <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer rounded-lg p-2 text-neutral-400 transition-colors duration-200 hover:bg-white/5 hover:text-white"
                  aria-label="Attach images"
                  title="Attach images (or drag & drop / paste)"
                >
                  <PaperclipIcon />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />

                <div
                  className="flex rounded-lg border border-tilt-line p-0.5"
                  role="group"
                  aria-label="Mode"
                >
                  <button
                    type="button"
                    onClick={() => setMode("design")}
                    aria-pressed={mode === "design"}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 ${
                      mode === "design"
                        ? "bg-tilt-cyan text-black"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    <SparklesIcon className="h-3.5 w-3.5" />
                    Design
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("chat")}
                    aria-pressed={mode === "chat"}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 ${
                      mode === "chat"
                        ? "bg-tilt-cyan text-black"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    <ChatIcon className="h-3.5 w-3.5" />
                    Chat
                  </button>
                </div>

                {mode === "design" && (
                  <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                    <span>Aspect</span>
                    <select
                      value={aspect}
                      onChange={(e) => setAspect(e.target.value as (typeof ASPECTS)[number])}
                      className="cursor-pointer rounded-lg border border-tilt-line bg-tilt-black px-2 py-1.5 text-xs text-neutral-200 outline-none transition-colors duration-200 hover:border-tilt-cyan/50"
                    >
                      {ASPECTS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || (!input.trim() && attachments.length === 0)}
                  className="ml-auto flex cursor-pointer items-center gap-2 rounded-xl bg-tilt-cyan px-4 py-2 font-display text-sm font-bold uppercase tracking-wider text-black transition-colors duration-200 hover:bg-[#33ccff] disabled:cursor-default disabled:opacity-40"
                >
                  <SendIcon className="h-4 w-4" />
                  Send
                </button>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-neutral-600">
              Powered by Gemini · conversations are saved in this browser only
            </p>
          </div>
        </div>
      </main>

      {/* ── Drag & drop overlay ── */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-tilt-black/80">
          <div className="rounded-2xl border-2 border-dashed border-tilt-cyan px-10 py-8 text-center">
            <p className="font-display text-2xl font-bold uppercase tracking-wider text-tilt-cyan">
              Drop images here
            </p>
            <p className="mt-1 text-sm text-neutral-400">They&apos;ll be attached to your next message</p>
          </div>
        </div>
      )}
    </div>
  );
}
