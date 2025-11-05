*** Settings ***
Documentation   WMS MA_Active IB03 - WIT - Vendor ASN
...             Putaway is handled in the different Automation scenario
Metadata    Automation_JIRA_TC    LTWMS-T5726
Metadata    Developed_By    Madhumitha.Sahadevan@loblaw.ca
Metadata    Test_type   SIT - SAP/WMS/MIF
Metadata    MHE Type    SSI/WIT/CON
Library     DateTime
Library     DataParameterization
Library     BuiltIn
Resource   ../../../../../Keywords/Inbound/MAWM_Inbound_PreReceiving_Keywords.robot
Resource   ../../../../../Keywords/Common/MAWM_Common_Keywords.robot
Resource   ../../../../../Keywords/MHE/SSI/MHE_API_Keywords.robot
Resource   ../../../../../Keywords/MHE/SSI/IB_MHE_Keywords.robot
Resource   ../../../../../Keywords/MHE/SSI/IC_MHE_API_Keywords.robot
Suite Setup    Force_Close_SAP
Suite Teardown   Run keywords   Close browser  AND  Force_Close_SAP

*** Variables ***
${InputFile}    ${CURDIR}${/}../../../../../Datatables/MHE/MAWM_DATA_IB_WIT.xlsx
${SheetName}     IB03_WIT_Input
#Retry_IB is the variable called in the wait until keyword success which retries that much times until the keyword becomes successfull
#Retry Interval provides the interval time for each try
${Retry_IB03_WIT}   30x
${Retry_Interval_IB03_WIT}   30 seconds
#The time taken for PIX generation is higher compared to other validation therefore separate variable with extraretry is maintained
${Retry_IB03_WIT_PIX}   25x
${Retry_Interval_IB03_WIT_PIX}    30 seconds
#Retry to achieve API Authentication error
${Retry_API}   5x
${Retry_Interval_API}    5 seconds
${TC_No}    TC_IB03_WIT
${DummyMixed_ItemId}    DMYMXD
*** Test Cases ***

IB03_WIT_Pre-Requisite
    [Tags]   LTWMS-T5726
    [Documentation]  This Keyword validates the Pre-req requirement for IB
    [Teardown]    Run keyword if test failed  Fatal Error  "TC Failed in Pre-Requisite Validation"
    EXCEL_DATATABLES_INPUT_SETUP   ${InputFile}   ${SheetName}      ${TC_No}
    #This keyword Imports all necessary resources/variables required for IB execution
    IMPORT_FILES_FOR_IB
    Wait Until Keyword Succeeds    ${Retry_API}    ${Retry_Interval_API}   API_Authentication_Token
    SETUPSCREENSHOT&DOWNLOADSDIRECTORY&INITIATE_CHROME_DRIVER
    Comment  MOD - API - Validate Dock Door Status - Checks the Door Availability and make it available
    Wait Until Keyword Succeeds    ${Retry_API}      ${Retry_Interval_API}   API_DOCKDOOR_AVAILABILITY
    #API Pre Validation
#    API_IB/IC_PRE-REQUISITE_VALIDATION

IB_03_TC01_Inbound_Happy_Path_SAP_PO_Creation
    [Documentation]    SAP PO Creation and Validation
    [Teardown]   Run keywords   CLOSE SAP    AND  Run keyword if test failed  Fatal Error  "SAP PO Creation TC failed"
    Comment  MOD - SAP - Launch SAP
      SAP LAUNCH   ${SAP.SysName}    ${SAP.Client}    ${SAP.Username}    ${SAP.Password}
    Comment  MOD - SAP - PO Creation
      ME21N_PO_Creation    ${ExcelFile}     ${TC_No}
    Comment  MOD - SAP - Validate PO
      #Read from excel data again, after PO number is written in Excel
      EXCEL_DATATABLES_INPUT_SETUP   ${InputFile}   ${SheetName}      ${TC_No}
      ME23N_Check    ${ExcelFile}     ${TC_No}


IB_03_TC01_Inbound_WIT_WM_Receive/Induct/Putaway Mixed Sku pallet (DMYMXD) via Case Induction to Tray Warehouse
   [Documentation]  WMS happy path receiving DC ASN Scenario Single IB order is created with any no.of articles can be handled.
   [Teardown]   Run keywords   Log_Json_Object
    Comment  MOD- Pre - Requisite - Load JSON Object
       LOAD_JSON_TEMPLATE_AND_UPDATE_DATA_FROM_EXCEL
    Comment  MOD - API - Purchase Order & OrderLine Validation - After PO Creation
       Wait Until Keyword Succeeds    ${Retry_IB03_WIT}      ${Retry_Interval_IB03_WIT}  API_PO_Validation  ${POSearch.Query}${ExcelData[1].V_PO_Number}[0]  ${POSearch.URL}  ${PurchaseOrder_Status.Initial}
       Wait Until Keyword Succeeds    ${Retry_IB03_WIT}      ${Retry_Interval_IB03_WIT}  API_POLine_Validation  ${POSearch.Query}${ExcelData[1].V_PO_Number}[0]   ${POLine.URL}    ${PO_Status_API}
    Comment  MOD - API - Pre -Item Inventory Validation - Before Receiving
       ${Item_Inv_Pre}   API_Item_Inventory_Validation   Pre
    Comment  MOD - UI - Login MAWM - Supervisor Access
       LOGIN_MAWM_ACTIVE  ${LoginCredentials.Supervisor_UserName.${ExcelData[1].V_Site}[0]}    ${LoginCredentials.Supervisor_Password.${ExcelData[1].V_Site}[0]}
    Comment  MOD - UI - Create ASN from PO and assign PO
      CREATE_ASN
    Comment  MOD - API - ASN Validation - After ASN Creation
        Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_ASN_Validation    ${ASNs_Status.Initial_API}
    Comment  MOD - UI - Generate Inbound Delivery and Assign ASN to Inbound Delivery
        GENERATE_AND_ASSIGN_ASN_TO_INBOUND_DELIVERY
    Comment  MOD - API - Inbound Delivery Validation - Post Inbound Delivery Creation
        Wait Until Keyword Succeeds    ${Retry_IB03_WIT}      ${Retry_Interval_IB03_WIT}  API_INBOUND_DELIVERY_STATUS   ${IBDelivery_Status.Initial}
    Comment  MOD - UI  - Assign Dock door to Inbound Delivery
        ASSIGN_DOCK_DOOR_TO_INBOUND_DELIVERY
    Comment  MOD - API - Item Inventory validation - Pre - Validation
        ${WM_Item_Inv_Before_Induction_DMYItem}   API_Item_Inventory_Validation_Inventory_Control   ${DummyMixed_ItemId}   None
    Comment  MOD - UI - Navigate to WM Mobile Menu
        NAVIGATE TO WM MOBILE MENU
    Comment  MOD - WM Mobile - Navigate to WM Mobile Menu
        WITRON_RECEIVE_INDUCT_DUMMY   ${DummyMixed_ItemId}
    Comment  MOD - API - MHE Journal message
       Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}   API_WITRON_RTU_VALIDATION
    Comment  MOD - API- Putaway for Witron
        RTC_WITRON_PUTAWAY
    Comment  MOD - API - Dummy -LPN -Validation
       Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_LPN_Validation_IC_MHE     WIT    IB03_WIT   Consume_ILPN
    Comment  MOD - API - Item Inventory validation - After Witron Putaway for DMYMXD
        Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}   WMS_Inventory_Comparison_Validation_IB_MHE  ${DummyMixed_ItemId}   ${WM_Item_Inv_Before_Induction_DMYItem}    Add
   Comment  MOD - API - MHE Journal message for putaway
        Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_MHE_Journal_Entry_Search_Post   JournalEntry_MessageSearch   ${ILPN}   ${MHE_SSI.RTC}
   Comment  MOD - WM Mobile - Witron - Receiving
      Receive_DC_ASN_LPN_WITRON  IB03_WIT
   Comment  MOD - API - RTU message Validation
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}   API_WITRON_RTU_VALIDATION
   Comment  MOD - API -Witron - Post RTC message - Putaway
      RTC_WITRON_PUTAWAY    IB03_WIT
   Comment  MOD - API - Purchase Order & Orderline Validation -After Receiving
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}   API_PO_Validation  ${POSearch.Query}${ExcelData[1].V_PO_Number}[0]  ${POSearch.URL}   ${PurchaseOrder_Status.AfterReceiving}
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_POLine_Validation  ${POSearch.Query}${ExcelData[1].V_PO_Number}[0]   ${POLine.URL}    ${PO_Status_API}
   Comment  MOD - API- ASN Validation - After Receiving
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_ASN_Validation    ${ASNs_Status.AfterReceiving}
   Comment  MOD - API- LPN Validation- After Receiving
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_LPN_Validation   WIT   IB   Consume_LPN
   Comment  MOD - API - Inbound Delivery Validation - After Receiving
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_INBOUND_DELIVERY_STATUS   ${IBDelivery_Status.AfterReceiving}    IB03_WIT
   Comment  MOD - API- Pix Validation - After receiving
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT_PIX}    ${Retry_Interval_IB03_WIT_PIX}  API_PIX_Transaction_Validation  ${PIXValidation.AfterReceiving}   MHE
   Comment  MOD - UI - Verify ASN
      VERIFY_ASN    ${ASN_ID}
   Comment  MOD - API- LPN Validation-After Verify ASN
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_LPN_Validation   WIT   IB
   Comment   MOD - API-  Pix Validation - After Verify ASN
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT_PIX}    ${Retry_Interval_IB03_WIT_PIX}      API_PIX_Transaction_Validation  ${PIXValidation.AfterVerifyASN}
   Comment   MOD - MIF-  Pix Validation - After Verify ASN
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}      ${Retry_Interval_IB03_WIT}  PIX_Data_Validation_Through_MIF_VERIFY_ASN
   Comment  MOD - API - MIF - Vendor ASN  - Good Receipt pix Validation
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}      ${Retry_Interval_IB03_WIT}  API_PIX_Validation_Verify_ASN_Good_receipt
   Comment  MOD - API - PIX - Vendor ASN  - Good Receipt pix Validation
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}      ${Retry_Interval_IB03_WIT}  PIX_Data_Validation_Through_MIF_Good_Receipt
   Comment  MOD - API- ASN Validation- After Verify ASN
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}  API_ASN_Validation    ${ASNs_Status.AfterVerifyASN}   ${MHE_SSI.Vendor_ASN}   WIT
   Comment  MOD - API - Purchase Order & Orderline Validation - After ASN Verification
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}   API_PO_Validation  ${POSearch.Query}${ExcelData[1].V_PO_Number}[0]  ${POSearch.URL}   ${PurchaseOrder_Status.AfterReceiving}
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}   API_POLine_Validation  ${POSearch.Query}${ExcelData[1].V_PO_Number}[0]   ${POLine.URL}    ${PO_Status_API}
   Comment  MOD - API - Inbound Delivery Validation - After ASN Verification
      Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}   API_INBOUND_DELIVERY_STATUS   ${IBDelivery_Status.AfterVerifyASN}    IB03_WIT
   Comment  MOD - API - Validate Dock Door Status - After ASN Verification - Dock door has to released and should be available status
      API_POST   ${DockDoor.SearchQuery}${DockDoorID}  ${DockDoor.URL}
      Wait Until Keyword Succeeds    ${Retry_API}    ${Retry_Interval_API}   API_DOCKDOOR_STATUS_VALIDATION  ${DockStatus.Initial}
   Comment  MOD - API - Item Inventory Validation  - Post Receiving Validation
      ${Item_Inv_Post}   API_Item_Inventory_Validation     Post
      ITEM_INVENTORY_PRE_AND_POST_COMPARISON_VALIDATION


IB_01_TC03_SAP_GR_Validation
    [Documentation]  Perform GR Validation and PO close in SAP
    [Teardown]   Run keywords  CLOSE SAP  AND  Run keyword if test failed  Fatal Error  "GR Validation/PO Close is not successful from SAP"
    Comment  MOD - SAP - Launch SAP
     SAP LAUNCH   ${SAP.SysName}    ${SAP.Client}    ${SAP.Username}    ${SAP.Password}
    Comment  MOD - SAP - GR Validation
     ME23N_GR_For_PO   ${ExcelFile}     ${TC_No}
    Comment  MOD - SAP - PO Close
     ME23N_PO_Close    ${ExcelFile}     ${TC_No}

IB_01_TC_04_WMS_PO_CLose_Validation
    [Documentation]  Validate PO status in WMS post PO CLose from SAP
    [Teardown]     Log_Json_Object
    Comment  MOD - API - Purchase Order Validation - After PO Close
     Wait Until Keyword Succeeds    ${Retry_IB03_WIT}    ${Retry_Interval_IB03_WIT}   API_PO_Validation  ${POSearch.Query}${ExcelData[1].V_PO_Number}[0]  ${POSearch.URL}   ${PurchaseOrder_Status.Closed}
