# MVP Product Specification — Estimate Comparison Tool

## Application Context

This application is an estimate comparison tool for roofing and restoration contractors who work with insurance claims. When a contractor submits a repair estimate to an insurance company, the insurance adjuster writes their own estimate for the same job — almost always for less money. The contractor then has to manually compare the two estimates line by line to find discrepancies, figure out what the adjuster cut or reduced, and build a "supplement" document arguing for the missing items. This process currently takes hours with highlighters and spreadsheets. Our tool automates it.

Both estimates are generated using Xactimate, the industry-standard estimating software used by virtually every insurance company and most contractors in the US. Xactimate exports estimates as PDFs with a consistent structure: line items organized by zone/room (Kitchen, Master Bedroom, Roof, Exterior, etc.), each with a description, quantity, unit, and cost breakdown columns (Remove, Replace, Reset, Tax, O&P, Total). The tool parses these PDFs, uses AI to fuzzy-match line items between the two estimates (since descriptions and zone names often differ slightly), and presents a side-by-side comparison highlighting matches, modifications, missing items, and items the adjuster added.

The primary users are small to mid-size roofing contractors and restoration company estimators — typically 35-60 years old, not particularly technical, often working from a truck or a job site office. They need the tool to work on desktop for detailed analysis and on mobile/tablet for quick reference during adjuster meetings. The UI must be clean, approachable, and feel like a modern professional tool — not a developer dashboard.

---

## Tech Stack

### Frontend
- **Framework**: Next.js (App Router) with TypeScript
- **Styling**: CSS Modules with shared design tokens/variables (no Tailwind)
- **Deployment**: Vercel (free tier to start, $20/month Pro when needed)

### Authentication
- **Service**: Clerk (free tier — 10,000 MAU)
- **Methods**: Email/password with email verification, Google OAuth SSO
- **Features used**: SignIn/SignUp components (custom styled), middleware for route protection, webhook sync to database

### Payments
- **Service**: Stripe
- **Features used**: Stripe Checkout for initial payment, Stripe Billing for subscriptions, Stripe Customer Portal for self-service management, Stripe Webhooks for payment events
- **Cost**: 2.9% + $0.30 per transaction (no monthly fee)

### Database
- **Service**: Supabase (PostgreSQL)
- **Free tier**: 500MB storage, 50,000 monthly active rows
- **Pro tier**: $25/month when needed
- **Tables**: users, comparisons, line_items, subscriptions

### File Storage
- **Service**: Supabase Storage (included with Supabase)
- **Purpose**: Store uploaded Xactimate PDF files

### AI / Comparison Engine
- **Service**: Anthropic Claude API (Sonnet 4.6)
- **Pricing**: $3/million input tokens, $15/million output tokens
- **Cost per comparison**: ~$0.25-0.40
- **Purpose**: Parse Xactimate PDFs into structured line item data, fuzzy-match line items between two estimates, classify matches (exact, modified, missing, added)

### PDF Parsing (Pre-AI)
- **Library**: pdf-parse (npm, free)
- **Purpose**: Extract raw text from PDFs server-side before sending to Claude API. Cheaper than using Claude's vision/document API on raw PDF bytes.

### PDF Generation
- **Library**: jsPDF or react-pdf (free)
- **Purpose**: Generate downloadable comparison report PDFs

---

## Pricing Tiers

| Tier | Monthly Price | Comparisons/Month | Target User |
|------|--------------|-------------------|-------------|
| Starter | $49.99/month | 10 comparisons | Solo roofer/adjuster, low volume |
| Professional | $99/month | 50 comparisons | Active adjuster, small firm |
| Business | $249/month | 200 comparisons | Multi-person firm, high volume |

**Add-on comparison packs** (one-time Stripe purchases, no expiration):
| Tier | Pack Size | Price |
|------|-----------|-------|
| Starter | 5 comparisons | $34.99 |
| Professional | 10 comparisons | $39.99 |
| Business | 10 comparisons | $34.99 |

**AI cost per comparison**: ~$0.15-0.50 (avg ~$0.25)
**Margin at Starter**: $49.99 revenue - $2.50 AI cost = ~$47.49 margin (~95%)
**Margin at Professional**: $99 revenue - $12.50 AI cost = ~$86.50 margin (~87%)
**Margin at Business**: $249 revenue - $50 AI cost = ~$199 margin (~80%)

**Free trial**: 7 days, limited to 3 comparisons. No credit card required. Trial banner shows days remaining.
**No free tier**: Hard block at cap with upgrade prompt.
**Annual discount**: 2 months free (~17% off): $33/mo, $83/mo, $209/mo (deferred — not yet implemented).

---

## Database Schema (Supabase/PostgreSQL)

### users
- id (UUID, primary key)
- clerk_id (string, unique — synced from Clerk webhook)
- email (string)
- full_name (string, nullable)
- company_name (string, nullable)
- stripe_customer_id (string, nullable)
- subscription_tier (enum: null, 'starter', 'professional', 'enterprise')
- subscription_status (enum: 'trialing', 'active', 'canceled', 'past_due', 'expired')
- trial_ends_at (timestamp, nullable)
- subscription_ends_at (timestamp, nullable)
- comparisons_used_this_period (integer, default 0)
- period_reset_date (timestamp)
- created_at (timestamp)
- updated_at (timestamp)

### comparisons
- id (UUID, primary key)
- user_id (UUID, foreign key → users)
- insured_name (string, nullable)
- claim_number (string, nullable)
- property_address (string, nullable)
- your_estimate_filename (string)
- your_estimate_storage_path (string)
- your_estimate_total (decimal, nullable)
- adjuster_estimate_filename (string)
- adjuster_estimate_storage_path (string)
- adjuster_estimate_total (decimal, nullable)
- total_gap (decimal, nullable)
- match_count (integer, default 0)
- modified_count (integer, default 0)
- missing_count (integer, default 0)
- added_count (integer, default 0)
- status (enum: 'processing', 'completed', 'failed')
- error_message (string, nullable)
- created_at (timestamp)
- updated_at (timestamp)

### line_items
- id (UUID, primary key)
- comparison_id (UUID, foreign key → comparisons)
- match_status (enum: 'match', 'modified', 'missing_from_adjuster', 'added_by_adjuster', 'grouped')
- zone_yours (string, nullable)
- zone_adjuster (string, nullable)
- description_yours (string, nullable)
- description_adjuster (string, nullable)
- qty_yours (string, nullable — stored as string to preserve unit, e.g. "16.00 HR")
- qty_adjuster (string, nullable)
- remove_yours (decimal, nullable)
- remove_adjuster (decimal, nullable)
- replace_yours (decimal, nullable)
- replace_adjuster (decimal, nullable)
- reset_yours (decimal, nullable)
- reset_adjuster (decimal, nullable)
- tax_yours (decimal, nullable)
- tax_adjuster (decimal, nullable)
- op_yours (decimal, nullable)
- op_adjuster (decimal, nullable)
- total_yours (decimal, nullable)
- total_adjuster (decimal, nullable)
- diff_amount (decimal, nullable)
- category (string, nullable — e.g. "ROOFING", "DRYWALL", "PAINTING")
- sort_order (integer — preserves the order from the original PDF)
- group_id (UUID, nullable — links grouped/duplicate matches together)
- created_at (timestamp)

---

## Application Flow — Complete Specification

### 1. Marketing Website (Public — No Auth Required)

**Pages:**
- **Home page** (`/`): Product value proposition, features overview, pricing section, CTA to sign up
- **FAQ page** (`/faq`): Common questions about the product, Xactimate compatibility, pricing, data security
- **Contact page** (`/contact`): Simple contact form (name, email, message) that sends to the founder's email
- **Login page** (`/login`): See Section 3 below
- **Sign up page** (`/signup`): See Section 2 below

**Navigation**: Simple top nav with logo, Home, FAQ, Contact, Login, Sign Up (CTA button style). These pages are public-facing (no auth required) and use a standalone top navigation bar — NOT the application sidebar. Logged-in users accessing `/app/*` routes will not see these marketing pages.

---

### 2. Sign Up Flow

**Route**: `/signup`

**Screen**: Centered card on page background, matching the login page design. Contains:
- Email input field
- Password input field
- Confirm password input field (must match password, show inline error if mismatch)
- hCaptcha or Turnstile (Cloudflare) captcha widget
- "Sign up" button (disabled until all fields valid + captcha completed)
- Divider with "or"
- "Continue with Google" button (triggers Clerk Google OAuth)
- Footer text: "Already have an account? Sign in" linking to `/login`

**Google SSO path:**
1. User clicks "Continue with Google"
2. Clerk handles Google OAuth redirect and callback
3. Account is created automatically in Clerk
4. Clerk webhook fires → creates user record in Supabase `users` table with clerk_id
5. User is redirected to the **Payment page** (`/subscribe`)

**Email/password path:**
1. User fills out form, passes captcha, clicks "Sign up"
2. Clerk creates the account and sends a 6-digit verification code to the email
3. User is shown an **Email verification screen** (`/verify`):
   - Centered card with heading "Check your email"
   - Subtitle: "We sent a verification code to {email}"
   - 6-digit code input (individual boxes, auto-advance on each digit)
   - "Verify" button
   - "Resend code" link (with 60-second cooldown timer)
   - "Use a different email" link (goes back to signup)
4. On successful verification:
   - Clerk webhook fires → creates user record in Supabase
   - User is redirected to the **Payment page** (`/subscribe`)

**Validation rules:**
- Email: valid format, not already registered (Clerk handles this, show inline error)
- Password: minimum 8 characters (Clerk default, configurable)
- Confirm password: must match password field
- Captcha: must be completed

---

### 3. Login Flow

**Route**: `/login`

**Screen**: Centered card (already designed — see login.html reference). Contains:
- Email input field
- Password input field with "Forgot password?" link
- "Sign in" button
- Divider with "or"
- "Continue with Google" button
- Footer text: "Don't have an account? Sign up" linking to `/signup`

**After successful login, routing depends on subscription status:**

| User State | Redirect To |
|-----------|------------|
| Active subscription (trialing or active) | `/app/new-comparison` |
| Canceled but subscription period not yet ended | `/app/new-comparison` (with toast: "Your subscription ends on {date}") |
| Subscription expired / trial ended / never subscribed | `/subscribe` (payment page, NO free trial) |
| Account exists but email not verified | `/verify` (email verification screen) |

**Forgot password flow:**
1. User clicks "Forgot password?" on login page
2. Shown a screen with email input and "Send reset link" button
3. Clerk sends password reset email
4. User clicks link in email → taken to "Set new password" screen (new password + confirm)
5. On success → redirected to `/login` with toast "Password reset successfully"

---

### 4. Payment / Subscription Page

**Route**: `/subscribe`

**Screen**: Centered layout, max-width 900px.

**Header**: "Choose your plan" with subtitle "Select the plan that fits your workload."

**Tier cards**: Three cards side by side (stack vertically on mobile). Each card shows:
- Tier name (Starter / Professional / Business)
- Price ($49.99 / $99 / $249) per month
- Comparison limit (10 / 50 / 200 per month)
- Feature bullet points (same across tiers, just the limit changes)
- "Select" button

**Professional card** should have a subtle accent (e.g., "Most popular" badge, slightly different border) to nudge users toward the middle tier.

**Free trial state (first-time users only):**
- The price on each card shows with a strikethrough: ~~$99/month~~
- Below it: "Free for 7 days" in green text
- Subtitle below cards: "Your card will not be charged during the trial. Cancel anytime."
- Trial includes 3 comparisons to test with

**Returning users (expired/canceled — no free trial):**
- Normal pricing, no strikethrough
- No trial messaging
- Everything else identical

**After selecting a tier:**
1. User clicks "Select" on a tier
2. Redirect to **Stripe Checkout** (hosted by Stripe — handles credit card entry, validation, 3D Secure, etc.)
   - For trial users: Stripe Checkout is configured with `subscription_data.trial_period_days: 7`
   - For returning users: immediate charge
3. On successful payment:
   - Stripe webhook fires → update user record in Supabase (subscription_tier, subscription_status, trial_ends_at or subscription_ends_at, stripe_customer_id)
   - User is redirected to `/app/new-comparison`

**If Stripe Checkout fails or user cancels:**
- Stripe redirects to a cancel URL → back to `/subscribe` with an inline error message

---

### 5. Application Shell (Authenticated — `/app/*`)

**Layout**: Sidebar navigation on the left (desktop/tablet), hamburger menu with slide-out drawer (mobile). Main content area on the right.

**Sidebar items (desktop/tablet):**
- Logo/product name at top
- New comparison (icon: plus or upload icon)
- Comparisons (icon: list/table icon)
- Divider
- Settings (icon: gear)
- Language (icon: globe)
- Get Help (icon: question mark)
- User avatar + name — at the very bottom, clickable for account menu (email + logout)

**Mobile navigation:**
- Hamburger icon in top bar opens a slide-out drawer from the left
- Drawer contains the same nav items as the desktop sidebar
- User info section at the bottom of the drawer with logout option
- **Note**: We are NOT using a bottom tab bar. The slide-out menu is the mobile navigation pattern.

**Trial banner:**
- If user is in trial status (`subscription_status === 'trialing'`):
  - Show a persistent banner at the very top of the application (above the sidebar/content), full width
  - Text: "Free trial — {X} days remaining" (calculate from `trial_ends_at`)
  - Background: light amber (#FAEEDA), text: dark amber (#854F0B)
  - Not dismissible — stays until trial ends or user subscribes
  - Include a subtle "Subscribe now" link on the right side of the banner

**Subscription ended state:**
- If `subscription_status === 'expired'` or `subscription_status === 'canceled'` and `subscription_ends_at` is in the past:
  - Redirect any `/app/*` route to `/subscribe`
  - The user cannot access the application at all without an active subscription

---

### 6. New Comparison Page

**Route**: `/app/new-comparison`

**This is the first page a user sees after login (if subscribed) or after subscribing.**

**Screen** (already designed — see upload mockup reference):
- Centered container, max-width 760px
- Heading: "New comparison"
- Subtitle: "Upload two Xactimate estimate PDFs to compare line items and identify discrepancies."
- Two upload zones side by side (desktop) or stacked (mobile):
  - Left: "Your estimate" — drag-and-drop or click to browse, PDF only
  - Right: "Adjuster's estimate" — same
- After file upload: show filename, file size, green checkmark, X to remove
- Optional metadata fields: Insured name, Claim number, Property address
- "Compare estimates" button — disabled until both files uploaded, enabled when both present

**Pre-submission validation:**
1. Both files must be present
2. Both files must be .pdf
3. File size limit: 20MB per file (Xactimate PDFs are typically 1-5MB)
4. Check user's comparison limit: if `comparisons_used_this_period >= tier_limit`, show an error toast: "You've reached your monthly comparison limit ({X}/{max}). Upgrade your plan for more." with a link to settings/upgrade. Do NOT proceed with the API call.

**On submit:**
1. Upload both PDFs to Supabase Storage
2. Create a new record in `comparisons` table with status: 'processing'
3. **Current implementation checkpoint**: The UI disables submit during upload/create, then redirects immediately to `/app/comparison/{id}`. Processing status is shown on the detail page via state banners.
4. On completion:
   - Update `comparisons` record: status → 'completed', populate totals and counts
   - Increment `comparisons_used_this_period` on user record
   - Detail page shows completed state banner
5. On failure:
   - Update `comparisons` record: status → 'failed', error_message populated
   - Detail page shows failed state banner with retry path to create a new comparison
   - Do NOT count against the user's comparison limit

---

### 7. Comparison Table View (Desktop/Tablet)

**Route**: `/app/comparison/{id}`

**This is the core product screen — already designed and built as HTML.**

**Layout**: Full width of the main content area (sidebar remains).

**Components from top to bottom:**

1. **Page header**: Back arrow to comparisons list, comparison name (insured name or "Comparison {date}"), "Download PDF" button on the right

2. **Summary dashboard** (NEW — not yet designed):
   - Row of 4 metric cards:
     - Your estimate total (e.g., "$285,694")
     - Adjuster's estimate total (e.g., "$90,261")
     - Total gap (e.g., "$195,433" in red)
     - Number of discrepancies (e.g., "13 items")
   - Below cards: zone-level breakdown showing gap per zone, sorted by largest gap first

3. **Filter toolbar** (already designed):
   - Status pills: Match (count), Modified (count), Missing (count), Added (count)
   - "Discrepancies only" quick link
   - Search input for descriptions
   - Filters dropdown (Zone, Category, Min. Impact threshold)
   - Columns dropdown (Toggle: Remove, Replace, Reset, Tax, O&P)

4. **Unified comparison table** (already designed and built):
   - Single HTML table with 7+ columns
   - Left side: Your estimate (Description, Zone, Qty, Total + toggled columns)
   - Divider
   - Right side: Adjuster's estimate (Description, Zone, Qty, Total + toggled columns)
   - Far right: Diff column
   - Row colors: green (match), amber (modified), red (missing), blue (added by adjuster)
   - Section headers for zones (collapsible)
   - Section totals rows

5. **Footer area**: Section gap total, overall gap total

**Data source**: Fetch comparison and line_items from Supabase by comparison ID. All filtering, sorting, searching happens client-side on the loaded data.

---

### 8. Comparison Table View (Mobile)

**Route**: Same as desktop (`/app/comparison/{id}`), responsive layout

**Layout**: Card-based instead of table-based (already designed).

**Components from top to bottom:**

1. **Header bar**: Back arrow, comparison name, overflow menu (Download PDF)

2. **Summary section**: Condensed version of the dashboard — your total, their total, gap, discrepancy count. Horizontal scroll or 2x2 grid.

3. **Filter bar**: Status pills (horizontally scrollable), search icon that expands to a search input, filter icon that opens a bottom sheet with Zone/Category/Impact filters

4. **Card list**: Scrollable list of line item comparison cards (already designed — 5 card states):
   - Modified match card (with expandable chevron for cost breakdown)
   - Exact match card (visually quiet)
   - Missing from adjuster card (red banner)
   - Added by adjuster card (blue banner)
   - Grouped match card (purple, nested items)

5. **Exact matches** collapsed by default into a summary row: "{X} matching items — ${total}" that can be tapped to expand

---

### 9. Comparisons List Page

**Route**: `/app/comparisons`

**Screen**: List/table of all comparisons for the current user, fetched from Supabase.

**Each row/card shows:**
- Insured name (or "Untitled comparison" if blank)
- Property address (if provided)
- Claim number (if provided)
- Date created
- Status: "Completed" (green), "Processing" (amber spinner), "Failed" (red)
- Your total vs Adjuster's total
- Gap amount (red text)
- Discrepancy count summary: e.g., "4 modified, 6 missing, 2 added"

**Actions:**
- Click any row → opens `/app/comparison/{id}`
- "New comparison" button in top right → navigates to `/app/new-comparison`
- Delete comparison: trash icon on each row, click triggers a confirmation modal ("Delete this comparison? This cannot be undone."), on confirm → delete from Supabase (comparison + line_items + storage files)
- Sort by: Date (default, newest first), Gap amount, Insured name

**Empty state** (no comparisons yet):
- Centered illustration or icon
- "No comparisons yet"
- "Create your first comparison to get started"
- Prominent "New comparison" button

**Mobile**: Same data, displayed as cards instead of table rows.

---

### 10. Settings Page

**Route**: `/app/settings`

**Sections:**

#### Profile
- Full name (editable text input)
- Email (displayed, not directly editable — change through Clerk)
- Company name (editable text input)
- "Save changes" button

#### Plan & Billing
- Current plan: "{Tier name} — ${price}/month"
- Status: "Active" (green), "Trialing" (amber), "Canceled — ends {date}" (red)
- Renewal date: "Next billing date: {date}"
- Usage this period: "{X} of {max} comparisons used" with a subtle progress bar
- "Upgrade plan" button → opens a modal or navigates to a plan selection view showing the other tiers. If upgrading mid-cycle, the user pays the prorated difference. Clicking "Upgrade" redirects to Stripe Checkout configured for the new tier. On successful payment, Stripe webhook updates the user's tier. The upgrade date becomes the new billing anchor.
- "Cancel subscription" button (see below)

#### Appearance
- Theme toggle: Light / Dark (no System option)
- Dark mode uses dark gray palette (not solid black), preserves semantic row color meanings
- Theme preference persisted in localStorage
- Only affects app pages — marketing/public pages unaffected

#### Notifications
- Product updates: receive emails about important updates, new features, and improvements
- Billing reminders: notifications about upcoming charges and receipts

#### Cancel Subscription Flow
1. User clicks "Cancel subscription" in settings
2. Navigated to `/app/settings/cancel`
3. Screen shows:
   - Heading: "We're sorry to see you go"
   - Subtitle: "This software is built and supported by one person. Any feedback you can share would mean a lot."
   - Optional textarea: "What could we have done better?" (placeholder text, not required)
   - "Cancel my subscription" button (red/danger style)
   - "Never mind, keep my subscription" link below (navigates back to settings)
4. On clicking "Cancel my subscription":
   - API call to Stripe to cancel the subscription at period end (NOT immediate cancellation — user keeps access until the end of their paid period)
   - Update user record: subscription_status → 'canceled', subscription_ends_at → end of current period
   - If feedback was provided, save it (can be a simple table or email to founder)
   - Redirect to `/app/new-comparison`
   - Show a **persistent, non-auto-dismissing toast** at the bottom: "Your subscription has been canceled. You'll have access until {end_date}." Toast has an X to dismiss manually.

---

### 11. Error Handling

**Generic error page** (`/error` or rendered inline):
- Centered on page
- Simple illustration: hard hat with a question mark, or a blueprint that's been crumpled up — something construction-themed and lighthearted
- Heading: "Well, that wasn't in the estimate"
- Subtitle: "Something went wrong on our end. We're looking into it."
- "Go home" button → `/app/comparisons` (if authenticated) or `/` (if not)
- "Try again" button → refreshes the current page

**Specific error states to handle:**
- PDF upload fails: toast with "Upload failed. Please try a different file."
- PDF is not a valid Xactimate export: toast with "This doesn't look like an Xactimate estimate. Please upload an Xactimate PDF export."
- Claude API call fails: processing screen shows error state with "Comparison failed. Please try again." and a retry button. Does NOT count against comparison limit.
- Stripe payment fails: Stripe Checkout handles this natively with inline error messages
- Network error / API timeout: generic error page
- 404 (comparison not found, invalid route): generic error page with "Page not found" variant
- Comparison limit reached: toast with upgrade CTA (as described in Section 6)

**Toast notification system:**
- Position: bottom center of screen
- Types: success (green left border), error (red left border), info (blue left border), warning (amber left border)
- Auto-dismiss: 7 seconds for success/info, 10 seconds for warnings, manual dismiss only for errors and the subscription cancellation toast
- Stack: up to 3 toasts visible at once, oldest dismissed first

---

### 12. API Routes (Next.js API Routes)

All API routes live under `/api/` and are server-side.

#### POST /api/comparisons
- Auth: requires authenticated user (Clerk middleware)
- Validates subscription status and comparison limit
- Accepts: two PDF files + optional metadata
- Uploads files to Supabase Storage
- Creates comparison record
- Triggers the AI processing pipeline (can be async/background)
- Returns: comparison ID

#### GET /api/comparisons
- Auth: requires authenticated user
- Returns: list of all comparisons for the current user (metadata only, not line items)

#### GET /api/comparisons/{id}
- Auth: requires authenticated user, must own the comparison
- Returns: comparison metadata + all line items

#### POST /api/comparisons/{id}/process (dev/testing)
- Auth: requires authenticated user, must own the comparison
- Behavior: manually triggers development processing stub for status testing
- Optional JSON body: `{ "mode": "success" | "failed" }`

#### DELETE /api/comparisons/{id}
- Auth: requires authenticated user, must own the comparison
- Deletes: comparison record, line items, storage files

#### POST /api/comparisons/{id}/download
- Auth: requires authenticated user, must own the comparison
- Generates: PDF report of the comparison
- Returns: PDF file

#### POST /api/webhooks/clerk
- No auth (verified by Clerk webhook signature)
- Handles: user.created event → creates user in Supabase

#### POST /api/webhooks/stripe
- No auth (verified by Stripe webhook signature)
- Handles:
  - checkout.session.completed → update subscription status
  - customer.subscription.updated → update tier, status, dates
  - customer.subscription.deleted → mark as expired
  - invoice.payment_failed → mark as past_due

---

### 13. AI Processing Pipeline (Server-Side)

This runs as an async process after the user submits a comparison.

**Step 1: Parse PDFs**
- Use pdf-parse to extract raw text from both PDFs
- Validate that the text contains Xactimate-specific patterns (look for "DESCRIPTION", "QTY", "REMOVE", "REPLACE", "TAX", "O&P", "TOTAL" column headers, zone/room section headers)
- If validation fails → mark comparison as failed with appropriate error message

**Step 2: Send to Claude API**
- Construct a prompt that includes both parsed text blocks
- Request structured JSON output with:
  - List of line items from estimate A
  - List of line items from estimate B
  - Match assignments: which items from A map to which items from B
  - Match confidence score for each pairing
  - Classification: match, modified, missing_from_adjuster, added_by_adjuster, grouped
- Use Claude Sonnet 4.6 (model string: `claude-sonnet-4-6`)
- Set max_tokens: 8000 (sufficient for most estimates)
- Temperature: 0 (deterministic matching)

**Step 3: Process Response**
- Parse Claude's JSON response
- Calculate diff amounts for each paired item
- Calculate section totals and overall totals
- Write all line items to the `line_items` table
- Update the `comparisons` record with totals and counts

**Step 4: Return**
- Mark comparison status as 'completed'
- Client polls for status or receives a real-time update (Supabase real-time subscriptions or polling every 2 seconds)

---

### 14. Gaps Filled (Not Explicitly Specified by Founder)

1. **Password reset flow**: Added forgot password → email reset → set new password flow via Clerk
2. **Profile editing**: Added name, email display, company name to settings
3. **Comparison deletion**: Added delete with confirmation on comparisons list
4. **Rate limiting / comparison caps**: Each tier has a monthly comparison limit enforced server-side before any API call
5. **PDF validation**: Pre-check that uploaded files are Xactimate exports before burning Claude API credits
6. **File size limits**: 20MB per PDF to prevent abuse
7. **Empty states**: Designed for comparisons list (no comparisons yet) and filtered table (no results)
8. **Error page**: Construction-themed humorous error page for all unhandled errors
9. **Toast notification system**: Standardized toast system for success, error, warning, info across the app
10. **Comparison limit enforcement**: Check before API call, do not count failed comparisons
11. **Trial comparison limit**: 3 comparisons during 7-day trial to limit AI cost exposure
12. **Subscription cancellation timing**: Cancel at period end (not immediate) so user keeps access through paid period
13. **Upgrade proration**: Mid-cycle upgrade charges the difference and resets billing anchor
14. **Download PDF**: Comparison report generation and download
15. **Real-time processing updates**: Client polls or uses Supabase real-time to show processing progress
16. **Multi-device sessions**: Clerk handles this natively
17. **Mobile navigation**: Slide-out drawer on mobile mirroring sidebar items (no bottom tab bar)
