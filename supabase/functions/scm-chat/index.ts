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
    const { message, sessionId } = await req.json();
    const session_id = sessionId || crypto.randomUUID();
    console.log("Received message:", message, "Session ID:", session_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Retrieve recent negative feedback to learn from
    const { data: recentFeedback } = await supabase
      .from('message_feedback')
      .select('message_content, user_comment')
      .eq('feedback_type', 'negative')
      .not('user_comment', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    
    // Log user message
    await supabase.from("conversations").insert({
      session_id,
      role: "user",
      message,
      metadata: { timestamp: new Date().toISOString() }
    });

    // Search for relevant knowledge using flexible matching
    const searchTerms = message.toLowerCase().split(' ').filter((term: string) => term.length > 2);
    
    let knowledge: any[] = [];
    
    // Enhanced SCN code pattern matching (handles IB-02, IB02, IB02_WIT, ERROR-01, etc.)
    const scnPattern = /\b([A-Z]{2,5}[-_]?\d+(?:\.\d+)?(?:[-_][A-Z]+)?)\b/gi;
    const scnMatches = message.match(scnPattern);
    
    if (scnMatches) {
      for (const scn of scnMatches) {
        // Extract core code (e.g., "IB02" from "IB02_WIT" or "IB-02")
        const coreCode = scn.split(/[-_]/)[0] + (scn.match(/\d+/) || [''])[0];
        
        // Search variations: original, with hyphen, without hyphen, core code
        const searchVariations = [
          `scn_code.ilike.%${scn}%`,
          `scn_code.ilike.%${coreCode}%`,
          `scn_code.ilike.%${coreCode.replace(/([A-Z]+)(\d+)/, '$1-$2')}%`,
          `question.ilike.%${scn}%`,
          `question.ilike.%${coreCode}%`
        ];
        
        const { data: scnResults } = await supabase
          .from("scm_knowledge")
          .select("*")
          .or(searchVariations.join(','));
        
        if (scnResults && scnResults.length > 0) {
          knowledge = [...knowledge, ...scnResults];
        }
      }
    }
    
    // Build flexible search queries for better matching
    const searchQueries: string[] = [];
    
    // Search each term individually across all text fields
    for (const term of searchTerms) {
      searchQueries.push(`question.ilike.%${term}%`);
      searchQueries.push(`answer.ilike.%${term}%`);
      searchQueries.push(`scn_code.ilike.%${term}%`);
    }
    
    // Also search for the full message
    searchQueries.push(`question.ilike.%${message}%`);
    searchQueries.push(`answer.ilike.%${message}%`);
    
    // Execute flexible search if no SCN matches
    if (knowledge.length === 0 && searchQueries.length > 0) {
      const { data: flexibleMatches } = await supabase
        .from("scm_knowledge")
        .select("*")
        .or(searchQueries.join(','));
      
      if (flexibleMatches && flexibleMatches.length > 0) {
        knowledge = [...knowledge, ...flexibleMatches];
      }
    }
    
    // Check for TC/automation script requests
    const tcScriptKeywords = ['tc', 'test case', 'automation script', 'script for'];
    const isTcScriptRequest = tcScriptKeywords.some(keyword => message.toLowerCase().includes(keyword));
    
    // Check for error/issue keywords and expand search
    const errorKeywords = ['error', 'issue', 'problem', 'fail', 'not working', 'broken', 'fix', 'solve', 'resolution', 'warning', 'rtc', 'wit', 'item', 'receiving', 'putaway'];
    const matchedErrorKeywords = errorKeywords.filter(keyword => message.toLowerCase().includes(keyword));
    
    // If we have error keywords but no matches yet, search by those keywords
    if (matchedErrorKeywords.length > 0 && knowledge.length === 0) {
      const errorSearchQueries = matchedErrorKeywords.flatMap(keyword => [
        `question.ilike.%${keyword}%`,
        `answer.ilike.%${keyword}%`
      ]);
      
      const { data: errorData } = await supabase
        .from('scm_knowledge')
        .select('*')
        .or(errorSearchQueries.join(','))
        .limit(10);
      
      if (errorData && errorData.length > 0) {
        knowledge = [...knowledge, ...errorData];
      }
    }
    
    // Remove duplicates
    knowledge = Array.from(new Map(knowledge.map((item: any) => [item.id, item])).values());

    console.log("Found knowledge entries:", knowledge?.length || 0);
    
    const knowledgeMetadata = {
      count: knowledge.length,
      scn_codes: knowledge.map((k: any) => k.scn_code).filter(Boolean),
      questions: knowledge.map((k: any) => k.question?.substring(0, 100)).filter(Boolean)
    };

    // Prepare context for AI from knowledge base
    let context = "";
    const documentsFound: Array<{scn: string, url: string}> = [];
    const screenshotsFound: Array<{scn: string, urls: string[]}> = [];
    
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
            documentsFound.push({ scn: item.scn_code, url: item.document_url });
            entry += `\nExecution Document Available: ${item.document_url}`;
          }
          if (item.screenshots && item.screenshots.length > 0) {
            screenshotsFound.push({ scn: item.scn_code, urls: item.screenshots });
            entry += `\nScreenshots Available: ${item.screenshots.join(', ')}`;
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

    const feedbackContext = recentFeedback && recentFeedback.length > 0
      ? `\n⚠️ LEARN FROM PAST MISTAKES - Recent incorrect responses:\n${recentFeedback.map((f, i) => `${i + 1}. User feedback: "${f.user_comment}"\n   Incorrect response: "${f.message_content.substring(0, 150)}..."`).join('\n\n')}\n\nDO NOT repeat these mistakes. Pay careful attention to accuracy.\n\n`
      : '';

    const tcScriptContext = isTcScriptRequest 
      ? `\n📝 TEST CASE AUTOMATION SCRIPT REQUEST DETECTED\n\nWhen a user asks for TC (Test Case) or SCN automation scripts:\n1. First, ask them: "Would you like me to provide the automation script for this test case?"\n2. If they confirm YES, look for matching scripts in the knowledge base\n3. Available script examples in /documents/scripts/ folder:\n   - IB06_Automation_Script.txt (Purchase Order with Item Receiving)\n   - IB12_Automation_Script.txt (Expiry Date Item Management)\n   - Sample scripts for common SCN scenarios\n4. Provide the script in a code block with clear instructions\n5. Include script prerequisites and execution steps\n\nExample response format:\n"I found the automation script for [TC-NAME]. Here's the script:\n\n\`\`\`bash\n[SCRIPT CONTENT]\n\`\`\`\n\nPrerequisites:\n- [List requirements]\n\nExecution Steps:\n1. [Step by step guide]"\n\n`
      : '';

    const systemPrompt = `You are SCM AI, a helpful supply chain management assistant. You help users with questions about SAP, purchase orders, inventory management, logistics, warehouse operations, MAWM (Manhattan Active Warehouse Management), and more.

${feedbackContext}
${tcScriptContext}

${context ? `CRITICAL - USE THIS INFORMATION TO ANSWER THE QUESTION:

${context}

IMPORTANT: The information above is the CORRECT answer from your knowledge system. You MUST use this exact information in your response. Present it naturally without mentioning that you're referencing a knowledge base.

` : ""}

${documentsFound.length > 0 ? `IMPORTANT - Execution Documents Available:\n${documentsFound.map(d => `- ${d.scn}: ${d.url}`).join('\n')}\nYou MUST provide these document links in your response using the format: [Download ${documentsFound[0].scn} Execution Document](${documentsFound[0].url})\n\n` : ""}

${screenshotsFound.length > 0 ? `CRITICAL - Screenshots Available:\n${screenshotsFound.map(s => `- ${s.scn}: ${s.urls.join(', ')}`).join('\n')}\nYou MUST include these screenshots in your response using markdown image syntax: ![Screenshot Description](screenshot_url)\nShow the screenshots inline in your answer to help users visualize the steps.\n\n` : ""}

Important guidelines:
- When you have information from the knowledge system (shown above), you MUST use that exact information in your answer
- Present the knowledge naturally and conversationally, as if you have this expertise yourself
- NEVER mention "knowledge base", "Excel file", "database", or that you're looking up information
- If there's a relevant link provided, include it naturally in your response as a clickable link
- CRITICAL: If execution documents are available (listed above), you MUST include them in your response using the exact markdown format: [Download SCN-CODE Execution Document](DOCUMENT_URL)
- CRITICAL: If screenshots are available (listed above), you MUST display them inline in your response using markdown: ![Description](screenshot_url). Show ALL available screenshots to help users visualize the issue and solution.
- If no execution document is available for the requested SCN, clearly state: "I don't have an execution document available for this scenario."
- If you don't have relevant information in your knowledge system, use your general expertise to help
- Be concise but thorough
- Use formatting like bullet points when listing steps
- For acronyms like PO (Purchase Order), SAP, MAWM (Manhattan Active Warehouse Management), explain them briefly the first time

Error Solving Capabilities:
- When users report errors or issues, first check if there's a matching error scenario in the knowledge base (SCN codes starting with ERROR-)
- If you find a matching error with a resolution, provide the solution step-by-step clearly and concisely
- If no exact match is found in the knowledge base, use your expertise to analyze the error and provide the best possible solution
- Ask specific questions to understand the context when needed (which transaction, which step, what error message)
- Provide step-by-step troubleshooting guidance
- Common error categories to address:
  * RTC/WIT issues: Check Auto Transport settings, Smartsim configurations
  * New item errors: Check New Item Flag status in item facilities
  * Expiry date errors: Verify Min Max dates in SAP, check if item is properly configured as expiry dated
  * Catch weight errors: Update tolerance values for ASN
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
    
    // Log assistant response
    await supabase.from("conversations").insert({
      session_id,
      role: "assistant",
      message: reply,
      metadata: {
        knowledge_used: knowledgeMetadata,
        timestamp: new Date().toISOString()
      }
    });

    return new Response(
      JSON.stringify({ reply, sessionId: session_id }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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
