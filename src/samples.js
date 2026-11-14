export const SAMPLE_CONTRACTS = [
  {
    id: "mutual-nda",
    label: "Mutual NDA",
    subtitle: "Hidden perpetual confidentiality & liquidated damages trap",
    text: `MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of November 10, 2026 by and between Northstar Robotics Inc., a Delaware corporation located at 450 Harrison Street, Suite 300, San Francisco, CA 94105 (Attention: Claire Bennett, legal@northstarrobotics.io, +1 (415) 555-0148, EIN 84-3910422) and Meridian Systems LLC, located at 1200 Congress Avenue, Austin, TX 78701 (Attention: David Mercer, contracts@meridiansystems.com).

1. CONFIDENTIAL INFORMATION & PERPETUAL SURVIVAL. Receiving Party shall keep all Disclosing Party business plans, pricing, source code, and customer identities strictly confidential in perpetuity, regardless of whether such information later becomes publicly available through industry standard benchmarking.

2. RESIDUALS & REVERSE ENGINEERING LICENSE. Disclosing Party may retain and freely use any general ideas, concepts, know-how, or techniques retained in unaided human memory by its personnel without compensation or attribution. Receiving Party waives all moral and trade secret claims arising from such residual use.

3. LIQUIDATED DAMAGES & INJUNCTIVE RELIEF. Any breach or threatened breach by Meridian Systems LLC shall trigger immediate liquidated damages of $250,000 per incident, payable within five (5) business days to Account Number: 4092817465 (Routing Number: 121000358), in addition to ex parte injunctive relief without bond.

4. NON-SOLICITATION & GOVERNING LAW. For thirty-six (36) months following termination, Receiving Party shall not directly or indirectly hire or engage any employee or contractor of Disclosing Party, even via general public job postings. Governed by the laws of the State of Delaware.`,
  },
  {
    id: "saas-msa",
    label: "SaaS MSA",
    subtitle: "Uncapped indemnity, auto-renewal lock-in & data training clause",
    text: `MASTER SAAS SUBSCRIPTION AGREEMENT

Provider: Apex Telemetry Corp., 880 Pine Street, Seattle, WA 98101 (billing@apextelemetry.io, +1 (206) 555-0192).
Customer: Harborline Freight Ltd., 210 Broad Street, Newark, NJ 07102 (Attention: Sarah Lin, slin@harborlinefreight.com, Tax ID: 92-4819203).

1. FEES AND AUTO-RENEWAL. Customer agrees to pay an annual subscription fee of $96,000 USD upfront. This Agreement automatically renews for successive three (3) year terms at a 15% annual price uplift unless Customer sends written notice via certified mail at least one hundred twenty (120) days prior to the renewal date.

2. CUSTOMER DATA & MODEL TRAINING LICENSE. Customer grants Apex Telemetry Corp. a worldwide, irrevocable, royalty-free, perpetual license to copy, analyze, and use Customer Data and usage telemetry to train and commercialize Provider's machine learning models and third-party analytics benchmarks.

3. LIMITATION OF LIABILITY. PROVIDER'S AGGREGATE LIABILITY UNDER THIS AGREEMENT SHALL NOT EXCEED $5,000 OR ONE MONTH OF FEES PAID, WHICHEVER IS LESS. CUSTOMER'S INDEMNITY OBLIGATIONS UNDER SECTION 4 SHALL BE COMPLETELY UNCAPPED AND EXCLUDED FROM ANY LIABILITY CAP.

4. TERMINATION FOR CONVENIENCE. Provider may suspend or terminate access at any time on 48 hours' email notice without refund of prepaid fees. Customer may not terminate for convenience during any initial or renewal term.`,
  },
  {
    id: "contractor",
    label: "Contractor Agreement",
    subtitle: "Overbroad IP assignment & 24-month worldwide non-compete",
    text: `INDEPENDENT CONTRACTOR SERVICES AGREEMENT

Between Cobalt Venture Holdings Inc. (330 Madison Avenue, New York, NY 10017; finance@cobaltventures.co; EIN 47-2091844) and Studio Kestrel LLC (412 Oak Road, Denver, CO 80203; By: Elena Vance; elena@studiokestrel.dev; +1 (303) 555-0174).

1. SERVICES & PAYMENT. Contractor shall deliver software architecture and API integrations for a fixed fee of $42,000, payable Net 90 days only upon Client's subjective written satisfaction and receipt of end-client funding.

2. WORK MADE FOR HIRE & PRIOR INVENTIONS. Contractor hereby irrevocably assigns to Client all worldwide right, title, and interest in any inventions, tools, libraries, code snippets, or methodologies conceived, created, or reduced to practice by Contractor during the Term, whether during working hours or on Contractor's own personal time and equipment, including all pre-existing developer utilities used in the deliverables.

3. NON-COMPETITION. During the Term and for twenty-four (24) months thereafter, Studio Kestrel LLC shall not provide software engineering, consulting, or API services to any entity globally operating in fintech, logistics, or cloud infrastructure.

4. INDEMNIFICATION. Contractor shall defend and indemnify Client against any claims, including Client's own gross negligence, with unlimited personal and corporate liability.`,
  },
  {
    id: "commercial-lease",
    label: "Commercial Lease",
    subtitle: "Unilateral relocation, triple-net structural repairs & personal guarantee",
    text: `COMMERCIAL OFFICE LEASE AGREEMENT

Landlord: Ironwood Property Group LLC, 700 Brickell Avenue, Suite 1400, Miami, FL 33131 (leases@ironwoodprop.com, +1 (305) 555-0119).
Tenant: Veridian Clinical Labs Inc., 1900 Biscayne Boulevard, Miami, FL 33132 (Attention: Marcus Reid, mreid@veridianlabs.org, IBAN: GB29NWBK60161331926819).

1. RENT & ESCALATION. Base rent is $14,500 per month ($174,000 annually), increasing automatically by 8% per annum compounded, plus Tenant's proportionate share of all Landlord capital improvements, roof replacements, HVAC replacements, and structural foundation repairs.

2. LANDLORD RELOCATION RIGHT. Landlord reserves the absolute right upon fifteen (15) days' written notice to relocate Tenant to any other space in the building or adjacent property selected by Landlord at Tenant's sole moving expense, without adjustment to rent if the new space is smaller.

3. HOLDOVER & DEFAULT. Any holdover past expiration increases rent to 300% of the final month's gross rent. Landlord may lock Tenant out of the premises without court order upon any 3-day late payment and accelerate the entire remaining five (5) year lease balance ($870,000).`,
  },
];

export const SAMPLE_SCANNED_CLAUSE_TEXT =
  "Audit this photographed contract clause (JPEG/PNG multimodal input) for hidden legal and financial risks, and provide a balanced redline.";

/**
 * Generates an in-memory PNG image of a scanned legal clause for multimodal on-device testing.
 */
export function createSampleClauseImageDataUrl() {
  if (typeof document === "undefined") {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Warm paper scan background
  ctx.fillStyle = "#f7f4ec";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle scanner border
  ctx.strokeStyle = "#d6cfc2";
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

  // Header
  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 24px Georgia, serif";
  ctx.fillText("EXHIBIT B — INDEMNITY & DATA OWNERSHIP ADDENDUM", 56, 84);

  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(56, 104);
  ctx.lineTo(904, 104);
  ctx.stroke();

  const lines = [
    "Section 7.2 (Uncapped Liability & AI Training Rights).",
    "Notwithstanding anything to the contrary in the Master Agreement,",
    "Customer shall indemnify Vendor without cap for any third-party",
    "claims arising from Customer's use of the Platform, including claims",
    "caused by Vendor's own software defects. Vendor's total aggregate",
    "liability is strictly limited to $500 USD. Vendor further receives",
    "a perpetual, irrevocable, royalty-free right to retain and train",
    "commercial AI models on all uploaded Customer documents.",
    "",
    "Initials: ________    Date: 11/14/2026    Ref: MSA-2026-884",
  ];

  ctx.fillStyle = "#111827";
  ctx.font = "20px Georgia, serif";
  let y = 152;
  for (const line of lines) {
    ctx.fillText(line, 56, y);
    y += 34;
  }

  return canvas.toDataURL("image/png");
}
