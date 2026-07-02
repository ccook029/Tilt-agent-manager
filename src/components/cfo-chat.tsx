"use client";

import AgentChat from "@/components/agent-chat";

export default function CfoChat() {
  return (
    <AgentChat
      config={{
        agent: "sterling",
        name: "Sterling",
        title: "CFO · Accounting Manager",
        initials: "SV",
        avatarClasses: "bg-slate-600 ring-2 ring-slate-400",
        greeting:
          "Sterling here — CFO. This is your command console: ask me anything about the books, answer my open questions right here in chat (I'll record your call as standing policy), or tell me what you want done — e.g. \"run the books health report\" or \"start categorizing\" — and I'll put Penny on it.",
        placeholder:
          "Ask the CFO, answer his questions in detail, or give direction... (Enter to send, Shift+Enter for a new line)",
        workingLabel: "Sterling is reviewing...",
      }}
    />
  );
}
