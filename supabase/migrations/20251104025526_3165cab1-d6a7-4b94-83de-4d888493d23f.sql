-- Create conversations table to log all chat interactions
CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create index for efficient queries
CREATE INDEX idx_conversations_session_id ON public.conversations(session_id);
CREATE INDEX idx_conversations_created_at ON public.conversations(created_at DESC);

-- Enable RLS (public read for analytics, no public write to prevent tampering)
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Allow public read access for analytics/review
CREATE POLICY "Allow public read access to conversations" 
ON public.conversations 
FOR SELECT 
USING (true);

-- Create a function to analyze common topics
CREATE OR REPLACE FUNCTION public.get_conversation_stats(days_back integer DEFAULT 7)
RETURNS TABLE (
  total_conversations bigint,
  total_messages bigint,
  unique_sessions bigint,
  avg_messages_per_session numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(DISTINCT session_id)::bigint as total_conversations,
    COUNT(*)::bigint as total_messages,
    COUNT(DISTINCT session_id)::bigint as unique_sessions,
    ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT session_id), 0), 2) as avg_messages_per_session
  FROM public.conversations
  WHERE created_at >= NOW() - (days_back || ' days')::interval;
END;
$$;