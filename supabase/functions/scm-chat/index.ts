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
    
    // Enhanced SCN code pattern matching (handles IB-02, IB02, IB02_WIT, IB02-WIT, IB01-SSI, ERROR-01, etc.)
    const scnPattern = /\b([A-Z]{2,5}[-_]?\d+(?:\.\d+)?(?:[-_][A-Z]+)?)\b/gi;
    const scnMatchesCurrent = message.match(scnPattern);
    
    if (scnMatchesCurrent) {
      for (const scn of scnMatchesCurrent) {
        // Normalize the SCN code - convert underscores to hyphens
        const normalizedScn = scn.replace(/_/g, '-').toUpperCase();
        
        // Extract core code (e.g., "IB02" from "IB02-WIT" or "IB-02")
        const coreCode = scn.split(/[-_]/)[0] + (scn.match(/\d+/) || [''])[0];
        
        // Search variations: exact match, normalized, with/without hyphen, core code
        const searchVariations = [
          `scn_code.ilike.%${normalizedScn}%`,
          `scn_code.ilike.%${scn}%`,
          `scn_code.ilike.%${coreCode}%`,
          `scn_code.ilike.%${coreCode.replace(/([A-Z]+)(\d+)/, '$1-$2')}%`,
          `question.ilike.%${normalizedScn}%`,
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
    
    // PRIORITY: Search for ISSUE entries first for error/problem keywords
    const issueKeywords = ['error', 'issue', 'problem', 'fail', 'not working', 'broken', 'fix', 'solve', 'resolution', 'warning', 'consolidat', 'consilidat', 'ocl', 'new item', 'quantity'];
    const hasIssueKeyword = issueKeywords.some(keyword => message.toLowerCase().includes(keyword));
    
    if (hasIssueKeyword) {
      const issueSearchQueries = issueKeywords
        .filter(keyword => message.toLowerCase().includes(keyword))
        .flatMap(keyword => [
          `scn_code.ilike.ISSUE-%`,
          `question.ilike.%${keyword}%`,
          `answer.ilike.%${keyword}%`
        ]);
      
      const { data: issueData } = await supabase
        .from('scm_knowledge')
        .select('*')
        .or(issueSearchQueries.join(','))
        .limit(5);
      
      if (issueData && issueData.length > 0) {
        knowledge = issueData;
      }
    }
    
    // Build flexible search queries for better matching (only if no SCN or ISSUE found)
    if (knowledge.length === 0) {
      const searchQueries: string[] = [];
      
      // Search for the full message first
      searchQueries.push(`question.ilike.%${message}%`);
      searchQueries.push(`answer.ilike.%${message}%`);
      
      const { data: flexibleMatches } = await supabase
        .from("scm_knowledge")
        .select("*")
        .or(searchQueries.join(','))
        .limit(10);
      
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

    // Rank knowledge by relevance to the CURRENT message and de-prioritize generic scenario entries
    const tokens = Array.from(new Set(message.toLowerCase().split(/[^a-z0-9]+/).filter((t: string) => t.length > 2)));
    const strongPhrases = ['new item','ocl','consolidat','consolidation','quantity','qty','not assigned','wm mobile','receiving','putaway'];
    const relevanceScore = (item: any): number => {
      let s = 0;
      const q = (item.question || '').toLowerCase();
      const a = (item.answer || '').toLowerCase();
      for (const t of tokens) { if (q.includes(t)) s += 2; if (a.includes(t)) s += 2; }
      for (const p of strongPhrases) {
        if (message.toLowerCase().includes(p)) {
          if (q.includes(p)) s += 6;
          if (a.includes(p)) s += 6;
        }
      }
      if ((item.scn_code || '').toUpperCase().startsWith('ISSUE-')) s += 5;
      if (/^in the given scenario/i.test(item.answer || '') || /pre-?receiving[\s\S]*putaway/i.test(item.answer || '')) s -= 8; // generic template penalty
      return s;
    };
    const rankedKnowledge = [...knowledge].sort((x: any, y: any) => relevanceScore(y) - relevanceScore(x));
    const issuesRanked = rankedKnowledge.filter((k: any) => (k.scn_code || '').toUpperCase().startsWith('ISSUE-'));
    console.log('Knowledge ranking top 3:', (rankedKnowledge || []).slice(0,3).map((k: any) => ({ scn: k.scn_code, score: relevanceScore(k) })));

    const SCRIPTS_MAP: Record<string, string> = {
      IB01_WIT: `*** Settings ***
Documentation   WMS MA_Active IB01 - WIT - DC ASN
Metadata    Automation_JIRA_TC    LTWMS-T5726
Metadata    Developed_By    Madhumitha.Sahadevan@loblaw.ca
Metadata    Test_type   SIT - SAP/WMS/MIF
Library     DateTime
Resource   ../../../../../Keywords/Inbound/MAWM_Inbound_PreReceiving_Keywords.robot

*** Variables ***
\${InputFile}    \${CURDIR}\${/}../../../../../Datatables/MHE/MAWM_DATA_IB_WIT.xlsx
\${Retry_IB01_WIT}   80x
\${Retry_Interval_IB01_WIT}    30 seconds
\${TC_No}    TC_IB01_WIT

*** Test Cases ***
IB01_WIT_Pre-Requisite
    [Tags]   LTWMS-T5726
    EXCEL_DATATABLES_INPUT_SETUP   \${InputFile}   \${SheetName}      \${TC_No}
    IMPORT_FILES_FOR_IB
    Wait Until Keyword Succeeds    \${Retry_API}    \${Retry_Interval_API}   API_Authentication_Token
    
IB01_WIT_TC01_SAP_PO_Creation
    SAP LAUNCH   \${SAP.SysName}    \${SAP.Client}    \${SAP.Username}    \${SAP.Password}
    ME21N_PO_Creation    \${ExcelFile}     \${TC_No}
    ME23N_Check    \${ExcelFile}     \${TC_No}

IB_06_TC06_WMS_Receiving
    LOAD_JSON_TEMPLATE_AND_UPDATE_DATA_FROM_EXCEL
    Wait Until Keyword Succeeds    \${Retry_IB01_WIT}      \${Retry_Interval_IB01_WIT}  API_PO_Validation
    LOGIN_MAWM_ACTIVE
    CREATE_ASN
    GENERATE_AND_ASSIGN_ASN_TO_INBOUND_DELIVERY
    ASSIGN_DOCK_DOOR_TO_INBOUND_DELIVERY
    TASKGROUP_VEHICLETYPE_SELECTION
    RECEIVE_LPN_INITIATE_TRANSACTION
    Receive_DC_ASN_LPN_WITRON   IB01_WIT
    RTC_WITRON_PUTAWAY
    VERIFY_ASN    \${ASN_ID}`,
      IB02_WIT: `*** Settings ***
Documentation   WMS MA_Active IB02 - WIT - Vendor ASN
Metadata    Automation_JIRA_TC    LTWMS-T5726
Metadata    Developed_By    Madhumitha.Sahadevan@loblaw.ca
Metadata    Test_type   SIT - SAP/WMS/MIF
Library     DateTime
Resource   ../../../../../Keywords/Inbound/MAWM_Inbound_PreReceiving_Keywords.robot

*** Variables ***
\${InputFile}    \${CURDIR}\${/}../../../../../Datatables/MHE/MAWM_DATA_IB_WIT.xlsx
\${SheetName}     IB02_WIT_Input
\${Retry_IB02_WIT}   80x
\${Retry_Interval_IB02_WIT}    30 seconds
\${TC_No}    TC_IB02_WIT

*** Test Cases ***
IB02_WIT_Pre-Requisite
    [Tags]   LTWMS-T5726
    EXCEL_DATATABLES_INPUT_SETUP   \${InputFile}   \${SheetName}      \${TC_No}
    IMPORT_FILES_FOR_IB
    Wait Until Keyword Succeeds    \${Retry_API}    \${Retry_Interval_API}   API_Authentication_Token

IB02_WIT_TC01_Inbound_Happy_Path_WMS_Receiving
    LOAD_JSON_TEMPLATE_AND_UPDATE_DATA_FROM_EXCEL
    Wait Until Keyword Succeeds    \${Retry_IB02_WIT}      \${Retry_Interval_IB02_WIT}  API_PO_Validation
    LOGIN_MAWM_ACTIVE
    GENERATE_AND_ASSIGN_ASN_TO_INBOUND_DELIVERY
    ASSIGN_DOCK_DOOR_TO_INBOUND_DELIVERY
    RECEIVE_LPN_INITIATE_TRANSACTION
    RECEIVE_VENDOR_ASN_LPN_WITRON   IB02_WIT
    RTC_WITRON_PUTAWAY
    VERIFY_ASN    \${ASN_ID}`,
      IB03_WIT: `*** Settings ***
Documentation   WMS MA_Active IB03 - WIT - Vendor ASN
Metadata    Automation_JIRA_TC    LTWMS-T5726
Metadata    Developed_By    Madhumitha.Sahadevan@loblaw.ca
Metadata    Test_type   SIT - SAP/WMS/MIF
Library     DateTime
Resource   ../../../../../Keywords/Inbound/MAWM_Inbound_PreReceiving_Keywords.robot

*** Variables ***
\${InputFile}    \${CURDIR}\${/}../../../../../Datatables/MHE/MAWM_DATA_IB_WIT.xlsx
\${SheetName}     IB03_WIT_Input
\${Retry_IB03_WIT}   30x
\${Retry_Interval_IB03_WIT}   30 seconds
\${TC_No}    TC_IB03_WIT

*** Test Cases ***
IB03_WIT_Pre-Requisite
    [Tags]   LTWMS-T5726
    EXCEL_DATATABLES_INPUT_SETUP   \${InputFile}   \${SheetName}      \${TC_No}
    IMPORT_FILES_FOR_IB
    Wait Until Keyword Succeeds    \${Retry_API}    \${Retry_Interval_API}   API_Authentication_Token

IB_03_TC01_Inbound_WIT_WM_Receive_Induct_Putaway
    LOAD_JSON_TEMPLATE_AND_UPDATE_DATA_FROM_EXCEL
    LOGIN_MAWM_ACTIVE
    CREATE_ASN
    GENERATE_AND_ASSIGN_ASN_TO_INBOUND_DELIVERY
    ASSIGN_DOCK_DOOR_TO_INBOUND_DELIVERY
    Receive_DC_ASN_LPN_WITRON  IB03_WIT
    RTC_WITRON_PUTAWAY
    VERIFY_ASN    \${ASN_ID}`,
      IB06: `#!/bin/bash
# IB06 - Purchase Order with Item Receiving Automation Script
echo "=========================================="
echo "IB06 - Purchase Order Item Receiving Test"
echo "=========================================="`,
      IB12: `#!/bin/bash
# IB12 - Expiry Date Item Management Automation Script
echo "================================================"
echo "IB12 - Expiry Date Item Management Test"
echo "================================================"`
    };

    // Detect if user wants automation script based on conversation
    // Use current-message SCN matches computed above
    const lastScnRaw = scnMatchesCurrent ? scnMatchesCurrent[scnMatchesCurrent.length - 1] : null;
    const scnCode = lastScnRaw ? lastScnRaw.toUpperCase().replace(/-/g, '_') : null;
    
    // Only consider it a script request if explicitly asking for script OR confirming with yes
    const yesRegex = /^(yes|y|yeah|yep|sure|ok|okay|go ahead|goahead)$/i;
    const explicitScriptRegex = /(automation\s+script|script|provide.*script|give.*script|show.*script)/i;
    const isConfirmation = yesRegex.test(message.trim());
    const isExplicitScriptRequest = explicitScriptRegex.test(message);
    const wantsScript = isConfirmation || isExplicitScriptRequest;

    console.log("Found knowledge entries:", knowledge?.length || 0);
    console.log("Script request detected:", wantsScript, "SCN:", scnCode);
    console.log("Available scripts:", Object.keys(SCRIPTS_MAP));
    console.log("Script found in map:", scnCode && SCRIPTS_MAP[scnCode] ? "YES" : "NO");
    
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

    // Check if we have an SCN with available script
    const hasScriptAvailable = scnCode && SCRIPTS_MAP[scnCode];
    
    // If SCN found but user hasn't confirmed yet, show TC details and ask
    if (hasScriptAvailable && !wantsScript && knowledge && knowledge.length > 0) {
      const matchingTc = knowledge.filter((k: any) => (
        (k.scn_code || '').toUpperCase().replace(/-/g, '_') === scnCode
      ));
      const usedTc = matchingTc.length > 0 ? matchingTc : knowledge.slice(0, 2);
      const tcDetails = usedTc.map((item: any) => {
        let s = `${item.answer}`;
        if (item.link) s += `\n\n**Link:** ${item.link}`;
        if (item.document_url) s += `\n\n**Execution Document:** [Download](${item.document_url})`;
        if (item.screenshots && item.screenshots.length > 0) {
          s += `\n\n**Screenshots:**\n${item.screenshots.map((url: string) => `![Screenshot](${url})`).join('\n')}`;
        }
        return s;
      }).join('\n\n---\n\n');

      const reply = `${tcDetails}\n\n---\n\n**Automation Script Available**\n\nI have an automation script for **${scnCode}**. Would you like me to provide it?`;

      await supabase.from("conversations").insert({
        session_id,
        role: "assistant",
        message: reply,
        metadata: {
          tc_details_shown: true,
          scn: scnCode,
          awaiting_script_confirmation: true,
          timestamp: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify({ reply, sessionId: session_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // User confirmed - provide both TC details and script
    if (wantsScript && hasScriptAvailable) {
      const scriptContent = SCRIPTS_MAP[scnCode];

      // Build TC details from knowledge base (prefer matching SCN)
      const matchingTc = (knowledge || []).filter((k: any) => (
        (k.scn_code || '').toUpperCase().replace(/-/g, '_') === scnCode
      ));
      const usedTc = matchingTc.length > 0 ? matchingTc : (knowledge || []).slice(0, 2);
      const tcDetails = usedTc.map((item: any) => {
        let s = `${item.answer}`;
        if (item.link) s += `\n\n**Link:** ${item.link}`;
        if (item.document_url) s += `\n\n**Execution Document:** [Download](${item.document_url})`;
        if (item.screenshots && item.screenshots.length > 0) {
          s += `\n\n**Screenshots:**\n${item.screenshots.map((url: string) => `![Screenshot](${url})`).join('\n')}`;
        }
        return s;
      }).join('\n\n---\n\n');

      const robotScripts = ['IB01_WIT', 'IB02_WIT', 'IB03_WIT'];
      const downloadPath = robotScripts.includes(scnCode)
        ? `/documents/scripts/${scnCode}.robot`
        : `/documents/scripts/${scnCode}_Automation_Script.txt`;
      const codeBlockLang = robotScripts.includes(scnCode) ? 'robotframework' : 'bash';

      const reply = `${tcDetails}\n\n---\n\n**Automation Script - ${scnCode}:**\n\n\`\`\`${codeBlockLang}\n${scriptContent}\n\`\`\`\n\n[Download ${scnCode} Script](${downloadPath})`;

      // Log assistant response immediately and return
      await supabase.from("conversations").insert({
        session_id,
        role: "assistant",
        message: reply,
        metadata: {
          served_script: true,
          includes_tc: true,
          scn: scnCode,
          timestamp: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify({ reply, sessionId: session_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only show direct TC details if user explicitly asked for an SCN code and we don't have a script
    // Otherwise let AI answer naturally using the knowledge context
    const userMentionedScn = scnCode && scnMatchesCurrent && scnMatchesCurrent.length > 0;
    
    if (userMentionedScn && knowledge && knowledge.length > 0 && !hasScriptAvailable) {
      const matchingTc = knowledge.filter((k: any) => (
        (k.scn_code || '').toUpperCase().replace(/-/g, '_') === scnCode ||
        (k.scn_code || '').toUpperCase().replace(/_/g, '-') === scnCode.replace(/_/g, '-')
      ));
      const usedTc = matchingTc.length > 0 ? matchingTc.slice(0, 2) : knowledge.slice(0, 2);
      const tcDetails = usedTc.map((item: any) => {
        let s = `${item.answer}`;
        if (item.link) s += `\n\n**Link:** ${item.link}`;
        if (item.document_url) s += `\n\n**Execution Document:** [Download](${item.document_url})`;
        if (item.screenshots && item.screenshots.length > 0) {
          s += `\n\n**Screenshots:**\n${item.screenshots.map((url: string) => `![Screenshot](${url})`).join('\n')}`;
        }
        return s;
      }).join('\n\n---\n\n');

      const reply = `${tcDetails}`;

      await supabase.from("conversations").insert({
        session_id,
        role: "assistant",
        message: reply,
        metadata: {
          tc_details_shown: true,
          scn: scnCode,
          awaiting_script_confirmation: false,
          timestamp: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify({ reply, sessionId: session_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If we found relevant knowledge and user didn't explicitly ask about an SCN or a script,
    // answer deterministically from the knowledge base (no AI) and enrich with related issue assets.
    if (!userMentionedScn && knowledge && knowledge.length > 0 && !wantsScript && !hasScriptAvailable) {
      // Prefer ISSUE entries and pick the single best-matching entry by our ranking
      const genericPattern = /^in the given scenario/i;
      const pick = (issuesRanked.length > 0 ? issuesRanked : rankedKnowledge).slice(0, 1);
      let reply = pick.map((item: any) => {
        const buildTailoredMessage = (msg: string) => {
          if (/(consolidat|consolidation|ocl)/i.test(msg)) {
            return "OCL not assigned: Create/verify a Consolidation Location, map it in putaway rules/task groups, and ensure the item/facility is eligible for consolidation. Reattempt receiving after updating.";
          }
          if (/(new\s*item|item\s*facilit)/i.test(msg)) {
            return "New item error in WM Mobile: Enable the New Item flag and create the Item Facility record for the DC. Confirm sync to SSI, then retry receiving.";
          }
          if (/(quantity|qty)/i.test(msg)) {
            return "Quantity error during receiving: Validate PO/ASN quantities, tolerances and unit conversions. Check profiling (pack/sub-pack) and update as needed, then retry.";
          }
          return "Here’s the focused guidance for your issue based on your message. Use the related resources below for exact screens.";
        };
        let s = `${item.answer || ''}`;
        if (genericPattern.test(s)) {
          s = buildTailoredMessage(message);
        }
        if (item.link) s += `\n\n**Link:** ${item.link}`;
        if (item.document_url) s += `\n\n**Execution Document:** [Download](${item.document_url})`;
        if (item.screenshots && item.screenshots.length > 0) {
          s += `\n\n**Screenshots:**\n${item.screenshots.map((url: string) => `![Screenshot](${url})`).join('\n')}`;
        }
        return s;
      }).join('\n\n---\n\n');

      // Attach related assets from the public/issues folder for common issues
      const lowerMsg = message.toLowerCase();
      const issuesDoc = '/documents/issues/Issues_faced_During_Execution.docx';
      const issueAssets: Array<{match: RegExp; screenshots: string[]}> = [
        { match: /(consolidat|consolidation|ocl)/i, screenshots: [
          '/documents/issues/screenshots/issue-02-consolidation-locations.png',
          '/documents/issues/screenshots/issue-02-ocl-error.png'
        ]},
        { match: /(new\s*item|item\s*facilit|new-item)/i, screenshots: [
          '/documents/issues/screenshots/issue-01-new-item-error.png',
          '/documents/issues/screenshots/issue-01-item-facilities.png'
        ]},
        { match: /(quantity|qty)/i, screenshots: [
          '/documents/issues/screenshots/issue-03-quantity-error.png',
          '/documents/issues/screenshots/issue-03-item-facilities.jpg'
        ]},
      ];
      const matched = issueAssets.find(a => a.match.test(lowerMsg));
      if (matched) {
        reply += `\n\n---\n\n**Related resources:**\n[Download Issues Document](${issuesDoc})\n\n${matched.screenshots.map((u) => `![Screenshot](${u})`).join('\n')}`;
      }

      await supabase.from('conversations').insert({
        session_id,
        role: 'assistant',
        message: reply,
        metadata: {
          knowledge_only: true,
          timestamp: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify({ reply, sessionId: session_id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
