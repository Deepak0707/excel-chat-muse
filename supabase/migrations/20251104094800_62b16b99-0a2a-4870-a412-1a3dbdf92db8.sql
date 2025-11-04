-- Create message_feedback table to track user feedback on AI responses
CREATE TABLE IF NOT EXISTS public.message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  message_role text NOT NULL,
  message_content text NOT NULL,
  feedback_type text NOT NULL CHECK (feedback_type IN ('positive', 'negative')),
  user_comment text,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

-- Allow anyone to submit feedback (public app)
CREATE POLICY "Allow public insert on message_feedback"
  ON public.message_feedback
  FOR INSERT
  WITH CHECK (true);

-- Allow public read access for analytics
CREATE POLICY "Allow public read on message_feedback"
  ON public.message_feedback
  FOR SELECT
  USING (true);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_message_feedback_session_id ON public.message_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_message_feedback_created_at ON public.message_feedback(created_at DESC);