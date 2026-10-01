# SnapTrade API Services Overview & Student Competition Analysis

## Executive Summary
SnapTrade is a developer-friendly API platform that acts as the "Plaid for trading" — enabling seamless integration of brokerage functionality into third-party financial applications. It provides access to 400M+ investor accounts through a single integration.

---

## Part 1: SnapTrade Core API Services

### 1. **Account Connection & Authentication**
- **User Registration**: Register new SnapTrade users under your Client ID
- **Secure OAuth Portal**: Generate redirect URIs for secure user login to the SnapTrade Connection Portal
- **Multi-Broker Support**: Connect users' existing brokerage accounts without requiring them to transfer accounts
- **De-duplication**: Automatic de-duping of connections to prevent duplicate connections per user
- **Supported Brokers**: Covers major brokers including:
  - Charles Schwab
  - Interactive Brokers (IBKR)
  - Alpaca
  - TradeStation
  - Tradier
  - And many others

### 2. **Account Data Retrieval (Normalized)**
- **Real-time Account Balance**: Retrieve current account balances across all connected accounts
- **Portfolio Positions**: Get detailed holdings information including assets, quantities, and values
- **Transaction History**: Access historical transactions and account activity
- **Normalized Data**: Data is standardized across all brokers, eliminating need to handle broker-specific formats
- **Account Information**: Retrieve metadata about user accounts

### 3. **Trading Capabilities**
- **Trade Execution**: Place trades directly through connected brokerage accounts
- **Checked Trading**: Implement safety checks before executing trades
- **Order Management**: Build native trading experiences without becoming a broker
- **Cost Reduction**: Avoid high costs of becoming a regulated broker yourself

### 4. **Authentication Methods**
- **Commercial API Key**: For fintech apps building on SnapTrade (clientId + consumerKey)
- **Personal API Key**: For individual developers building private dashboards or automations
- **Request Signatures**: Custom integration support with signature-based authentication
- **Security**: API keys remain secret; support for RSA public key encryption options

### 5. **Webhooks & Real-time Updates**
- **Event Notifications**: Receive webhook notifications when specific events occur
- **Commercial Webhooks**: API key webhook schema for partner integrations
- **OAuth Webhooks**: Alternative webhook patterns for OAuth-based integrations
- **Custom Integration Support**: Build automation triggered by account events

### 6. **Developer Tools & Support**
- **Multiple SDKs Available**:
  - TypeScript SDK (officially maintained)
  - Python SDK
  - Node.js SDK (original, note: some versions may be deprecated)
  - Direct API calls without SDK
  
- **Command-line Tool**: SnapTrade CLI for terminal-based operations
- **Dashboard**: SnapTrade Dashboard for API key management, billing, and configuration
- **Documentation**: Comprehensive documentation with full LLM support (llms-full.txt available)
- **Rate Limiting**: Built-in rate limiting protection (requests remaining shown per request)
- **Development Tools**: Testing and debugging endpoints for API authentication

### 7. **Specialized Features**
- **Sandbox Environment**: Test with simulated brokerage accounts and investment data
- **Build with AI**: Guidelines for building AI-powered investment applications securely
- **MCP Server**: Model Context Protocol server for enhanced AI integrations
- **Browser-API Integrations**: Support for various fintech integrations

---

## Part 2: SnapTrade Student Competition (Hack Atlantic 2026)

### **Competition Details**

**Program Name**: Build Something with SnapTrade | Hack Atlantic 2026

**Timeline**:
- **Submission Deadline**: Friday, October 9, 2026
- **Status**: Currently Open for Applications

**Eligibility**:
- Open to participants and student attendees of Hack Atlantic 2026
- One submission per person
- Projects must be your own work or authorized for submission

### **How to Get Started**

1. **Create Free Personal Account**:
   - Visit dashboard.snaptrade.com/signup
   - No credit card required
   - Get immediate API access

2. **Choose Your Data Source**:
   - **Option A**: Connect your own brokerage account (if you have one)
   - **Option B**: Use SnapTrade Sandbox with simulated accounts and data (if you don't have a real account)
   - **Option C**: Build a CLI-based project using the SnapTrade CLI

3. **Build Your Project**:
   - Doesn't need to be huge or overly polished
   - Should make meaningful use of SnapTrade
   - Can be any fintech application type (see ideas below)

### **Project Ideas**
- Investing app
- Portfolio dashboard
- CLI tool
- Automation workflow
- Data visualization
- AI-powered investment experience
- Tracker or analysis tool
- Any innovative application using SnapTrade

### **Evaluation Criteria**

Projects will be reviewed on four dimensions:

1. **Useful**: Does it solve a real problem or make something easier?
2. **Creative**: Is the idea or execution interesting and innovative?
3. **Good Use of SnapTrade**: Is SnapTrade an important part of how the project works?
4. **Works Well**: Can reviewers understand and see the project functioning properly?

### **Rewards & Recognition**

#### **For All Selected Projects (3 selected)**:
- ✅ **Featured on SnapTrade.com** in an article showcasing your project
- ✅ **Shared on LinkedIn** reaching SnapTrade's professional network
- ✅ **Resume/Portfolio Asset**: Public project you can link from:
  - Resume
  - Portfolio website
  - LinkedIn profile
  - Personal website

#### **For Top Project (1 selected)**:
- ✅ **1:1 Meeting with SnapTrade CEO** (Brendan Wood)
  - Discuss your project
  - Ask about building products, fintech, startups, careers
  - Get personalized feedback on future projects
  - Subject to availability and scheduling

### **Submission Requirements**

- **Demo Length**: 60-90 seconds
- **Video Platform**: YouTube (preferred) or Loom
- **Access**: Must be accessible without sign-in (unlisted videos are fine)
- **Submission Method**: Google Form provided on competition page
- **Deadline**: Friday, October 9, 2026

### **Career Opportunities**

- SnapTrade is actively hiring
- Careers page available at careers.snaptrade.com
- Strong track record of hiring talented developers from student competitions

### **Important Terms**

- Participants retain ownership of their projects
- By selecting, you grant SnapTrade permission to feature your name, project, and links
- CEO conversation available subject to scheduling
- SnapTrade may use automated tools including AI-assisted review
- Submission does not guarantee selection or employment consideration

---

## Part 3: Getting Started Roadmap

### **Phase 1: Setup (Week 1)**
1. Create free SnapTrade Personal account
2. Review official documentation at docs.snaptrade.com
3. Explore sandbox environment or connect real account
4. Download preferred SDK (TypeScript recommended)

### **Phase 2: Learning (Week 2)**
1. Read Getting Started guide
2. Learn Authentication Methods
3. Understand Terminology and core concepts
4. Review API reference for needed endpoints

### **Phase 3: Development (Weeks 3-4)**
1. Set up development environment
2. Implement user registration and authentication
3. Retrieve account data
4. Build your primary feature
5. Add error handling and logging (avoid logging sensitive financial data)

### **Phase 4: Testing & Polish (Week 5)**
1. Test with sandbox accounts
2. Handle partial API failures gracefully
3. Normalize responses into view models before rendering
4. Create demo video (60-90 seconds)
5. Prepare submission materials

### **Phase 5: Submission (Week 6)**
1. Upload demo video to YouTube/Loom
2. Complete submission form
3. Ensure video is accessible without login
4. Submit before October 9, 2026

---

## Part 4: Key Developer Resources

### **Official Documentation**
- **Main Docs**: https://docs.snaptrade.com/
- **Full Documentation Text**: https://docs.snaptrade.com/llms-full.txt
- **Markdown Versions**: Append `.md` to any documentation URL

### **API Reference Endpoints**
- API Status checking
- Authentication (register, delete users)
- Connections (manage brokerage authorizations)
- Account Information (balances, positions)
- Trading operations
- Webhook management

### **Tools & CLIs**
- SnapTrade CLI: https://github.com/passiv/snaptrade-cli
- Dashboard: https://dashboard.snaptrade.com
- Pricing: https://snaptrade.com/pricing

### **Support**
- Email: api@snaptrade.com
- Security Issues: security@snaptrade.com
- Terms: https://snaptrade.com/terms-and-conditions

---

## Part 5: Competitive Advantages & Use Cases

### **Why SnapTrade for Your Project**

1. **Minimal Friction**: Users don't need to transfer accounts
2. **Real Data Access**: 400M+ accounts across major brokers
3. **Comprehensive**: From authentication to trading execution
4. **Developer-Friendly**: SDKs in multiple languages
5. **Simulated Testing**: Sandbox environment for risk-free development
6. **Active Support**: Strong community and documentation

### **Example App Categories for Competition**

- **Portfolio Analytics**: Real-time P&L tracking, diversification analysis
- **AI Investment Assistants**: ChatGPT-style portfolio advice
- **Tax Optimization Tools**: Automated tax loss harvesting
- **Robo-advisor Tools**: Automated rebalancing
- **Social Trading**: Share portfolios, track friends' performance
- **Alert Systems**: Price alerts, portfolio threshold notifications
- **Data Visualization**: Interactive portfolio dashboards
- **Blockchain/Web3**: Crypto portfolio tracking (where supported)

---

## Conclusion

SnapTrade provides a comprehensive, developer-friendly platform perfect for students wanting to build fintech applications. The student competition offers significant exposure, career connections, and an opportunity to showcase your skills. With sandbox testing, real account connectivity, and multiple SDKs, you have everything needed to create a compelling project before the October 9 deadline.

**Next Step**: Create your free account at dashboard.snaptrade.com/signup and start building!
