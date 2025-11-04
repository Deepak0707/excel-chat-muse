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

    // Retrieve conversation history for context
    const { data: conversationHistory } = await supabase
      .from("conversations")
      .select("role, message")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    // Build conversation messages for AI (include history)
    const conversationMessages = conversationHistory && conversationHistory.length > 0
      ? conversationHistory.map((msg: any) => ({
          role: msg.role,
          content: msg.message
        }))
      : [{ role: "user", content: message }];

    // Search for relevant knowledge using flexible matching (includes conversation history)
    const historyText = (conversationHistory || []).map((m: any) => m.message).join(' ');
    const combinedText = `${historyText} ${message}`;
    const searchTerms = combinedText.toLowerCase().split(' ').filter((term: string) => term.length > 2);
    
    let knowledge: any[] = [];
    
    // Enhanced SCN code pattern matching (handles IB-02, IB02, IB02_WIT, ERROR-01, etc.)
    const scnPattern = /\b([A-Z]{2,5}[-_]?\d+(?:\.\d+)?(?:[-_][A-Z]+)?)\b/gi;
    const scnMatches = combinedText.match(scnPattern);
    
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
    // Also check for SCN code patterns like IB06, IB-06, IB12, etc.
    const scnCodePattern = /\b(IB|ERROR|SCN)[-_]?\d+\b/i;
    const isTcScriptRequest = tcScriptKeywords.some(keyword => message.toLowerCase().includes(keyword)) || scnCodePattern.test(message);
    
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

    // Detect if user wants automation script based on conversation
    const scnMatchesAll = combinedText.match(scnPattern);
    const lastScnRaw = scnMatchesAll ? scnMatchesAll[scnMatchesAll.length - 1] : null;
    const lastScnKey = lastScnRaw ? (lastScnRaw.toUpperCase().replace(/[-_]/g, '')) : null;
    
    const yesRegex = /^(yes|y|yeah|yep|sure|ok|okay|please|give me|provide|show me)$/i;
    const explicitScriptRegex = /(automation\s+script|script|provide.*script|give.*script)/i;
    const wantsScript = explicitScriptRegex.test(message) || yesRegex.test(message.trim());

    console.log("Found knowledge entries:", knowledge?.length || 0);
    console.log("Script request detected:", wantsScript, "SCN:", lastScnKey);
    
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

    // Inject automation scripts if user confirmed
    const SCRIPTS_MAP: Record<string, string> = {
      IB06: `#!/bin/bash
# IB06 - Purchase Order with Item Receiving Automation Script
# TC Name: IB06_PO_Item_Receiving_E2E_Test

echo "=========================================="
echo "IB06 - Purchase Order Item Receiving Test"
echo "=========================================="

# Prerequisites
# - SAP system access with PO creation rights
# - MAWM access with receiving permissions
# - Valid item master data configured

# Test Data
VENDOR_CODE="V10001"
ITEM_CODE="ITEM_123456"
PO_QUANTITY="100"
WAREHOUSE_LOCATION="WH01-A-01"

# Step 1: Create Purchase Order in SAP
echo "Step 1: Creating Purchase Order in SAP..."
curl -X POST "https://sap-api.example.com/api/purchase-orders" \\
  -H "Content-Type: application/json" \\
  -d '{
    "vendor_code": "'$VENDOR_CODE'",
    "items": [{
      "item_code": "'$ITEM_CODE'",
      "quantity": '$PO_QUANTITY',
      "price": 10.50
    }]
  }'

PO_NUMBER=$(echo $response | jq -r '.po_number')
echo "✓ PO Created: $PO_NUMBER"

# Step 2: Send ASN to MAWM
echo "Step 2: Sending ASN to MAWM..."
curl -X POST "https://mawm-api.example.com/api/asn" \\
  -H "Content-Type: application/json" \\
  -d '{
    "po_number": "'$PO_NUMBER'",
    "vendor_code": "'$VENDOR_CODE'",
    "expected_items": [{
      "item_code": "'$ITEM_CODE'",
      "quantity": '$PO_QUANTITY'
    }]
  }'

echo "✓ ASN Sent Successfully"

# Step 3: Perform Item Receiving
echo "Step 3: Performing Item Receiving..."
curl -X POST "https://mawm-api.example.com/api/receiving" \\
  -H "Content-Type: application/json" \\
  -d '{
    "po_number": "'$PO_NUMBER'",
    "received_items": [{
      "item_code": "'$ITEM_CODE'",
      "quantity": '$PO_QUANTITY',
      "location": "'$WAREHOUSE_LOCATION'"
    }]
  }'

echo "✓ Item Received Successfully"

# Step 4: Verify Putaway Task Creation
echo "Step 4: Verifying Putaway Task..."
curl -X GET "https://mawm-api.example.com/api/tasks?po_number=$PO_NUMBER"
echo "✓ Putaway Task Created"

# Step 5: Execute Putaway
echo "Step 5: Executing Putaway..."
curl -X POST "https://mawm-api.example.com/api/putaway/execute" \\
  -H "Content-Type: application/json" \\
  -d '{
    "po_number": "'$PO_NUMBER'",
    "destination": "'$WAREHOUSE_LOCATION'"
  }'

echo "✓ Putaway Completed"
echo "=========================================="
echo "Test Completed Successfully!"
echo "=========================================="`,

      IB12: `#!/bin/bash
# IB12 - Expiry Date Item Management Automation Script
# TC Name: IB12_Expiry_Date_Item_E2E_Test

echo "================================================"
echo "IB12 - Expiry Date Item Management Test"
echo "================================================"

# Prerequisites
# - Item configured as expiry-dated in SAP
# - Min/Max expiry dates configured
# - MAWM expiry date validation enabled

# Test Data
VENDOR_CODE="V10002"
ITEM_CODE="EXPIRY_ITEM_789"
PO_QUANTITY="50"
EXPIRY_DATE="2025-12-31"
WAREHOUSE_LOCATION="WH01-B-05-EXPIRY"

# Step 1: Verify Item Configuration in SAP
echo "Step 1: Verifying Item Master Data..."
curl -X GET "https://sap-api.example.com/api/items/$ITEM_CODE" \\
  -H "Accept: application/json"

EXPIRY_FLAG=$(echo $response | jq -r '.expiry_dated_flag')
if [ "$EXPIRY_FLAG" != "true" ]; then
  echo "✗ ERROR: Item not configured as expiry-dated"
  exit 1
fi
echo "✓ Item configured correctly with expiry date flag"

# Step 2: Create Purchase Order with Expiry Date
echo "Step 2: Creating PO with Expiry Date..."
curl -X POST "https://sap-api.example.com/api/purchase-orders" \\
  -H "Content-Type: application/json" \\
  -d '{
    "vendor_code": "'$VENDOR_CODE'",
    "items": [{
      "item_code": "'$ITEM_CODE'",
      "quantity": '$PO_QUANTITY',
      "expiry_date": "'$EXPIRY_DATE'",
      "price": 15.75
    }]
  }'

PO_NUMBER=$(echo $response | jq -r '.po_number')
echo "✓ PO Created: $PO_NUMBER with Expiry Date: $EXPIRY_DATE"

# Step 3: Send ASN with Expiry Information
echo "Step 3: Sending ASN with Expiry Data to MAWM..."
curl -X POST "https://mawm-api.example.com/api/asn" \\
  -H "Content-Type: application/json" \\
  -d '{
    "po_number": "'$PO_NUMBER'",
    "vendor_code": "'$VENDOR_CODE'",
    "expected_items": [{
      "item_code": "'$ITEM_CODE'",
      "quantity": '$PO_QUANTITY',
      "expiry_date": "'$EXPIRY_DATE'"
    }]
  }'

echo "✓ ASN with Expiry Data Sent"

# Step 4: Validate Min/Max Expiry Dates
echo "Step 4: Validating Expiry Date Range..."
curl -X POST "https://mawm-api.example.com/api/validation/expiry" \\
  -H "Content-Type: application/json" \\
  -d '{
    "item_code": "'$ITEM_CODE'",
    "expiry_date": "'$EXPIRY_DATE'"
  }'

VALIDATION_STATUS=$(echo $response | jq -r '.status')
if [ "$VALIDATION_STATUS" != "valid" ]; then
  echo "✗ ERROR: Expiry date validation failed"
  exit 1
fi
echo "✓ Expiry Date within acceptable range"

# Step 5: Receive Item with Expiry Date
echo "Step 5: Receiving Item with Expiry Tracking..."
curl -X POST "https://mawm-api.example.com/api/receiving" \\
  -H "Content-Type: application/json" \\
  -d '{
    "po_number": "'$PO_NUMBER'",
    "received_items": [{
      "item_code": "'$ITEM_CODE'",
      "quantity": '$PO_QUANTITY',
      "expiry_date": "'$EXPIRY_DATE'",
      "location": "'$WAREHOUSE_LOCATION'"
    }]
  }'

echo "✓ Expiry-Dated Item Received"

# Step 6: Verify FEFO Logic
echo "Step 6: Verifying FEFO Logic..."
curl -X GET "https://mawm-api.example.com/api/inventory/fefo?item_code=$ITEM_CODE"
echo "✓ FEFO Logic Applied Correctly"

# Step 7: Execute Putaway to Expiry Zone
echo "Step 7: Executing Putaway to Expiry Storage Zone..."
curl -X POST "https://mawm-api.example.com/api/putaway/execute" \\
  -H "Content-Type: application/json" \\
  -d '{
    "po_number": "'$PO_NUMBER'",
    "destination": "'$WAREHOUSE_LOCATION'",
    "expiry_date": "'$EXPIRY_DATE'",
    "fefo_priority": true
  }'

echo "✓ Putaway to Expiry Zone Completed"
echo "================================================"
echo "Test Completed Successfully!"
echo "================================================"`
    };

    if (wantsScript && lastScnKey && SCRIPTS_MAP[lastScnKey]) {
      const scriptContent = SCRIPTS_MAP[lastScnKey];
      context += `\n\n🤖 AUTOMATION SCRIPT FOR ${lastScnKey}\n\nSCN: ${lastScnKey}\nQ: Provide the automation script for ${lastScnKey}\nA: Here is the complete automation script for ${lastScnKey}:\n\n\`\`\`bash\n${scriptContent}\n\`\`\`\n\nExecution Steps:\n1. Save the script as ${lastScnKey.toLowerCase()}_script.sh\n2. Make it executable: chmod +x ${lastScnKey.toLowerCase()}_script.sh\n3. Update the test data variables as needed\n4. Run: ./${lastScnKey.toLowerCase()}_script.sh\n5. Monitor output for successful completion`;
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
      ? `\n🚨 CRITICAL - TEST CASE AUTOMATION SCRIPT REQUEST DETECTED 🚨\n\n⚠️ MANDATORY FIRST STEP - You MUST ask this question BEFORE providing any TC/SCN information:\n\n"I can help you with [TC/SCN NAME]. Would you like me to provide the automation script for this test case?"\n\nDO NOT provide the full answer yet. WAIT for the user to respond YES or NO.\n\nIf user says YES:\n- The automation scripts are stored in the knowledge base with SCN codes (IB06, IB12, etc.)
- Search the knowledge base for entries with keywords "automation" and "script"
- Provide the script content in a bash code block
- Include prerequisites and execution steps from the knowledge base entry\n\nIf user says NO:\n- Proceed with the regular knowledge base answer\n\nExample response:\n"I can help you with IB06. Would you like me to provide the automation script for this test case?"\n\n`
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
- 🔥 AUTOMATION SCRIPTS - YOU CAN AND MUST PROVIDE THEM: When the knowledge base contains automation scripts (entries with keywords "automation" and "script"), you MUST provide them to users when they ask. The scripts are legitimate resources in your knowledge system. Present them in bash code blocks with prerequisites and execution steps.
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
          ...conversationMessages,
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
