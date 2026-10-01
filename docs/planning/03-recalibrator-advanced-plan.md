# Portfolio Recalibrator - Advanced Project Plan

## Executive Summary

**Problem:** Users have fragmented portfolios (multiple accounts, different strategies) with no clear guidance on whether allocation aligns with their goals and risk tolerance.

**Solution:** An app that analyzes portfolio composition across all Wealthsimple accounts and recommends specific buy/sell actions to optimize for their stated goals (house down payment in 3 years, retirement in 30 years, etc.).

**Why it's better than performance tracking:**
- Requires real algorithmic thinking (not just data display)
- Genuinely solves a $1M+ problem for mid-net-worth users
- Shows finance + engineering + UX expertise
- Has "upgrade path" to monetization (robo-advisor killer)

---

## Core Concept: Goal-Based Portfolio Recalibration

### User's Situation (Real Example)
```
Total Portfolio Value: $40,000
Accounts: 3 (cash, managed ETFs, individual stocks)

Goal 1: House down payment
  Timeline: 3 years
  Target: $30,000 saved
  Risk tolerance: LOW (can't afford to lose this money)
  Current exposure: $15k in safe cash ✅ but missing growth

Goal 2: Retirement
  Timeline: 30 years
  Target: $500k+ accumulated
  Risk tolerance: HIGH (time to recover from downturns)
  Current exposure: Only $15k in growth stocks ❌ way too conservative

Goal 3: General wealth building
  Timeline: 10 years
  Target: Undefined
  Risk tolerance: MEDIUM-HIGH
  Current exposure: $10k in bonds earning 4-7% ❌ stuck in initial allocation

PROBLEM: These goals need DIFFERENT asset allocations
- Goal 1 needs: 80% bonds/cash, 20% stocks (protect capital)
- Goal 2 needs: 90% stocks, 10% bonds (maximize growth over 30 years)
- Goal 3 needs: 60% stocks, 40% bonds (balanced)

CURRENT ALLOCATION:
- Cash: $15k (conservative)
- Bonds/ETFs: $10k (moderate)
- Individual stocks: $15k (growth)
= 37.5% growth, 25% moderate, 37.5% safe
→ This doesn't match ANY goal optimally!
```

---

## App Architecture

### 1. Goal Definition Flow
User sets up multiple goals with:
- **Goal name** (e.g., "House down payment", "Retirement", "General growth")
- **Target amount** (e.g., $30,000, $500,000, undefined)
- **Timeline** (e.g., 3 years, 30 years, 10+ years)
- **Risk tolerance** (Low=bonds/cash, Medium=60/40, High=90/10 stocks)
- **Current savings toward goal** (optional)

**App calculates:**
- Time remaining (months)
- Required annual return to hit target
- Recommended asset allocation (glide path)
- Whether goal is achievable with current savings rate

### 2. Portfolio Analysis
App connects to Wealthsimple via SnapTrade and analyzes:

**Current allocation across all accounts:**
```
Total Portfolio: $40,000
- Cash: $15,000 (37.5%)
- Bonds/ETFs: $10,000 (25%)
- Individual stocks: $15,000 (37.5%)
```

**Risk assessment:**
- Weighted average risk score: 5.5/10 (medium)
- Downside volatility: 8-12% annually
- Expected returns: 6-8% annually

**Concentration risks:**
- 37.5% in individual stocks (4 stocks = 3.75% per stock)
- Tech-heavy exposure (5 of 8 stocks are tech)
- Geographic concentration (all Canadian stocks)

### 3. Goal-Based Recommendations

**For each goal, calculate:**

#### Goal 1: House Down Payment (3 years)
```
Current: $15k in cash
Target: $30k total
Required return: 20% total (6.7% annually)

RECOMMENDED ALLOCATION:
- Cash: $12,000 (80%) — protect principal, earn 2.5%
- Bonds: $2,000 (13%) — earn 4-5%
- Stocks: $1,000 (7%) — capture growth without volatility
Expected return: 3.1% annually → $16,500 in 3 years (short of target)

PROBLEM: Can't reach $30k with low-risk allocation
SOLUTIONS TO OFFER USER:
A) Increase savings: Save $5k/year instead of $3.3k/year
B) Accept lower target: $22k instead of $30k
C) Take more risk: Move to 20% stocks (earns ~5% annually → ~$17.5k)

SPECIFIC ACTIONS:
- SELL $3k from individual stocks (highest liquidity)
- MOVE $3k to high-interest savings account (HISA)
- KEEP current bond holdings ($2k)
- Status: "ON TRACK with increased savings"
```

#### Goal 2: Retirement (30 years)
```
Current: Only $15k in growth assets
Target: $500k at retirement
Required return: 8.5% annually

RECOMMENDED ALLOCATION:
- Stocks: $36,000 (90%)
- Bonds: $4,000 (10%)
Expected return: 8.5% annually → $532k in 30 years ✅ TARGET MET

SPECIFIC ACTIONS:
- SELL ALL cash portfolio ($15k) → too conservative for 30-year horizon
- BUY $12k in diversified ETFs (e.g., VGRO 90/10)
- KEEP current individual stocks ($15k)
- Status: "ON TRACK, but needs rebalancing NOW"
```

#### Goal 3: General Growth (10 years)
```
Current: $10k in bonds
Target: Undefined, but maximize growth
Required return: 7% annually (typical balanced portfolio)

RECOMMENDED ALLOCATION:
- Stocks: $22,000 (60%)
- Bonds: $18,000 (40%)
Expected return: 7.5% annually

SPECIFIC ACTIONS:
- BUY $8-10k in index ETFs (e.g., VFV for US exposure)
- REBALANCE toward your 60/40 target
- Status: "NEEDS REBALANCING, opportunity to diversify"
```

### 4. Unified Recommendation Engine

**Synthesizes across all goals to create ONE action plan:**

```
Current State:
- Goal 1 (3-yr house): ❌ Needs more aggressive investing
- Goal 2 (30-yr retirement): ❌ Way too conservative
- Goal 3 (10-yr growth): ⚠️ Needs rebalancing

OVERALL RECOMMENDATION: "Bucket Strategy"
Your goals have different timelines → use different "buckets"

BUCKET 1: House Fund (3 years)
  Amount: $12,000 from cash
  Allocation: 80% HISA, 15% bonds, 5% stocks
  Accounts: Keep in Wealthsimple managed (cash portfolio)
  Action: NO CHANGE (already positioned correctly)

BUCKET 2: Growth Fund (10+ years)
  Amount: $28,000 from bonds + stocks
  Allocation: 70% stocks (diversified ETFs), 30% bonds
  Accounts: Move managed bond portfolio + some individual stocks
  Action 1: SELL $3k individual stocks (tech concentration)
           BUY $3k VFV (US index ETF) → diversify US exposure
  Action 2: SELL $2k individual stocks (lowest performers)
           BUY $2k VGRO (all-in-one ETF) → simplify management
  Action 3: KEEP $15k individual stocks (ongoing monthly buys)

BUCKET 3: Speculation/Learning (unlimited timeline)
  Amount: $5,000 from individual stocks
  Allocation: 100% individual stocks (high risk OK)
  Accounts: Wealthsimple individual account
  Action: KEEP as-is, but cap at $5k (don't exceed this)
```

---

## Key Financial Concepts to Implement

### 1. Glide Path Calculation
```
As you approach goal date, automatically reduce risk:

Retirement in 30 years: 90% stocks
Retirement in 20 years: 85% stocks
Retirement in 10 years: 70% stocks
Retirement in 5 years:  50% stocks
Retirement in 2 years:  30% stocks
Retirement in 1 year:   10% stocks (preserve capital)
```

### 2. Required Rate of Return Calculator
```
Formula: Required Annual Return = (Target / Current)^(1/years) - 1

Example: $15k → $30k in 3 years
Required return = (30,000 / 15,000)^(1/3) - 1 = 26% annually
→ This is HIGH RISK! May not be achievable.

Suggested: "You need 6.7% annually. Low-risk portfolio 
earns ~3%. Either save more, accept lower target, or take more risk."
```

### 3. Risk-Return Tradeoff Matrix
```
Conservative (3-4% return):    80% bonds, 20% stocks
Moderate (5-6% return):        60% stocks, 40% bonds
Balanced (6-7% return):        70% stocks, 30% bonds
Aggressive (7-8% return):      85% stocks, 15% bonds
Growth (8-9% return):          90% stocks, 10% bonds
Maximum (9%+ return):          100% stocks, 0% bonds

(Show user where THEY are vs. where they SHOULD be)
```

### 4. Concentration Risk Alert
```
If any single position > 5% of portfolio: ⚠️ WARNING
If any single sector > 30% of portfolio: ⚠️ WARNING
If all positions in one country: ⚠️ WARNING

Your portfolio: 10% in each stock, but 60% in tech sector
→ "Opportunity: Diversify into different sectors"
```

### 5. Tax-Loss Harvesting (Advanced)
```
If individual stock is down:
"SELL $2k of ABC (currently -15% loss)
 BUY $2k of XYZ (similar sector)
 Tax benefit: Claim $300 capital loss offset"
```

---

## Implementation Plan (8 Weeks)

### Week 1: Setup & SnapTrade Integration
- [ ] React + TypeScript + Tailwind setup
- [ ] SnapTrade API connection (fetch accounts, positions)
- [ ] Store user portfolio snapshot

### Week 2: Goal Definition UI
- [ ] Create goal form (name, target, timeline, risk tolerance)
- [ ] Store goals in backend/localStorage
- [ ] Display goal list dashboard

### Week 3: Portfolio Analysis Engine
- [ ] Calculate current allocation (% stocks/bonds/cash)
- [ ] Calculate weighted risk score
- [ ] Detect concentration risks
- [ ] Calculate expected returns

### Week 4: Recommendation Engine
- [ ] For each goal, calculate required allocation
- [ ] Compare current vs. recommended
- [ ] Flag misalignments
- [ ] Generate specific buy/sell actions

### Week 5: Visualization & UI
- [ ] Goal progress cards (current vs. target)
- [ ] Allocation pie charts (current vs. recommended)
- [ ] Rebalancing action plan (step-by-step)
- [ ] Risk-return scatter plot

### Week 6: Advanced Features
- [ ] Glide path visualization (allocation over time)
- [ ] Tax-loss harvesting detector
- [ ] Sector exposure breakdown
- [ ] What-if scenario builder

### Week 7: Polish & Testing
- [ ] Edge cases (new user, no goals, small portfolio, etc.)
- [ ] Mobile responsiveness
- [ ] Performance optimization
- [ ] Error handling

### Week 8: Deploy & Demo
- [ ] Deploy to Vercel
- [ ] Record 90-second demo
- [ ] Write submission copy
- [ ] Clean up GitHub repo

---

## Data Model

```typescript
interface UserGoal {
  id: string;
  name: string;
  targetAmount: number;
  timelineYears: number;
  currentSavings: number;
  riskTolerance: "low" | "medium" | "high";
  priority: number;
  category: "house" | "retirement" | "education" | "general";
}

interface PortfolioAnalysis {
  totalValue: number;
  accounts: {
    accountId: string;
    name: string;
    balance: number;
    positions: Position[];
    allocationPercent: {
      stocks: number;
      bonds: number;
      cash: number;
    };
  }[];
  riskScore: number; // 1-10
  expectedReturn: number; // annual %
  concentration: {
    sectorExposure: { sector: string; percent: number }[];
    geographicExposure: { country: string; percent: number }[];
  };
}

interface Recommendation {
  goalId: string;
  currentAllocation: { stocks: number; bonds: number; cash: number };
  recommendedAllocation: { stocks: number; bonds: number; cash: number };
  actions: Action[];
  reasoning: string;
  achievabilityScore: number; // 0-100, is target realistic?
}

interface Action {
  id: string;
  type: "sell" | "buy" | "hold" | "transfer";
  account: string;
  symbol: string;
  quantity: number;
  reason: string; // e.g., "Reduce concentration risk", "Capture growth"
  priority: "high" | "medium" | "low";
}

interface DashboardView {
  goals: UserGoal[];
  portfolio: PortfolioAnalysis;
  recommendations: Recommendation[];
  buckets: Bucket[];
}

interface Bucket {
  name: string;
  timeline: string;
  targetAllocation: { stocks: number; bonds: number; cash: number };
  currentValue: number;
  accounts: string[];
  suggestedActions: Action[];
}
```

---

## Demo Script (90 seconds)

```
[0-10s] Open app, show dashboard
"I have three Wealthsimple accounts with $40k total, 
but I don't know if my allocation matches my goals."

[10-30s] Set up goals
"Let me tell the app my goals: House down payment in 3 years, 
retirement in 30 years, and general growth."

[30-50s] Show analysis
"Now the app analyzed my current allocation across all accounts 
and flagged problems: My retirement savings is too conservative, 
my house fund needs more bonds, my growth portfolio needs diversification."

[50-80s] Show recommendations
"The app gives me specific actions: Sell $3k of concentrated tech stocks, 
buy $3k of diversified US ETF, move $12k to high-yield savings. 
It shows why each action matters and which goal it helps."

[80-90s] Call to action
"No robo-advisor, no manual spreadsheets. Just connect your 
Wealthsimple account and get a personalized rebalancing plan in seconds."
```

---

## What Makes This Win

### vs. Performance Tracking App
- ❌ Performance tracker: "Here's your return" (data display)
- ✅ Recalibrator: "Here's what to DO" (actionable advice)

### vs. Robo-Advisors
- ❌ Wealthsimple managed: Charges 0.5% fee, forces you into their products
- ✅ Your app: FREE, works across ANY Wealthsimple account

### vs. Manual Spreadsheet
- ❌ Excel: Tedious, error-prone, requires finance knowledge
- ✅ Your app: Instant, visual, explains reasoning

### Judges Will Notice
1. **Algorithm design**: Goal-based allocation is non-trivial
2. **Financial knowledge**: You clearly understand investing
3. **UX/Product thinking**: This solves a REAL problem for real users
4. **Scalability**: You could charge for this ($50/year per user?)
5. **Demo quality**: Showing real recommendations is impressive

---

## Success Metrics

**Minimum viable:** Goal input + current allocation + basic recommendations

**Good:** + Specific buy/sell actions + allocation pie charts

**Excellent:** + Glide path visualization + bucket strategy + risk analysis

**Winning:** Excellent + What-if scenarios + tax-loss detection + beautifully polished

---

## Competitive Positioning

When judges ask "What's different?"
- Wealthsimple: Forced into managed portfolios
- Questrade/Questwealth: Passive robo-advisor, not active rebalancing
- Personal finance apps (YNAB, Mint): Budget tracking, not portfolio optimization
- Your app: Active, FREE, multi-account portfolio optimization

"This fills the gap between DIY investing and robo-advisors."

---

## Long-Term Vision (Post-Competition)

1. **Monetization path**: 
   - Free tier: View recommendations
   - Pro tier: $99/year for automated rebalancing + tax optimization
   
2. **Expansion**: 
   - Support other brokers (Questrade, Interactive Brokers, TD)
   - Integrate real market data for live returns
   - Add historical tax reporting

3. **Business model**:
   - Direct to consumer ($99/year × 10k users = $1M ARR)
   - B2B licensing to other fintechs
   - Affiliate revenue from ETF/brokerage partnerships

---

## Final Thought

This isn't just a better project than performance tracking. It's a **real business idea that solves a $1M+ problem** for Canadian investors. Your judges will see that immediately.

And honestly? **This is something YOU need right now.** Build it for yourself first, then it becomes a genuinely useful tool.
