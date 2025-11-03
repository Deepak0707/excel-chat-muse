import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
}

export const ChatMessage = ({ role, content }: ChatMessageProps) => {
  const isUser = role === "user";

  // Convert markdown-style links to HTML links
  const formatContent = (text: string) => {
    // Match markdown links [text](url) and convert to HTML
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
      // Add text before the link
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      // Add the link
      parts.push(
        <a
          key={match.index}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-medium"
        >
          {match[1]}
        </a>
      );
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  return (
    <div
      className={cn(
        "flex gap-3 p-4 rounded-lg animate-in slide-in-from-bottom-2",
        isUser
          ? "bg-[hsl(var(--chat-user-bg))] text-primary-foreground ml-12"
          : "bg-[hsl(var(--chat-assistant-bg))] mr-12"
      )}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-background/10">
        {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </div>
      <div className="flex-1 whitespace-pre-wrap break-words">
        {formatContent(content)}
      </div>
    </div>
  );
};
