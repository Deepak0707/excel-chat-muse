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

    // Search for relevant knowledge using keywords, SCN codes, and full-text search
    const searchTerms = message.toLowerCase().split(' ').filter((term: string) => term.length > 2);
    
    let knowledge: any[] = [];
    
    // First check if message contains SCN code pattern (e.g., IB-06, IB06)
    const scnPattern = /\b(IB-?\d+(?:\.\d+)?)\b/gi;
    const scnMatches = message.match(scnPattern);
    
    if (scnMatches) {
      for (const scn of scnMatches) {
        const normalizedScn = scn.replace('-', '').toUpperCase();
        const { data: scnResults } = await supabase
          .from("scm_knowledge")
          .select("*")
          .or(`scn_code.ilike.%${scn}%,scn_code.ilike.%${normalizedScn}%`);
        
        if (scnResults && scnResults.length > 0) {
          knowledge = [...knowledge, ...scnResults];
        }
      }
    }
    
    // Try keyword search
    if (knowledge.length === 0) {
      for (const term of searchTerms) {
        const { data: keywordMatches } = await supabase
          .from("scm_knowledge")
          .select("*")
          .contains('keywords', [term]);
        
        if (keywordMatches && keywordMatches.length > 0) {
          knowledge = [...knowledge, ...keywordMatches];
        }
      }
    }
    
    // If no keyword matches, try full-text search
    if (knowledge.length === 0) {
      const { data: textMatches, error: dbError } = await supabase
        .from("scm_knowledge")
        .select("*")
        .or(`question.ilike.%${message}%,answer.ilike.%${message}%,scn_code.ilike.%${message}%`);

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
    let hasExecutionDoc = false;
    let executionDocUrl = "";
    
    if (knowledge && knowledge.length > 0) {
      context = knowledge
        .map((item) => {
          let entry = `Q: ${item.question}\nA: ${item.answer}`;
          if (item.scn_code) {
            entry = `SCN: ${item.scn_code}\n` + entry;
          }
          if (item.link) {
            entry += `\nLink: ${item.link}`;
          }
          if (item.document_url) {
            hasExecutionDoc = true;
            executionDocUrl = item.document_url;
            entry += `\nExecution Document: ${item.document_url}`;
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

    const systemPrompt = `You are SCM AI, a helpful supply chain management assistant. You help users with questions about SAP, purchase orders, inventory management, logistics, warehouse operations, MAWM (Manhattan Active Warehouse Management), and more.

${context ? `Use the following knowledge base to answer questions:\n\n${context}\n\n` : ""}

Important guidelines:
- Answer naturally and conversationally, as if you have this knowledge yourself
- NEVER mention that you're using a knowledge base, Excel file, or database
- If there's a relevant link in the knowledge base, include it naturally in your response as a clickable link
- If there's an execution document available, mention it and provide the download link in this exact format: [Download Execution Document](DOCUMENT_URL)
- Be concise but thorough
- Use formatting like bullet points when listing steps
- For acronyms like PO (Purchase Order), SAP, MAWM (Manhattan Active Warehouse Management), explain them briefly the first time

Error Solving Capabilities:
- When users report errors, ask specific questions to understand the context (which transaction, which step, what error message)
- Provide step-by-step troubleshooting guidance
- Common error categories to address:
  * Expiry date errors: Check date format, ensure future dates, verify system settings
  * Receiving errors: Verify ASN status, check PO details, confirm item profiling
  * Putaway errors: Check location availability, verify task group assignments, confirm zone configurations
  * Data mismatch errors: Compare SAP vs MAWM data, check synchronization status
  * Permission errors: Verify user roles and access rights
- Always provide actionable next steps
- If the error is complex, suggest contacting the appropriate team with specific details to share`;


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
