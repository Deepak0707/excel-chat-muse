import { cn } from "@/lib/utils";
import { Bot, User, ThumbsUp, ThumbsDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  onFeedback?: (feedbackType: 'positive' | 'negative') => void;
}

export const ChatMessage = ({ role, content, onFeedback }: ChatMessageProps) => {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const isUser = role === "user";

  // Convert markdown-style links to HTML links and handle document downloads
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
      
      const linkText = match[1];
      const linkUrl = match[2];
      const isDocument = linkUrl.includes('/documents/') || linkText.toLowerCase().includes('document');
      
      // Add the link with appropriate styling
      parts.push(
        <a
          key={match.index}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={isDocument}
          className={cn(
            "font-medium hover:underline inline-flex items-center gap-1",
            isDocument ? "text-accent-foreground bg-accent px-2 py-1 rounded" : "text-primary"
          )}
        >
          {linkText}
          {isDocument && (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
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

  const handleFeedback = (type: 'positive' | 'negative') => {
    setFeedback(type);
    onFeedback?.(type);
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
      <div className="flex-1">
        <div className="whitespace-pre-wrap break-words">
          {formatContent(content)}
        </div>
        {role === "assistant" && onFeedback && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback('positive')}
              className={`h-7 px-2 ${feedback === 'positive' ? 'text-green-600 hover:text-green-600' : 'text-muted-foreground'}`}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback('negative')}
              className={`h-7 px-2 ${feedback === 'negative' ? 'text-red-600 hover:text-red-600' : 'text-muted-foreground'}`}
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </Button>
            {feedback && (
              <span className="text-xs text-muted-foreground self-center ml-2">
                Thanks for your feedback!
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};