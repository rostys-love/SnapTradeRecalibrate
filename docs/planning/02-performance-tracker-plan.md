# Wealthsimple Performance Tracker - Student Competition Project

## Project Overview
A web app that connects to a user's Wealthsimple account via SnapTrade and shows detailed performance metrics, comparing their actual returns to benchmarks and providing actionable insights.

**Why this wins the competition:**
- Solves a real problem (Wealthsimple doesn't show detailed performance metrics)
- Demonstrates mastery of SnapTrade API
- Visually impressive with charts and real data
- Shows financial + engineering knowledge

---

## MVP (Minimum Viable Product) - Ship by Oct 9

### Core Features

#### 1. **Dashboard Overview**
What users see when they open your app:
- Total portfolio value (real-time from Wealthsimple)
- Total gain/loss in dollars
- Total gain/loss as percentage
- Time period selector (1M, 3M, 6M, 1Y, all-time)
- 30-day chart showing portfolio value over time

**Technical:** 
- Call SnapTrade `listUserAccounts` → get all accounts
- Call SnapTrade `getUserAccountBalance` for each account
- Sum totals across all accounts
- Store historical snapshots locally to calculate daily changes

#### 2. **Holdings Breakdown**
Table of all positions with:
- Ticker symbol
- Number of shares
- Current price (from SnapTrade)
- Purchase price (avg cost basis)
- Unrealized gain/loss ($)
- Unrealized gain/loss (%)
- Percent of portfolio

**Technical:**
- Call SnapTrade `getAllAccountPositions` 
- For each position, calculate gain/loss = (current_price - avg_cost) × shares
- Display in sortable table (sort by gain, ticker, etc.)

#### 3. **Returns Timeline**
Interactive chart showing:
- Portfolio value over selected time period
- A reference line showing your buy-in value
- Tooltip showing date + value + daily change on hover

**Technical:**
- Store daily snapshots in browser localStorage or simple backend DB
- Use Chart.js or Recharts library for visualization
- Calculate daily net change from position data

#### 4. **Benchmark Comparison**
Compare your returns to market indices:
- Your portfolio: +8.5% (1 year)
- S&P 500: +12.1% (1 year)
- TSX (Canada): +6.3% (1 year)
- Your outperformance: -3.6% underperformance

**Technical:**
- Fetch benchmark data from free API (Alpha Vantage, yfinance, or hardcoded historical data)
- Calculate your actual return: (current_total - invested_total) / invested_total
- Show comparison as simple cards or a small chart

#### 5. **Best & Worst Performers**
Two simple lists:
- Top 5 holdings by gain %
- Bottom 5 holdings by loss %

---

## Beyond MVP - Nice-to-Have Features (If Time)

#### 6. **Dividend Tracker**
- Historical dividends paid
- Annualized dividend yield
- Dividends reinvested vs. withdrawn

#### 7. **Asset Allocation Pie Chart**
- Breakdown by sector (tech, healthcare, etc.)
- Breakdown by asset type (stocks, ETFs, cash)
- Pie chart showing allocation
- Rebalancing suggestions (if too far from target)

#### 8. **Performance by Account**
- If user has multiple accounts (TFSA, RRSP, non-registered)
- Show performance of each separately
- Compare which account is performing best

#### 9. **Time-Weighted Returns (Advanced)**
- Accounts for deposits/withdrawals
- More accurate than simple ROI
- Shows true performance excluding cash flow timing

#### 10. **Export & Sharing**
- Export performance report as PDF
- Share your performance (anonymized) on social media
- Email performance report

---

## Tech Stack Recommendation

### Frontend
- **React** — fast, great for charts and real-time updates
- **TypeScript** — catch bugs early
- **Chart.js or Recharts** — beautiful, responsive charts
- **Tailwind CSS** — clean, modern styling
- **Vite** — fast dev server and bundling

### Backend (Simple)
- **Node.js + Express** — lightweight server
- **SQLite or MongoDB** — store historical snapshots
- OR just browser localStorage to keep it simple for MVP

### Data Sources
- **SnapTrade API** — live account data
- **Alpha Vantage / yfinance** — free benchmark data
- **Browser localStorage** — cache daily snapshots locally

### Deployment
- **Vercel** — free hosting for frontend, serverless functions
- **Render / Railway** — free tier for backend DB

---

## Development Roadmap (6 Weeks)

### Week 1: Setup & Authentication
- [ ] Create React app with TypeScript
- [ ] Set up SnapTrade Personal API key
- [ ] Implement SnapTrade connection flow (OAuth)
- [ ] Store user's SnapTrade tokens securely

### Week 2: Data Retrieval
- [ ] Fetch account list from SnapTrade
- [ ] Fetch account balances
- [ ] Fetch position details
- [ ] Calculate totals and gains/losses

### Week 3: Dashboard & Charts
- [ ] Build dashboard layout
- [ ] Display account summary cards
- [ ] Create portfolio value chart (historical)
- [ ] Add time period selector

### Week 4: Holdings Table
- [ ] Build holdings table
- [ ] Calculate per-position gains/losses
- [ ] Add sorting and filtering
- [ ] Style table for mobile/desktop

### Week 5: Benchmarks & Extras
- [ ] Integrate benchmark data
- [ ] Show comparison cards
- [ ] Build best/worst performers lists
- [ ] Add asset allocation pie chart

### Week 6: Polish & Launch
- [ ] Fix bugs and edge cases
- [ ] Add error handling
- [ ] Optimize performance
- [ ] Deploy to Vercel
- [ ] Record demo video (60-90 sec)
- [ ] Submit to competition

---

## Key Implementation Details

### Data Model

```typescript
interface Portfolio {
  userId: string;
  accounts: Account[];
  lastUpdated: Date;
}

interface Account {
  accountId: string;
  accountType: string; // "TFSA", "RRSP", etc.
  balance: number;
  positions: Position[];
}

interface Position {
  symbol: string;
  quantity: number;
  currentPrice: number;
  averageCost: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
  currentValue: number;
}

interface DailySnapshot {
  date: Date;
  totalValue: number;
  totalGain: number;
  totalGainPercent: number;
}
```

### API Calls Flow

```
User Connects Account
  ↓
POST /api/auth/connect → Generate SnapTrade portal URL
  ↓
User logs in to Wealthsimple
  ↓
SnapTrade redirects back with connection token
  ↓
POST /api/auth/callback → Store token, fetch initial data
  ↓
GET /api/portfolio → Fetch accounts, positions, calculate metrics
  ↓
Display dashboard
```

### Performance Calculation

```typescript
function calculatePerformance(position: Position) {
  const totalCost = position.quantity * position.averageCost;
  const currentValue = position.quantity * position.currentPrice;
  const unrealizedGain = currentValue - totalCost;
  const unrealizedGainPercent = (unrealizedGain / totalCost) * 100;
  
  return {
    unrealizedGain,
    unrealizedGainPercent,
    currentValue,
    totalCost
  };
}

function calculatePortfolioMetrics(accounts: Account[]) {
  const totalValue = accounts.reduce((sum, acc) => sum + acc.balance, 0);
  const totalGain = accounts.reduce((sum, acc) => 
    sum + acc.positions.reduce((pSum, pos) => 
      pSum + (pos.currentValue - pos.quantity * pos.averageCost), 0), 0);
  
  return {
    totalValue,
    totalGain,
    totalGainPercent: (totalGain / (totalValue - totalGain)) * 100
  };
}
```

### Historical Data Strategy

**Option 1: Browser localStorage (Simpler)**
- Daily, store `{ date, totalValue }` in localStorage
- On each login, calculate change from yesterday
- Persists across sessions
- Limitation: Can't show history before first visit

**Option 2: Simple Backend (Better)**
- Create a cron job that runs daily
- Calls SnapTrade API for each user's portfolio
- Stores snapshot in SQLite/MongoDB
- Shows full historical graph immediately

**Recommendation for competition:** Start with localStorage for MVP, upgrade to backend snapshot if you have time.

---

## What Judges Will Love

1. **Live Data** — Real Wealthsimple account connected, not mock data
2. **Visual Polish** — Clean charts, responsive design, professional look
3. **Useful Metrics** — Gain/loss, allocation, benchmark comparison
4. **Mobile-Friendly** — Works on phone (investors check portfolio on mobile)
5. **Smart UX** — No crashes, clear error messages, fast loading
6. **Finish** — Polished, not half-baked; every button works

---

## Competition Submission Requirements

### Demo Video (60-90 seconds)
1. Open your app
2. Connect a Wealthsimple account (use sandbox if you want)
3. Show dashboard with real data
4. Click through holdings, charts, benchmarks
5. Point out one cool feature

### Submission Text
- What problem does it solve?
- How does it use SnapTrade?
- What's your tech stack?
- Any metrics: total users, data points, performance

### Source Code
- GitHub repo (public or private)
- Clean code, comments on complex logic
- README with setup instructions

---

## Competitive Advantages vs. Existing Tools

| Feature | Wealthsimple | Your App | Winner |
|---------|--------------|----------|--------|
| Basic account view | ✅ | ✅ | Tie |
| Detailed gain/loss tracking | ⚠️ Limited | ✅ Rich | You |
| Historical performance chart | ❌ | ✅ | You |
| Benchmark comparison | ❌ | ✅ | You |
| Asset allocation breakdown | ⚠️ Basic | ✅ Detailed | You |
| Mobile-first design | ✅ | ✅ | Tie |
| Real-time updates | ✅ | ✅ (via SnapTrade) | Tie |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| SnapTrade API down | Cache data locally, show cached results with "last updated" timestamp |
| User connects lots of accounts | Paginate or virtualize holdings table, optimize SnapTrade calls |
| Benchmark data unavailable | Gracefully degrade, show message "Benchmarks temporarily unavailable" |
| No historical data on day 1 | Accept that first day will show portfolio snapshot only, build history over time |
| Performance slow with big portfolio | Implement data pagination, lazy load, memoize calculations |

---

## Dream Features (Post-Competition)

- Real dividend tracking with historical payouts
- Tax-loss harvesting recommendations
- Automated rebalancing alerts
- Social features (share performance, compare with friends)
- ML-powered predictions (where will portfolio be in 1 year?)
- Integration with other brokers (Questrade, Interactive Brokers)
- Mobile app (React Native)

---

## Final Checklist Before Submission

- [ ] App connects to real Wealthsimple account
- [ ] Dashboard shows accurate totals
- [ ] Holdings table displays correctly
- [ ] Charts render with real data
- [ ] Benchmark comparison works
- [ ] Mobile view is functional
- [ ] No console errors
- [ ] SnapTrade credentials stored securely
- [ ] Demo video is clear and fast-paced
- [ ] GitHub repo has clean code
- [ ] README is complete with setup steps
- [ ] App handles edge cases (empty account, connection failure, etc.)

---

## Success Metrics

**Minimum for competition entry:** Dashboard + holdings + chart
**Good submission:** + Benchmark comparison + asset allocation
**Strong submission:** + All above + polished UI + zero bugs + great demo
**Winning submission:** Strong + unique insight (like tax-loss suggestions) + impressive performance + shows deep SnapTrade mastery

Good luck! This is a genuinely useful project that solves a real problem. 🚀
