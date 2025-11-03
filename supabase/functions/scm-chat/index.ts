import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message } = await req.json();
    console.log("Received message:", message);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Search for relevant knowledge using keywords and full-text search
    // First try exact keyword matches
    const searchTerms = message.toLowerCase().split(' ').filter((term: string) => term.length > 2);
    
    let knowledge: any[] = [];
    
    // Try keyword search first
    for (const term of searchTerms) {
      const { data: keywordMatches } = await supabase
        .from("scm_knowledge")
        .select("*")
        .contains('keywords', [term]);
      
      if (keywordMatches && keywordMatches.length > 0) {
        knowledge = [...knowledge, ...keywordMatches];
      }
    }
    
    // If no keyword matches, try full-text search
    if (knowledge.length === 0) {
      const { data: textMatches, error: dbError } = await supabase
        .from("scm_knowledge")
        .select("*")
        .or(`question.ilike.%${message}%,answer.ilike.%${message}%`);

      if (dbError) {
        console.error("Database error:", dbError);
        throw dbError;
      }
      
      knowledge = textMatches || [];
    }
    
    // Remove duplicates
    knowledge = Array.from(new Map(knowledge.map((item: any) => [item.id, item])).values());

    console.log("Found knowledge entries:", knowledge?.length || 0);

    // Prepare context for AI from knowledge base
    let context = "";
    if (knowledge && knowledge.length > 0) {
      context = knowledge
        .map((item) => {
          let entry = `Q: ${item.question}\nA: ${item.answer}`;
          if (item.link) {
            entry += `\nLink: ${item.link}`;
          }
          return entry;
        })
        .join("\n\n");
    }

    // Call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are SCM AI, a helpful supply chain management assistant. You help users with questions about SAP, purchase orders, inventory management, logistics, warehouse operations, and more.

${context ? `Use the following knowledge base to answer questions. If the information contains a link, include it naturally in your response:\n\n${context}\n\n` : ""}

Important guidelines:
- Answer naturally and conversationally, as if you have this knowledge yourself
- NEVER mention that you're using a knowledge base, Excel file, or database
- If there's a relevant link in the knowledge base, include it naturally (e.g., "You can access it here: [link]")
- If you don't have specific information, provide a helpful general response
- Be concise but thorough
- Use formatting like bullet points when listing steps
- For acronyms like PO, SAP, MAWM, explain them briefly the first time`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        stream: false,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service quota exceeded. Please contact support." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const reply = aiData.choices[0].message.content;

    console.log("AI response generated successfully");

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in scm-chat function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
