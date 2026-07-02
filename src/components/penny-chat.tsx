"use client";

import AgentChat from "@/components/agent-chat";

export default function PennyChat() {
  return (
    <AgentChat
      config={{
        agent: "penny",
        name: "Penny",
        title: "Staff Accountant",
        initials: "PQ",
        avatarClasses: "bg-teal-600 ring-2 ring-teal-400",
        greeting:
          "Penny here. Ask me about anything I've found in the books, answer my open questions right here (they become standing policy), or tell me what to work on — e.g. \"run auto-categorize\" or \"reconcile January.\" Anything that's a real policy call I'll defer to Sterling, but you can unblock my day-to-day work right in this chat.",
        placeholder:
          "Ask Penny about her findings, answer her questions, or put her to work... (Enter to send, Shift+Enter for a new line)",
        workingLabel: "Penny is checking the books...",
      }}
    />
  );
}
