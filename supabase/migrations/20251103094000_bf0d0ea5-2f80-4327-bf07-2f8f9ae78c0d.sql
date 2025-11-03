-- Create knowledge base table for SCM Q&A
CREATE TABLE public.scm_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  link TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster keyword searches
CREATE INDEX idx_scm_knowledge_keywords ON public.scm_knowledge USING GIN(keywords);

-- Create index for text search
CREATE INDEX idx_scm_knowledge_question ON public.scm_knowledge USING gin(to_tsvector('english', question));

-- Enable Row Level Security (for public read access)
ALTER TABLE public.scm_knowledge ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access
CREATE POLICY "Allow public read access to knowledge base" 
ON public.scm_knowledge 
FOR SELECT 
USING (true);

-- Insert the Q&A data from the Excel file
INSERT INTO public.scm_knowledge (question, answer, keywords, link) VALUES
('What is a Purchase Order?', 'A Purchase Order (PO) is a commercial document and first official offer issued by a buyer to a seller indicating types, quantities, and agreed prices for products or services.', ARRAY['PO', 'definition', 'procurement'], NULL),
('How do I create a new vendor in SAP?', 'To create a new vendor, navigate to transaction FK01 in SAP, then fill in the required vendor master data including general data, company code data, and purchasing organization data.', ARRAY['vendor', 'SAP', 'create', 'FK01'], NULL),
('What are the steps for inventory reconciliation?', '1. Compare physical count to system records. 2. Investigate discrepancies. 3. Update system records accordingly. 4. Document all adjustments and reasons.', ARRAY['inventory', 'reconciliation'], NULL),
('Who is the contact for logistics issues?', 'Please contact the logistics team at logistics@loblaw.ca or via the internal extension for any logistics-related issues.', ARRAY['logistics', 'contact', 'issues'], 'mailto:logistics@loblaw.ca'),
('How to create purchase orders', 'To create a purchase order: 1. Login to SAP 2. Navigate to transaction ME21N 3. Enter vendor details 4. Add item details with quantity and distribution center (DC) 5. Click Save to generate the PO', ARRAY['PO', 'Create PO'], NULL),
('Can you share execution document of IB-23 of D004', 'For specific execution documents like IB-23 of D004, please refer to the JIRA ticket or contact your team lead for access to the detailed documentation.', ARRAY['IB', 'Jira'], NULL),
('Login to MAWM', 'To login to MAWM (Manhattan Warehouse Management), open this URL: https://lobls2-auth.sce.manh.com/discover_user and use your credentials.', ARRAY['MAWM', 'Login'], 'https://lobls2-auth.sce.manh.com/discover_user'),
('IB-01 - Happy Path - Receive PO in FULL via DC ASN/ Putaway to Active', '1. Item profiling set up: Configure Ti × Hi values in multiples of pack and subpack from SAP. 2. Create appointments in C3 as Manhattan system does not handle this natively. 3. Process full receipt via DC ASN. 4. Complete putaway to active location.', ARRAY['Steps', 'IB'], NULL),
('IB-02 - Happy Path - Receive PO in FULL via Vendor ASN / Putaway to Reserve', '1. Item profiling set up: Configure Ti × Hi values in multiples of pack and subpack from SAP. 2. Create appointments in C3 as Manhattan system does not handle this natively. 3. Process full receipt via vendor ASN. 4. Complete putaway to reserve location.', ARRAY['Steps', 'IB'], NULL),
('IB-03 - Receive PO - Overage + shortage | Damaged overage iLPNs / Putaway to T-zone', '1. Item profiling set up: Configure Ti × Hi values in multiples of pack and subpack from SAP. 2. Create appointments in C3 as Manhattan system does not handle this natively. 3. Handle overage and shortage scenarios. 4. Process damaged overage items. 5. Complete putaway to T-zone.', ARRAY['Steps', 'IB'], NULL),
('IB-06 - Receive PO in FULL via DC ASN / Item on Recall/ Putaway to Active & T-Zone', '1. Item profiling set up: Configure Ti × Hi values in multiples of pack and subpack from SAP. 2. Create appointments in C3 as Manhattan system does not handle this natively. 3. Process full receipt via DC ASN. 4. Handle recalled items appropriately. 5. Complete putaway to both active and T-zone locations.', ARRAY['Steps', 'IB'], NULL);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_scm_knowledge_updated_at
BEFORE UPDATE ON public.scm_knowledge
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();