# Marketing Automation Stack for xray.codes

**Goal**: Automate 80-95% of marketing execution across Reddit, Facebook, and X/Twitter using n8n workflows, AI agents, and browser automation.

**Philosophy**: Humans provide strategy and authenticity. Automation handles execution, monitoring, and optimization.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Central Orchestrator (n8n)                   │
├─────────────────────────────────────────────────────────────────────┤
│  • Schedule posts across platforms                                   │
│  • Coordinate AI agents                                              │
│  • Monitor engagement metrics                                        │
│  • Trigger responses based on rules                                  │
│  • Generate reports and alerts                                       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │              Platform Automation Layer             │
        ├───────────────────────────────────────────────────┤
        │  • Playwright Browser Automation                   │
        │  • API Integrations (X, Reddit)                    │
        │  • Webhook Listeners                               │
        └───────────────────────────────────────────────────┘
                                    │
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │              AI Agent Layer (Claude)               │
        ├───────────────────────────────────────────────────┤
        │  • Content Generation Agent                        │
        │  • Reply Agent (context-aware)                     │
        │  • Engagement Quality Checker                      │
        │  • Sentiment Analysis Agent                        │
        │  • Testimonial Extractor                           │
        └───────────────────────────────────────────────────┘
                                    │
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │              Data & Analytics Layer                │
        ├───────────────────────────────────────────────────┤
        │  • PostgreSQL (engagement tracking)                │
        │  • Redis (rate limiting, caching)                  │
        │  • AAARRR (telemetry sink)                         │
        └───────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Content Scheduler (n8n + Postgres)

**Purpose**: Schedule and publish posts across all platforms at optimal times

**Workflow**:
```
┌──────────────┐
│ Content DB   │ (Postgres table with prepared posts)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ n8n Cron     │ (Check every 15 minutes)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Is it time?  │ (Compare current time to scheduled_time)
└──────┬───────┘
       │ Yes
       ▼
┌──────────────┐
│ Platform     │ (Route to Reddit/FB/X workflow)
│ Router       │
└──────┬───────┘
       │
       ├─────────────────┬─────────────────┐
       ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Reddit API   │  │ Playwright   │  │ X API        │
│ Workflow     │  │ FB Workflow  │  │ Workflow     │
└──────────────┘  └──────────────┘  └──────────────┘
       │                 │                 │
       └─────────────────┴─────────────────┘
                         │
                         ▼
                ┌──────────────┐
                │ Mark as      │
                │ Published    │
                └──────┬───────┘
                       │
                       ▼
                ┌──────────────┐
                │ Start        │
                │ Monitoring   │
                └──────────────┘
```

**Database Schema**:
```sql
CREATE TABLE scheduled_posts (
    id UUID PRIMARY KEY,
    platform TEXT NOT NULL, -- 'reddit', 'facebook', 'twitter'
    community TEXT NOT NULL, -- subreddit name, FB group ID, or 'timeline'
    template_id TEXT NOT NULL,
    content TEXT NOT NULL,
    scheduled_time TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, published, failed
    published_at TIMESTAMPTZ,
    post_url TEXT,
    engagement_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scheduled_posts_pending
ON scheduled_posts(scheduled_time)
WHERE status = 'pending';
```

**n8n Workflow**: `content-scheduler.json`
- Trigger: Cron (every 15 minutes)
- Node 1: Postgres query (get pending posts where scheduled_time <= now)
- Node 2: Switch by platform
- Node 3a: Reddit API post
- Node 3b: Playwright FB post
- Node 3c: X API post
- Node 4: Update status to 'published'
- Node 5: Webhook to start engagement monitoring

---

### 2. Engagement Monitor (n8n + Redis)

**Purpose**: Track all mentions, replies, comments in real-time

**Workflow**:
```
Platform APIs/Webhooks
       │
       ▼
┌──────────────┐
│ n8n Webhook  │ (Receives engagement events)
│ Endpoint     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Parse Event  │ (Extract: user, content, type, post_id)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Store in     │ (Postgres + Redis cache)
│ Database     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Priority     │ (Score based on: sentiment, user influence,
│ Scoring      │  engagement count, keywords)
└──────┬───────┘
       │
       ├─────────────────┬─────────────────┐
       ▼ High            ▼ Medium          ▼ Low
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Immediate    │  │ Queue for    │  │ Queue for    │
│ Human Alert  │  │ AI Reply     │  │ Batch Reply  │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Priority Scoring Algorithm**:
```javascript
function calculatePriority(engagement) {
    let score = 0;

    // Sentiment analysis
    if (engagement.sentiment === 'positive') score += 20;
    if (engagement.sentiment === 'question') score += 30;
    if (engagement.sentiment === 'interested') score += 40; // "I'd use this"
    if (engagement.sentiment === 'negative') score += 50; // Address quickly

    // User influence
    if (engagement.user_followers > 10000) score += 20;
    if (engagement.user_followers > 50000) score += 30;

    // Engagement type
    if (engagement.type === 'direct_mention') score += 30;
    if (engagement.type === 'question') score += 25;
    if (engagement.type === 'beta_request') score += 35;

    // Keyword matching
    const highValueKeywords = ['interested', 'beta', 'try this', 'how do i', 'problem'];
    if (highValueKeywords.some(kw => engagement.content.toLowerCase().includes(kw))) {
        score += 20;
    }

    // Recency boost
    const ageMinutes = (Date.now() - engagement.created_at) / 60000;
    if (ageMinutes < 30) score += 15;

    return score;
}

// Priority levels:
// 80+: Human review immediately
// 50-79: AI reply within 15 minutes
// 20-49: AI reply within 2 hours
// < 20: Batch process daily
```

**Database Schema**:
```sql
CREATE TABLE engagements (
    id UUID PRIMARY KEY,
    post_id UUID REFERENCES scheduled_posts(id),
    platform TEXT NOT NULL,
    engagement_type TEXT NOT NULL, -- comment, reply, mention, dm
    user_id TEXT NOT NULL,
    user_name TEXT,
    user_followers INTEGER,
    content TEXT NOT NULL,
    sentiment TEXT, -- positive, negative, question, interested, neutral
    priority_score INTEGER,
    reply_status TEXT DEFAULT 'pending', -- pending, replied, skipped, escalated
    replied_at TIMESTAMPTZ,
    reply_content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_engagements_pending
ON engagements(priority_score DESC, created_at ASC)
WHERE reply_status = 'pending';
```

---

### 3. AI Reply Agent (Claude via n8n)

**Purpose**: Generate contextually appropriate replies automatically

**System Prompt**:
```
You are the founder of xray.codes, a developer tool that generates intelligent
codebase maps for AI assistants.

Context about xray:
- Solves: Developers spend 30-60 min preparing context for AI, AI implements in wrong places
- Solution: `xray map .` generates ranked architecture maps in 2 seconds
- Results: 85% time savings, 2x AI accuracy, 2 weeks → 4 days onboarding
- Status: Open source, just launched, building community
- Tone: Helpful, technical, humble, authentic

Your role:
1. Reply to comments/questions about xray authentically
2. Be helpful even if not directly about xray
3. Don't oversell - focus on solving their specific problem
4. If they express interest, offer GitHub link
5. If they have same pain, empathize and ask about their experience
6. If they criticize, thank them and ask for specifics

Guidelines:
- Keep replies under 200 words (concise)
- Match the tone of the original comment
- Don't use marketing language
- Be genuinely helpful
- Ask follow-up questions
- Never be defensive

Current context:
- Day {day_number} of 10-day launch campaign
- Platform: {platform}
- Their comment sentiment: {sentiment}
- Their comment: {comment_content}
```

**Workflow**:
```
┌──────────────┐
│ Engagement   │ (From monitoring queue)
│ Queued       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Fetch        │ (Get original post, previous replies,
│ Context      │  user history, conversation thread)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Build        │ (System prompt + context + comment)
│ AI Prompt    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Claude API   │ (Generate reply)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Quality      │ (Check: tone, length, helpfulness,
│ Check        │  no marketing speak, no errors)
└──────┬───────┘
       │
       ├────────── Pass ──────────┐
       │                          │
       ▼ Fail                     ▼
┌──────────────┐          ┌──────────────┐
│ Regenerate   │          │ Human        │
│ or Escalate  │          │ Approval     │
└──────────────┘          │ Queue        │
                          └──────┬───────┘
                                 │ Approved
                                 ▼
                          ┌──────────────┐
                          │ Post Reply   │
                          │ via API      │
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │ Mark as      │
                          │ Replied      │
                          └──────────────┘
```

**Quality Check Criteria**:
```javascript
function checkReplyQuality(reply, originalComment) {
    const issues = [];

    // Length check
    if (reply.length > 1000) issues.push('Too long');
    if (reply.length < 20) issues.push('Too short');

    // Marketing language detection
    const marketingWords = ['revolutionary', 'game-changing', 'amazing', 'incredible'];
    if (marketingWords.some(word => reply.toLowerCase().includes(word))) {
        issues.push('Marketing language detected');
    }

    // Tone matching
    if (originalComment.includes('?') && !reply.includes('?') && !reply.match(/here'?s|try/i)) {
        issues.push('Question not answered');
    }

    // Helpfulness check
    if (originalComment.sentiment === 'question' && !reply.match(/github|docs|example|try/i)) {
        issues.push('Not actionable enough');
    }

    // Defensive language
    const defensiveWords = ['actually', 'wrong', 'you should', 'just'];
    if (defensiveWords.filter(word => reply.toLowerCase().includes(word)).length > 1) {
        issues.push('Potentially defensive tone');
    }

    return {
        passed: issues.length === 0,
        issues: issues
    };
}
```

---

### 4. Platform-Specific Automation

### 4a. Reddit Automation (Playwright + n8n)

**Why Playwright**: Reddit API became prohibitively expensive in 2023 ($12,000+/year for commercial use). Browser automation is the only affordable option for solo founders. Free API tier is read-only and extremely limited.

**⚠️ Important Risks**:
- Account bans if automation detected
- CAPTCHAs can block automation
- Must appear human-like (random delays, realistic behavior)
- Use dedicated account, not personal account
- Conservative rate limiting essential

**Setup**:
```javascript
// reddit_automation.js
const { chromium } = require('playwright');

class RedditAutomation {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async init() {
        this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox']
        });

        // Load saved auth state (cookies)
        this.context = await this.browser.newContext({
            storageState: 'reddit_auth.json',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        });

        this.page = await this.context.newPage();
    }

    async postToSubreddit(subredditName, title, content) {
        try {
            // Navigate to subreddit
            await this.page.goto(`https://www.reddit.com/r/${subredditName}/submit`);
            await this.page.waitForLoadState('networkidle');
            await this.randomDelay(2000, 4000);

            // Check for CAPTCHA
            if (await this.detectCaptcha()) {
                return {
                    success: false,
                    error: 'CAPTCHA detected - manual intervention required',
                    needsManual: true
                };
            }

            // Click "Post" tab (text post)
            await this.page.click('button[name="text"]', { timeout: 10000 });
            await this.randomDelay(1000, 2000);

            // Fill title
            await this.page.fill('textarea[name="title"]', title);
            await this.randomDelay(1500, 3000);

            // Fill content (markdown editor)
            const contentBox = await this.page.locator('div[contenteditable="true"]').first();
            await contentBox.click();
            await this.randomDelay(500, 1000);

            // Type slowly like a human
            await this.humanTypeText(contentBox, content);
            await this.randomDelay(2000, 4000);

            // Click Post button
            await this.page.click('button:has-text("Post")', { timeout: 10000 });
            await this.page.waitForTimeout(5000);

            // Get post URL from redirect
            const postUrl = this.page.url();

            return {
                success: true,
                url: postUrl,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                needsManual: error.message.includes('timeout') || error.message.includes('CAPTCHA')
            };
        }
    }

    async monitorPostReplies(postUrl, lastCheckTime) {
        try {
            await this.page.goto(postUrl);
            await this.page.waitForLoadState('networkidle');
            await this.randomDelay(2000, 3000);

            // Extract comments
            const comments = await this.page.evaluate((lastCheck) => {
                const results = [];
                const commentElements = document.querySelectorAll('[data-testid="comment"]');

                commentElements.forEach(el => {
                    const authorEl = el.querySelector('[data-testid="comment_author_link"]');
                    const textEl = el.querySelector('[data-testid="comment"]');
                    const timeEl = el.querySelector('a[data-click-id="timestamp"]');

                    if (authorEl && textEl) {
                        results.push({
                            author: authorEl.textContent.trim(),
                            content: textEl.textContent.trim(),
                            timestamp: timeEl?.getAttribute('href') || '',
                            permalink: window.location.href
                        });
                    }
                });

                return results;
            }, lastCheckTime);

            return comments;
        } catch (error) {
            console.error('Monitor error:', error);
            return [];
        }
    }

    async replyToComment(commentPermalink, replyText) {
        try {
            await this.page.goto(commentPermalink);
            await this.page.waitForLoadState('networkidle');
            await this.randomDelay(2000, 4000);

            // Check for CAPTCHA
            if (await this.detectCaptcha()) {
                return {
                    success: false,
                    error: 'CAPTCHA detected',
                    needsManual: true
                };
            }

            // Click reply button
            await this.page.click('button:has-text("Reply")', { timeout: 10000 });
            await this.randomDelay(1000, 2000);

            // Find reply textarea
            const replyBox = await this.page.locator('textarea[name="markdown"]').last();
            await replyBox.click();
            await this.randomDelay(500, 1000);

            // Type slowly like a human
            await this.humanTypeText(replyBox, replyText);
            await this.randomDelay(2000, 3000);

            // Click Save
            await this.page.click('button:has-text("Save")', { timeout: 10000 });
            await this.page.waitForTimeout(3000);

            return {
                success: true,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                needsManual: true
            };
        }
    }

    async detectCaptcha() {
        // Check for common CAPTCHA indicators
        const captchaSelectors = [
            'iframe[src*="recaptcha"]',
            'iframe[src*="hcaptcha"]',
            '.g-recaptcha',
            '[data-testid="captcha"]'
        ];

        for (const selector of captchaSelectors) {
            const element = await this.page.$(selector);
            if (element) return true;
        }
        return false;
    }

    async randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await this.page.waitForTimeout(delay);
    }

    async humanTypeText(element, text) {
        // Type with random delays like a human
        for (const char of text) {
            await element.type(char, { delay: Math.random() * 100 + 50 });
        }
    }

    async close() {
        await this.browser?.close();
    }
}

module.exports = RedditAutomation;
```

**Authentication Setup**:
```javascript
// Save Reddit auth state (run once manually)
async function saveRedditAuth() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://www.reddit.com/login');

    // Wait for manual login
    console.log('Please log in manually...');
    await page.waitForURL('**/reddit.com/**', { timeout: 300000 }); // 5 min

    // Save auth state
    await context.storageState({ path: 'reddit_auth.json' });
    await browser.close();

    console.log('Auth state saved to reddit_auth.json');
}
```

**n8n Workflow**: `reddit-automation.json`
- **Posting Workflow**:
  - Trigger: HTTP webhook from scheduler
  - Node 1: Execute Node.js script (RedditAutomation.postToSubreddit)
  - Node 2: Check if success or needsManual
  - Node 3a (success): Store post URL in database
  - Node 3b (needsManual): Send alert to Slack for manual posting
  - Node 4: Start monitoring workflow

- **Monitoring Workflow**:
  - Trigger: Cron (every 15 minutes - conservative)
  - Node 1: Execute script (RedditAutomation.monitorPostReplies)
  - Node 2: For each new comment, insert into engagements
  - Node 3: Calculate priority score
  - Node 4: Route to reply queue based on priority

- **Reply Workflow**:
  - Trigger: Cron (every 30 minutes - very conservative)
  - Node 1: Fetch pending replies from queue
  - Node 2: For each, call Claude API
  - Node 3: Quality check
  - Node 4: If passed, execute script (RedditAutomation.replyToComment)
  - Node 5: If needsManual, send to Slack for manual reply
  - Node 6: Update engagement as replied

**Rate Limiting** (Redis - Very Conservative):
```javascript
// Conservative Reddit rate limits to avoid bans
async function canPostToReddit(subreddit) {
    const key = `reddit:post:${subreddit}`;
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 7200); // 2 hours per subreddit
    }

    // Max 1 post per subreddit every 2 hours (human-like)
    return count <= 1;
}

async function canReplyOnReddit() {
    const key = 'reddit:reply_limit';
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 1800); // 30 minutes
    }

    // Max 1 reply per 30 minutes (very conservative)
    return count <= 1;
}

async function canMonitorReddit() {
    const key = 'reddit:monitor_limit';
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 900); // 15 minutes
    }

    // Max 1 monitoring check per 15 minutes
    return count <= 1;
}
```

---

### 4b. Facebook Automation (Playwright + n8n)

**Why Playwright**: Facebook doesn't have a good API for personal accounts posting to groups. Browser automation is necessary.

**Setup**:
```javascript
// facebook_automation.js
const { chromium } = require('playwright');

class FacebookAutomation {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async init() {
        this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox']
        });

        // Load saved auth state (cookies)
        this.context = await this.browser.newContext({
            storageState: 'facebook_auth.json'
        });

        this.page = await this.context.newPage();
    }

    async postToGroup(groupId, content) {
        try {
            // Navigate to group
            await this.page.goto(`https://www.facebook.com/groups/${groupId}`);
            await this.page.waitForLoadState('networkidle');

            // Click "Write something..." button
            await this.page.click('[aria-label="Write something..."]', { timeout: 10000 });
            await this.page.waitForTimeout(2000);

            // Type content
            const textbox = await this.page.locator('[contenteditable="true"]').first();
            await textbox.fill(content);
            await this.page.waitForTimeout(1000);

            // Click Post button
            await this.page.click('[aria-label="Post"]');
            await this.page.waitForTimeout(3000);

            // Get post URL (from redirect or current URL)
            const postUrl = this.page.url();

            return {
                success: true,
                url: postUrl,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async monitorGroupPosts(groupId, lastCheckTime) {
        try {
            await this.page.goto(`https://www.facebook.com/groups/${groupId}`);
            await this.page.waitForLoadState('networkidle');

            // Scroll to load recent posts
            await this.page.evaluate(() => window.scrollBy(0, 1000));
            await this.page.waitForTimeout(2000);

            // Extract post data
            const posts = await this.page.evaluate((lastCheck) => {
                const results = [];
                const postElements = document.querySelectorAll('[data-ad-preview="message"]');

                postElements.forEach(el => {
                    const timeEl = el.closest('[role="article"]')?.querySelector('a[href*="/posts/"]');
                    const textContent = el.textContent;
                    const postUrl = timeEl?.href;

                    if (postUrl && textContent) {
                        results.push({
                            content: textContent,
                            url: postUrl,
                            timestamp: new Date().toISOString()
                        });
                    }
                });

                return results;
            }, lastCheckTime);

            return posts;
        } catch (error) {
            console.error('Monitor error:', error);
            return [];
        }
    }

    async replyToPost(postUrl, replyText) {
        try {
            await this.page.goto(postUrl);
            await this.page.waitForLoadState('networkidle');

            // Find and click comment box
            await this.page.click('[aria-label="Write a comment..."]');
            await this.page.waitForTimeout(1000);

            // Type reply
            const commentBox = await this.page.locator('[contenteditable="true"]').last();
            await commentBox.fill(replyText);
            await this.page.waitForTimeout(1000);

            // Submit
            await this.page.keyboard.press('Enter');
            await this.page.waitForTimeout(2000);

            return {
                success: true,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async close() {
        await this.browser?.close();
    }
}

module.exports = FacebookAutomation;
```

**n8n Workflow**: `facebook-automation.json`
- **Posting Workflow**:
  - Trigger: HTTP webhook from scheduler
  - Node 1: Execute Node.js script (FacebookAutomation.postToGroup)
  - Node 2: Store post URL in database
  - Node 3: Start monitoring workflow

- **Monitoring Workflow**:
  - Trigger: Cron (every 10 minutes)
  - Node 1: Execute script (FacebookAutomation.monitorGroupPosts)
  - Node 2: For each new comment, insert into engagements
  - Node 3: Calculate priority
  - Node 4: Route to reply queue

**Authentication Setup**:
```javascript
// Save Facebook auth state (run once manually)
async function saveAuthState() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://www.facebook.com');

    // Wait for manual login
    console.log('Please log in manually...');
    await page.waitForURL('**/feed/**', { timeout: 300000 }); // 5 min

    // Save auth state
    await context.storageState({ path: 'facebook_auth.json' });
    await browser.close();

    console.log('Auth state saved to facebook_auth.json');
}
```

**Rate Limiting** (Redis - Conservative):
```javascript
async function canPostToFacebook(groupId) {
    const key = `facebook:post:${groupId}`;
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 7200); // 2 hours per group
    }

    // Max 1 post per group every 2 hours (conservative)
    return count <= 1;
}

async function canReplyOnFacebook() {
    const key = 'facebook:reply_limit';
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 900); // 15 minutes
    }

    // Max 1 reply per 15 minutes (conservative)
    return count <= 1;
}

async function canMonitorFacebook() {
    const key = 'facebook:monitor_limit';
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 1200); // 20 minutes
    }

    // Max 1 monitoring check per 20 minutes
    return count <= 1;
}
```

---

### 4c. X/Twitter Automation (Playwright + n8n)

**Why Playwright**: X eliminated free API tier in 2023. Paid tiers are expensive:
- Basic: $100/month (1,500 posts/month limit)
- Pro: $5,000/month (serious automation)
- Enterprise: Custom pricing (tens of thousands/month)

Browser automation is the only affordable option for solo founders.

**⚠️ Important Risks**:
- Account suspension if automation detected
- CAPTCHAs and phone verification challenges
- Must appear extremely human-like
- Use dedicated account, not personal account
- Very conservative rate limiting required
- X is aggressive about detecting and banning bots

**Setup**:
```javascript
// twitter_automation.js
const { chromium } = require('playwright');

class TwitterAutomation {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async init() {
        this.browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        // Load saved auth state (cookies)
        this.context = await this.browser.newContext({
            storageState: 'twitter_auth.json',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            viewport: { width: 1280, height: 720 },
            locale: 'en-US',
            timezoneId: 'America/New_York'
        });

        // Hide automation indicators
        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        this.page = await this.context.newPage();
    }

    async postTweet(text) {
        try {
            // Navigate to Twitter home
            await this.page.goto('https://twitter.com/home');
            await this.page.waitForLoadState('networkidle');
            await this.randomDelay(2000, 4000);

            // Check for verification challenges
            if (await this.detectChallenge()) {
                return {
                    success: false,
                    error: 'Verification challenge detected',
                    needsManual: true
                };
            }

            // Find tweet compose box
            const tweetBox = await this.page.locator('[data-testid="tweetTextarea_0"]').first();
            await tweetBox.click();
            await this.randomDelay(1000, 2000);

            // Type tweet slowly like a human
            await this.humanTypeText(tweetBox, text);
            await this.randomDelay(2000, 4000);

            // Click Tweet button
            await this.page.click('[data-testid="tweetButtonInline"]', { timeout: 10000 });
            await this.page.waitForTimeout(3000);

            // Get tweet URL (appears briefly in notifications)
            const tweetUrl = await this.getLatestTweetUrl();

            return {
                success: true,
                url: tweetUrl,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                needsManual: true
            };
        }
    }

    async postThread(tweets) {
        try {
            const results = [];
            let previousTweetBox = null;

            for (let i = 0; i < tweets.length; i++) {
                if (i === 0) {
                    // First tweet
                    await this.page.goto('https://twitter.com/home');
                    await this.page.waitForLoadState('networkidle');
                    await this.randomDelay(2000, 4000);

                    const tweetBox = await this.page.locator('[data-testid="tweetTextarea_0"]').first();
                    await tweetBox.click();
                    await this.randomDelay(1000, 2000);
                    await this.humanTypeText(tweetBox, tweets[i]);
                } else {
                    // Add tweet to thread
                    await this.page.click('[data-testid="addButton"]', { timeout: 10000 });
                    await this.randomDelay(1000, 2000);

                    const nextBox = await this.page.locator(`[data-testid="tweetTextarea_${i}"]`).first();
                    await nextBox.click();
                    await this.randomDelay(500, 1000);
                    await this.humanTypeText(nextBox, tweets[i]);
                }

                await this.randomDelay(1500, 3000);
            }

            // Post entire thread
            await this.page.click('[data-testid="tweetButton"]', { timeout: 10000 });
            await this.page.waitForTimeout(5000);

            const threadUrl = await this.getLatestTweetUrl();

            return {
                success: true,
                url: threadUrl,
                count: tweets.length,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                needsManual: true
            };
        }
    }

    async monitorMentions() {
        try {
            await this.page.goto('https://twitter.com/notifications/mentions');
            await this.page.waitForLoadState('networkidle');
            await this.randomDelay(2000, 3000);

            // Extract mentions
            const mentions = await this.page.evaluate(() => {
                const results = [];
                const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');

                tweetElements.forEach(el => {
                    const textEl = el.querySelector('[data-testid="tweetText"]');
                    const authorEl = el.querySelector('[data-testid="User-Name"]');
                    const timeEl = el.querySelector('time');

                    if (textEl && authorEl) {
                        results.push({
                            text: textEl.textContent,
                            author: authorEl.textContent,
                            timestamp: timeEl?.getAttribute('datetime') || new Date().toISOString(),
                            url: window.location.href
                        });
                    }
                });

                return results;
            });

            return mentions;
        } catch (error) {
            console.error('Monitor mentions error:', error);
            return [];
        }
    }

    async replyToTweet(tweetUrl, replyText) {
        try {
            await this.page.goto(tweetUrl);
            await this.page.waitForLoadState('networkidle');
            await this.randomDelay(2000, 4000);

            // Check for verification challenges
            if (await this.detectChallenge()) {
                return {
                    success: false,
                    error: 'Verification challenge detected',
                    needsManual: true
                };
            }

            // Click reply button
            await this.page.click('[data-testid="reply"]', { timeout: 10000 });
            await this.randomDelay(1000, 2000);

            // Find reply box
            const replyBox = await this.page.locator('[data-testid="tweetTextarea_0"]').first();
            await replyBox.click();
            await this.randomDelay(500, 1000);

            // Type reply slowly
            await this.humanTypeText(replyBox, replyText);
            await this.randomDelay(2000, 3000);

            // Click Reply button
            await this.page.click('[data-testid="tweetButtonInline"]', { timeout: 10000 });
            await this.page.waitForTimeout(3000);

            return {
                success: true,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                needsManual: true
            };
        }
    }

    async getLatestTweetUrl() {
        // Navigate to profile to get latest tweet
        await this.page.goto('https://twitter.com/home');
        await this.page.waitForTimeout(2000);

        const latestTweet = await this.page.locator('article[data-testid="tweet"]').first();
        const tweetLink = await latestTweet.locator('a[href*="/status/"]').first();
        const href = await tweetLink.getAttribute('href');

        return `https://twitter.com${href}`;
    }

    async detectChallenge() {
        // Check for common verification challenges
        const challengeSelectors = [
            'input[name="verfication_code"]',
            '[data-testid="ocfEnterTextTextInput"]',
            'text=Verify your phone number',
            'text=Enter your phone number',
            'text=We need to verify'
        ];

        for (const selector of challengeSelectors) {
            try {
                const element = await this.page.$(selector);
                if (element) return true;
            } catch (e) {
                // Continue checking
            }
        }
        return false;
    }

    async randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await this.page.waitForTimeout(delay);
    }

    async humanTypeText(element, text) {
        // Type with random delays like a human
        for (const char of text) {
            await element.type(char, { delay: Math.random() * 150 + 50 });

            // Occasional longer pauses (thinking)
            if (Math.random() < 0.1) {
                await this.page.waitForTimeout(Math.random() * 1000 + 500);
            }
        }
    }

    async close() {
        await this.browser?.close();
    }
}

module.exports = TwitterAutomation;
```

**Authentication Setup**:
```javascript
// Save Twitter auth state (run once manually)
async function saveTwitterAuth() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });
    const page = await context.newPage();

    await page.goto('https://twitter.com/login');

    // Wait for manual login
    console.log('Please log in manually...');
    await page.waitForURL('**/home', { timeout: 300000 }); // 5 min

    // Save auth state
    await context.storageState({ path: 'twitter_auth.json' });
    await browser.close();

    console.log('Auth state saved to twitter_auth.json');
}
```

**n8n Workflow**: `twitter-automation.json`
- **Posting Workflow**:
  - Trigger: HTTP webhook from scheduler
  - Node 1: Check if single tweet or thread
  - Node 2a: Execute script (TwitterAutomation.postTweet)
  - Node 2b: Execute script (TwitterAutomation.postThread)
  - Node 3: Check if success or needsManual
  - Node 4a (success): Store tweet URL in database
  - Node 4b (needsManual): Send alert to Slack for manual posting
  - Node 5: Start monitoring workflow

- **Monitoring Workflow**:
  - Trigger: Cron (every 20 minutes - very conservative)
  - Node 1: Execute script (TwitterAutomation.monitorMentions)
  - Node 2: For each new mention, insert into engagements
  - Node 3: Calculate priority
  - Node 4: Route to reply queue

- **Reply Workflow**:
  - Trigger: Cron (every 45 minutes - extremely conservative)
  - Node 1: Fetch pending replies from queue
  - Node 2: For each, call Claude API
  - Node 3: Quality check
  - Node 4: If passed, execute script (TwitterAutomation.replyToTweet)
  - Node 5: If needsManual, send to Slack for manual reply
  - Node 6: Update engagement as replied

**Rate Limiting** (Redis - Extremely Conservative to Avoid Bans):
```javascript
// Very conservative X/Twitter rate limits for browser automation
async function canPostToTwitter() {
    const key = 'twitter:post_limit';
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 10800); // 3 hours
    }

    // Max 1 tweet per 3 hours (extremely conservative)
    // Human-like: real users don't post every 15 minutes
    return count <= 1;
}

async function canReplyOnTwitter() {
    const key = 'twitter:reply_limit';
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 2700); // 45 minutes
    }

    // Max 1 reply per 45 minutes (very conservative)
    return count <= 1;
}

async function canMonitorTwitter() {
    const key = 'twitter:monitor_limit';
    const count = await redis.incr(key);

    if (count === 1) {
        await redis.expire(key, 1200); // 20 minutes
    }

    // Max 1 monitoring check per 20 minutes
    return count <= 1;
}
```

---

### 5. Analytics Dashboard (n8n + AAARRR)

**Purpose**: Real-time visibility into campaign performance

**Metrics to Track**:
```sql
-- Daily engagement summary
CREATE MATERIALIZED VIEW daily_engagement_summary AS
SELECT
    DATE(created_at) as date,
    platform,
    COUNT(*) as total_engagements,
    COUNT(*) FILTER (WHERE sentiment = 'positive') as positive_count,
    COUNT(*) FILTER (WHERE sentiment = 'question') as question_count,
    COUNT(*) FILTER (WHERE sentiment = 'interested') as interested_count,
    COUNT(*) FILTER (WHERE reply_status = 'replied') as replied_count,
    AVG(priority_score) as avg_priority
FROM engagements
GROUP BY DATE(created_at), platform;

-- Campaign performance
CREATE MATERIALIZED VIEW campaign_performance AS
SELECT
    sp.platform,
    sp.community,
    sp.template_id,
    COUNT(e.id) as total_engagements,
    COUNT(e.id) FILTER (WHERE e.sentiment = 'interested') as interest_signals,
    COUNT(e.id) FILTER (WHERE e.content ILIKE '%try%' OR e.content ILIKE '%beta%') as beta_requests,
    sp.engagement_data->>'github_stars' as github_stars_attributed
FROM scheduled_posts sp
LEFT JOIN engagements e ON e.post_id = sp.id
WHERE sp.status = 'published'
GROUP BY sp.platform, sp.community, sp.template_id, sp.engagement_data;
```

**n8n Workflow**: `analytics-dashboard.json`
- **Trigger**: Cron (every hour)
- **Node 1**: Refresh materialized views
- **Node 2**: Query key metrics
- **Node 3**: Send to AAARRR telemetry sink
- **Node 4**: Generate alerts if anomalies detected

**Dashboard Metrics**:
```javascript
{
    "campaign_day": 3,
    "total_posts": 15,
    "total_engagements": 247,
    "engagement_breakdown": {
        "reddit": 128,
        "facebook": 76,
        "twitter": 43
    },
    "sentiment_breakdown": {
        "positive": 89,
        "question": 67,
        "interested": 45,
        "negative": 12,
        "neutral": 34
    },
    "reply_status": {
        "replied": 198,
        "pending": 34,
        "escalated": 15
    },
    "interest_signals": {
        "beta_requests": 23,
        "i_would_use": 45,
        "github_stars_today": 67
    },
    "top_performing_posts": [
        {
            "platform": "twitter",
            "template": "data-thread",
            "engagements": 89,
            "impressions": 45000
        }
    ]
}
```

**Alert Conditions**:
```javascript
// Alert if engagement drops significantly
if (today.total_engagements < yesterday.total_engagements * 0.5) {
    sendAlert('Engagement dropped 50%+ today');
}

// Alert if negative sentiment spikes
if (today.negative_count > 20 && today.negative_count > yesterday.negative_count * 2) {
    sendAlert('Negative sentiment spike detected');
}

// Alert if reply queue builds up
if (pending_replies > 50) {
    sendAlert('Reply queue backlog: ' + pending_replies + ' pending');
}

// Alert if high-priority items unhandled
if (high_priority_unhandled > 10) {
    sendAlert('10+ high-priority engagements need human review');
}
```

---

### 6. Human-in-the-Loop Workflows

**Purpose**: Keep humans involved for authenticity and quality control

**Approval Queue (n8n + Slack)**:
```
High-Priority Engagement Detected
       │
       ▼
┌──────────────┐
│ Send Slack   │ (With context and suggested reply)
│ Notification │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Human        │ Options:
│ Reviews      │ 1. ✅ Approve AI reply
└──────┬───────┘ 2. ✏️ Edit AI reply
       │         3. 🚫 Skip
       │         4. 💬 Write custom reply
       │
       ├─────────────────┬─────────────────┬─────────────────┐
       ▼ Approve         ▼ Edit            ▼ Skip            ▼ Custom
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Post AI      │  │ Post Edited  │  │ Mark as      │  │ Post Human   │
│ Reply        │  │ Reply        │  │ Skipped      │  │ Reply        │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

**Slack Integration**:
```javascript
// Send approval request to Slack
async function sendApprovalRequest(engagement, suggestedReply) {
    const blocks = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*High-Priority ${engagement.platform} Engagement*\n\n` +
                      `*User:* ${engagement.user_name}\n` +
                      `*Sentiment:* ${engagement.sentiment}\n` +
                      `*Priority:* ${engagement.priority_score}\n\n` +
                      `*Their comment:*\n> ${engagement.content}`
            }
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*Suggested reply:*\n${suggestedReply}`
            }
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: { type: "plain_text", text: "✅ Approve" },
                    style: "primary",
                    value: `approve:${engagement.id}`
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "✏️ Edit" },
                    value: `edit:${engagement.id}`
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "🚫 Skip" },
                    style: "danger",
                    value: `skip:${engagement.id}`
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "💬 Custom Reply" },
                    value: `custom:${engagement.id}`
                }
            ]
        }
    ];

    await slackClient.chat.postMessage({
        channel: '#marketing-automation',
        text: 'High-priority engagement needs review',
        blocks: blocks
    });
}

// Handle Slack button interactions
app.action(/approve:(.*)/, async ({ ack, action, client }) => {
    await ack();

    const engagementId = action.value.split(':')[1];

    // Post the AI-generated reply
    await postReply(engagementId);

    // Update Slack message
    await client.chat.update({
        channel: action.channel.id,
        ts: action.message.ts,
        text: '✅ Approved and posted',
        blocks: []
    });
});
```

**Daily Human Review**:
```
End of Day (8pm daily)
       │
       ▼
┌──────────────┐
│ Generate     │ - Posts published today
│ Daily Report │ - Engagements received
└──────┬───────┘ - Replies sent
       │         - Top performers
       ▼         - Issues/anomalies
┌──────────────┐
│ Send to      │ (Slack + Email)
│ Founder      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Founder      │ - Spot-check quality
│ Reviews      │ - Adjust strategy
└──────┬───────┘ - Override priorities
       │
       ▼
┌──────────────┐
│ Update       │ - Adjust AI prompts
│ Settings     │ - Change posting schedule
└──────────────┘ - Update templates
```

---

### 7. Content Generation Assistant

**Purpose**: AI-assisted creation of variations for templates

**Workflow**:
```
Human: "Generate 3 variations of Template 1 for r/webdev"
       │
       ▼
┌──────────────┐
│ Claude API   │ Prompt:
└──────┬───────┘ - Original template
       │         - Target community context
       ▼         - Variation goals (tone, angle, length)
┌──────────────┐
│ Generate     │ Output: 3 variations
│ Variations   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Store in     │ (staged_posts table)
│ Database     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Human        │ - Review variations
│ Reviews      │ - Edit if needed
└──────┬───────┘ - Approve for scheduling
       │
       ▼
┌──────────────┐
│ Add to       │ (scheduled_posts table)
│ Schedule     │
└──────────────┘
```

**Content Generation Prompt**:
```
You are helping create authentic social media posts for xray.codes launch campaign.

Context:
- Product: xray.codes (generates ranked codebase maps for AI assistants)
- Campaign: 10-day launch across Reddit, Facebook, X
- Goal: Validate pain, build community, get beta testers

Original template:
{template_content}

Target community: {community_name}
Community vibe: {community_description}

Generate 3 variations that:
1. Keep the core message and authenticity
2. Adjust tone to match community vibe
3. Vary the hook/opening
4. Maintain 150-300 word length
5. Don't sound like marketing copy
6. Include specific details and numbers

Output format:
## Variation 1
[content]

## Variation 2
[content]

## Variation 3
[content]
```

---

## Automation Coverage Breakdown

### Fully Automated (95%+)
1. ✅ **Content Scheduling** - 100% automated
2. ✅ **Post Publishing** - 95% automated (5% manual verification)
3. ✅ **Engagement Monitoring** - 100% automated
4. ✅ **Low-Priority Replies** - 90% automated (10% human review)
5. ✅ **Analytics Tracking** - 100% automated
6. ✅ **Rate Limiting** - 100% automated
7. ✅ **Data Storage** - 100% automated

### Semi-Automated (50-80%)
1. ⚙️ **Medium-Priority Replies** - 70% automated (30% human approval)
2. ⚙️ **Content Variations** - 60% automated (40% human editing)
3. ⚙️ **Testimonial Collection** - 80% automated (20% human curation)

### Human-Required (20-40% automation)
1. 👤 **High-Priority Engagements** - 40% automated (60% human handling)
2. 👤 **Strategic Decisions** - 20% automated (80% human judgment)
3. 👤 **Crisis Management** - 30% automated (70% human intervention)
4. 👤 **Community Relationship Building** - 30% automated (70% human touch)

**Overall Automation**: **85-90%** of routine tasks

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
**Goal**: Get basic posting and monitoring working

**Tasks**:
1. Set up n8n instance (Docker or cloud)
2. Set up PostgreSQL database (schema above)
3. Set up Redis (rate limiting)
4. Create Reddit API integration
5. Create Twitter API integration
6. Create basic Playwright Facebook automation
7. Build content scheduler workflow
8. Build engagement monitor workflow
9. Test with 1-2 posts per platform

**Success Criteria**:
- ✅ Can schedule posts
- ✅ Posts publish automatically
- ✅ Engagement monitoring works
- ✅ Data stored in database

---

### Phase 2: AI Integration (Week 2)
**Goal**: Add AI-powered reply generation

**Tasks**:
1. Build Claude API integration in n8n
2. Create reply generation workflow
3. Implement quality checking
4. Set up Slack approval workflow
5. Build priority scoring algorithm
6. Test with 10-20 real engagements
7. Tune prompts based on results

**Success Criteria**:
- ✅ AI generates contextual replies
- ✅ Quality check catches bad replies
- ✅ Human approval works via Slack
- ✅ Replies post automatically after approval

---

### Phase 3: Scale & Polish (Week 3)
**Goal**: Handle full campaign volume

**Tasks**:
1. Optimize rate limiting
2. Add error handling and retries
3. Build analytics dashboard
4. Set up AAARRR telemetry integration
5. Create daily report workflow
6. Add content variation generator
7. Test with full Day 1 campaign load

**Success Criteria**:
- ✅ Handles 20+ posts per day
- ✅ Handles 100+ engagements per day
- ✅ Analytics dashboard updates in real-time
- ✅ Humans only involved for high-priority items
- ✅ System runs reliably for 24 hours

---

### Phase 4: Campaign Launch (Week 4)
**Goal**: Run full 10-day campaign

**Tasks**:
1. Load all templates into database
2. Schedule Day 1-10 posts
3. Monitor and adjust daily
4. Collect testimonials
5. Generate daily reports
6. Optimize based on performance

**Success Criteria**:
- ✅ 90%+ posts published on schedule
- ✅ 85%+ engagements replied to within SLA
- ✅ No human burnout (< 2 hours/day human time)
- ✅ Campaign goals met (stars, users, testimonials)

---

## Infrastructure Requirements (Browser Automation Stack)

### Servers & Services
```yaml
n8n:
  type: docker-compose
  cpu: 2 cores
  ram: 4GB
  storage: 20GB
  cost: $20/month (DigitalOcean Droplet)
  notes: Runs n8n + Playwright containers

postgres:
  type: managed-database
  size: small (1 CPU, 1GB RAM)
  storage: 25GB
  cost: $15/month (DigitalOcean Managed Database)
  notes: Stores posts, engagements, analytics

redis:
  type: managed-redis
  size: small (1GB RAM)
  cost: $10/month (DigitalOcean Managed Redis)
  notes: Rate limiting, caching, session management

playwright_browsers:
  type: docker-container (within n8n server)
  cpu: included
  ram: included
  cost: $0 (runs on n8n server)
  notes: Chromium for Reddit, Facebook, X automation

claude_api:
  type: api
  tier: pro
  cost: ~$50/month (estimated for campaign period only)
  notes: Reply generation, content quality checking

social_media_apis:
  reddit_api: $0 (using browser automation, not API)
  twitter_api: $0 (using browser automation, not API)
  facebook_api: $0 (no good API exists)
  SAVINGS: $13,200/year vs paid API approach

total_monthly_cost:
  infrastructure: $45/month (ongoing)
  claude_api: $50/month (campaign period only)
  total_during_campaign: $95/month
  total_maintenance: $45/month
```

**Annual cost breakdown**:
- Infrastructure (12 months): $540
- Claude API (4 campaign months): $200
- **Total: $740/year**

### Docker Compose Setup
```yaml
# docker-compose.yml
version: '3'

services:
  n8n:
    image: n8nio/n8n
    restart: always
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
      - N8N_HOST=${N8N_HOST}
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - NODE_ENV=production
      - WEBHOOK_URL=https://${N8N_HOST}/
      - GENERIC_TIMEZONE=America/New_York
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_DATABASE=${POSTGRES_DB}
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_USER=${POSTGRES_USER}
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - ./n8n_data:/home/node/.n8n
      - ./custom_scripts:/opt/custom_scripts
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    restart: always
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./sql/init.sql:/docker-entrypoint-initdb.d/init.sql

  redis:
    image: redis:7
    restart: always
    volumes:
      - redis_data:/data

  playwright:
    build: ./playwright
    restart: always
    volumes:
      - ./reddit_auth.json:/app/reddit_auth.json
      - ./twitter_auth.json:/app/twitter_auth.json
      - ./facebook_auth.json:/app/facebook_auth.json
      - ./automation_scripts:/app/scripts
    environment:
      - NODE_ENV=production
      - PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

volumes:
  postgres_data:
  redis_data:
  n8n_data:
```

---

## Manual Posting Backup Strategies

**Philosophy**: Browser automation can fail due to CAPTCHAs, account challenges, or platform changes. Always have a manual backup plan.

### When to Fall Back to Manual Posting

**Automation Failure Indicators**:
1. **CAPTCHA detected** - immediate manual intervention required
2. **Account challenge** (verify phone, unusual activity warning)
3. **3+ consecutive automation failures** on same platform
4. **Rate limit hit** (even with conservative limits)
5. **Platform UI changes** (selectors no longer work)

### Slack Alert System

**Auto-escalation to manual posting**:
```javascript
// Send manual posting alert to Slack
async function sendManualPostingAlert(platform, post, reason) {
    const blocks = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `🚨 *Manual Posting Required - ${platform}*\n\n` +
                      `*Reason:* ${reason}\n` +
                      `*Scheduled Time:* ${post.scheduled_time}\n\n` +
                      `*Title:* ${post.title}\n` +
                      `*Community:* ${post.community}`
            }
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*Content:*\n${post.content}`
            }
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: { type: "plain_text", text: "✅ Posted Manually" },
                    style: "primary",
                    value: `manual_posted:${post.id}`
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "⏰ Reschedule" },
                    value: `reschedule:${post.id}`
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "🗑️ Skip" },
                    style: "danger",
                    value: `skip:${post.id}`
                }
            ]
        }
    ];

    await slackClient.chat.postMessage({
        channel: '#marketing-automation',
        text: `Manual posting required for ${platform}`,
        blocks: blocks
    });
}
```

### Manual Posting Workflow

```
Automation Fails
       │
       ▼
┌──────────────┐
│ Mark post as │ (status = 'needs_manual')
│ needs_manual │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Send Slack   │ (With full post content)
│ Alert        │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Founder      │ Options:
│ Reviews      │ 1. Post manually, click "Posted"
└──────┬───────┘ 2. Retry automation later
       │         3. Skip this post
       │
       ├─────────────────┬─────────────────┐
       ▼ Posted          ▼ Retry            ▼ Skip
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Human enters │  │ Reschedule   │  │ Mark as      │
│ post URL     │  │ for +2 hours │  │ skipped      │
└──────┬───────┘  └──────┬───────┘  └──────────────┘
       │                 │
       └─────────────────┘
                │
                ▼
       ┌──────────────┐
       │ Update DB    │ (mark published, store URL)
       │ Start        │
       │ Monitoring   │
       └──────────────┘
```

### Quick Manual Posting Checklist

**When you get a Slack alert**:
1. ✅ Copy content from Slack message
2. ✅ Open platform in browser
3. ✅ Navigate to community/group
4. ✅ Post content manually
5. ✅ Copy post URL
6. ✅ Click "Posted Manually" in Slack
7. ✅ Paste URL when prompted
8. ✅ System continues monitoring automatically

**Estimated time**: 2-3 minutes per post

### Batch Manual Posting

If automation is down for extended period:

```
Daily Manual Posting Session (30 min)
       │
       ▼
┌──────────────┐
│ n8n generates│ (All posts for next 24 hours)
│ CSV export   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Founder      │ - Reddit posts (5-10 min)
│ batch posts  │ - Facebook posts (5-10 min)
└──────┬───────┘ - X posts (5-10 min)
       │
       ▼
┌──────────────┐
│ Import URLs  │ (Upload CSV with URLs)
│ back to n8n  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ System       │ (Back to automated monitoring/replies)
│ continues    │
└──────────────┘
```

**CSV Export Format**:
```csv
id,platform,community,title,content,scheduled_time,status
123,reddit,r/webdev,"Help: AI keeps suggesting wrong files","[content]",2026-01-22 14:00,needs_manual
124,twitter,timeline,"","[tweet content]",2026-01-22 15:30,needs_manual
```

### Hybrid Approach: 80/20 Rule

**Goal**: Automate 80%, manually handle 20% high-value interactions

**Automated** (80%):
- Scheduled post publishing (when working)
- Low-priority engagement monitoring
- Standard replies to common questions
- Analytics tracking
- Rate limiting

**Manual** (20%):
- High-priority engagements (score 80+)
- Posts when automation fails
- Complex questions requiring judgment
- Relationship-building conversations
- Crisis management

**Daily time budget**: ~1-2 hours manual work

---

## Account Safety & Risk Mitigation

**⚠️ Critical: Browser automation can result in permanent account bans. Use dedicated accounts, not personal accounts.**

### Account Setup Best Practices

**Use Dedicated Accounts**:
```
Personal Account (DON'T automate)
- Your real personal profile
- Friends, family, personal followers
- NEVER use for automation

Business/Bot Account (OK to automate)
- Created specifically for xray.codes
- Separate email address
- Different phone number (if possible)
- If banned, no personal data lost
```

### Platform-Specific Risk Levels

| Platform  | Ban Risk | Detection Methods | Mitigation |
|-----------|----------|------------------|------------|
| Reddit    | HIGH     | Rate patterns, click timing, user-agent | Very conservative rate limits, randomized delays |
| X/Twitter | VERY HIGH| Phone verification, behavioral analysis | Extremely conservative, expect periodic challenges |
| Facebook  | MEDIUM   | CAPTCHA, unusual login patterns | Moderate limits, human-like behavior |

### Early Warning Signs of Detection

**Watch for these indicators**:
1. **CAPTCHA challenges** - appearing more frequently
2. **Phone verification** - requests to verify phone number
3. **"Unusual activity" warnings** - security alerts
4. **Shadowban** - posts getting no engagement suddenly
5. **Rate limit errors** - even with conservative limits

**Action plan when detected**:
```
Warning Detected
       │
       ▼
┌──────────────┐
│ STOP all     │ (Immediately pause automation)
│ automation   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Wait 48-72   │ (Let account "cool down")
│ hours        │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Post manually│ (Build human activity pattern)
│ for 1 week   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Resume       │ (With even more conservative limits)
│ automation   │
│ slowly       │
└──────────────┘
```

### Authentication State Management

**Cookie/Session Rotation**:
```javascript
// Refresh auth state periodically to avoid stale sessions
async function refreshAuthState(platform) {
    const authFile = `${platform}_auth.json`;
    const fileAge = Date.now() - fs.statSync(authFile).mtimeMs;

    // Refresh if older than 7 days
    if (fileAge > 7 * 24 * 60 * 60 * 1000) {
        console.log(`Auth state for ${platform} is stale, needs manual refresh`);
        await sendSlackAlert(`Please refresh ${platform} auth state (run manual login script)`);
        return false;
    }

    return true;
}
```

### Backup Account Strategy

**Have 2 accounts per platform**:
- **Primary account**: Main automation account
- **Backup account**: If primary gets banned/challenged

**Backup activation workflow**:
```
Primary Account Banned
       │
       ▼
┌──────────────┐
│ Switch to    │ (Update auth state files)
│ backup       │
│ account      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Continue     │ (Minimal downtime)
│ campaign     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Create new   │ (For future backup)
│ backup acct  │
└──────────────┘
```

### Conservative Rate Limiting Summary

**All platforms (updated values)**:
```javascript
const SAFE_RATE_LIMITS = {
    reddit: {
        post: { requests: 1, window: 7200 },      // 1 per 2 hours per subreddit
        reply: { requests: 1, window: 1800 },     // 1 per 30 minutes
        monitor: { requests: 1, window: 900 }     // 1 per 15 minutes
    },
    facebook: {
        post: { requests: 1, window: 7200 },      // 1 per 2 hours per group
        reply: { requests: 1, window: 900 },      // 1 per 15 minutes
        monitor: { requests: 1, window: 1200 }    // 1 per 20 minutes
    },
    twitter: {
        post: { requests: 1, window: 10800 },     // 1 per 3 hours (very conservative)
        reply: { requests: 1, window: 2700 },     // 1 per 45 minutes
        monitor: { requests: 1, window: 1200 }    // 1 per 20 minutes
    }
};

// Daily maximums (safety caps)
const DAILY_LIMITS = {
    reddit: { posts: 6, replies: 20 },     // ~1 post per 4 hours, ~1 reply per hour
    facebook: { posts: 6, replies: 40 },   // ~1 post per 4 hours
    twitter: { posts: 4, replies: 15 }     // ~1 post per 6 hours
};
```

**These limits mean**:
- Reddit: 6 posts + 20 replies per day MAX
- Facebook: 6 posts + 40 replies per day MAX
- X/Twitter: 4 posts + 15 replies per day MAX

**Total daily capacity**: ~16 posts, ~75 replies across all platforms

**Is this enough?**
For a 10-day launch campaign, yes:
- 160 posts total (16/day × 10 days)
- 750 replies total (75/day × 10 days)
- Quality over quantity approach
- Reduces ban risk significantly

---

## Security & Privacy Considerations

### API Keys & Secrets
```bash
# Store in environment variables, never commit
# NO SOCIAL MEDIA API KEYS NEEDED (using browser automation)
export CLAUDE_API_KEY=xxx
export SLACK_BOT_TOKEN=xxx
export POSTGRES_PASSWORD=xxx
export N8N_PASSWORD=xxx

# Or use n8n credentials vault
```

### Browser Auth States (Critical Security)
```bash
# These files contain your logged-in session cookies
# NEVER commit to git, NEVER share publicly
reddit_auth.json      # Reddit session cookies
twitter_auth.json     # X/Twitter session cookies
facebook_auth.json    # Facebook session cookies

# Add to .gitignore:
echo "*_auth.json" >> .gitignore

# Backup securely (encrypted):
tar -czf auth_backup_$(date +%Y%m%d).tar.gz *_auth.json
gpg --encrypt --recipient your@email.com auth_backup_*.tar.gz

# Rotate auth states every 2 weeks for security
```

### Rate Limiting Safety
```javascript
// Aggressive rate limiting to avoid bans
const RATE_LIMITS = {
    reddit: {
        post: { requests: 1, window: 600 }, // 1 per 10 min
        reply: { requests: 1, window: 60 }   // 1 per 1 min
    },
    facebook: {
        post: { requests: 1, window: 3600 }, // 1 per hour per group
        reply: { requests: 1, window: 300 }  // 1 per 5 min
    },
    twitter: {
        post: { requests: 4, window: 900 },  // 4 per 15 min
        reply: { requests: 4, window: 900 }  // 4 per 15 min
    }
};
```

### Content Moderation
```javascript
// Pre-publish content check
async function moderateContent(content) {
    const issues = [];

    // Spam detection
    if (content.toLowerCase().includes('buy now')) {
        issues.push('Spammy language detected');
    }

    // Link overload
    const linkCount = (content.match(/https?:\/\//g) || []).length;
    if (linkCount > 2) {
        issues.push('Too many links (spam filter risk)');
    }

    // Length check
    if (content.length < 50) {
        issues.push('Content too short');
    }

    // Profanity check (basic)
    const profanityList = ['...'];
    if (profanityList.some(word => content.toLowerCase().includes(word))) {
        issues.push('Profanity detected');
    }

    return {
        approved: issues.length === 0,
        issues: issues
    };
}
```

---

## Monitoring & Alerts

### Health Checks (n8n workflow)
```
Every 5 minutes:
┌──────────────┐
│ Check:       │
│ - n8n alive  │
│ - DB conn    │
│ - Redis conn │
│ - APIs       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Any issues?  │
└──────┬───────┘
       │ Yes
       ▼
┌──────────────┐
│ Send alert   │ (Slack + Email)
│ to founder   │
└──────────────┘
```

### Campaign Health Alerts
```javascript
// Alert conditions
const ALERT_CONDITIONS = {
    engagement_drop: {
        check: () => today.engagements < yesterday.engagements * 0.5,
        message: 'Engagement dropped 50%+ today',
        severity: 'high'
    },
    negative_spike: {
        check: () => today.negative > 20 && today.negative > yesterday.negative * 2,
        message: 'Negative sentiment spike',
        severity: 'high'
    },
    reply_backlog: {
        check: () => pendingReplies > 50,
        message: `Reply queue backlog: ${pendingReplies}`,
        severity: 'medium'
    },
    post_failure: {
        check: () => failedPosts > 3,
        message: `${failedPosts} posts failed to publish`,
        severity: 'critical'
    },
    api_error: {
        check: () => apiErrors > 10,
        message: `${apiErrors} API errors in last hour`,
        severity: 'high'
    }
};
```

---

## Cost Analysis (2026 - Updated for Browser Automation)

### Time Savings
**Without Automation** (10-day campaign):
- Posting: 2 hours/day × 10 days = 20 hours
- Monitoring: 4 hours/day × 10 days = 40 hours
- Replying: 3 hours/day × 10 days = 30 hours
- Analytics: 1 hour/day × 10 days = 10 hours
- **Total: 100 hours**

**With Browser Automation** (10-day campaign):
- Setup: 60 hours (one-time, more complex than API-based)
- Daily oversight: 1.5 hours/day × 10 days = 15 hours
- Manual posting fallbacks: 1 hour/day × 10 days = 10 hours
- High-priority handling: 1 hour/day × 10 days = 10 hours
- **Total: 95 hours** (35 hours during campaign, 60 hours setup)

**Realistic expectation**: Browser automation requires more manual intervention than API automation

**Campaign ROI**: ~65 hours saved during execution (vs 100 hours fully manual)
**Future campaigns**: ~70 hours saved (reuse automation, less setup)

### Monetary Cost (Browser Automation Stack)

**Infrastructure** (monthly):
```
n8n server (2 CPU, 4GB RAM):        $20/month (DigitalOcean)
PostgreSQL (managed, 25GB):         $15/month (DigitalOcean)
Redis (managed, small):             $10/month (DigitalOcean)
                                    ───────────
Subtotal:                           $45/month
```

**AI & Services** (campaign period):
```
Claude API (Pro tier):              $50/month (estimated usage)
Slack (Free tier):                  $0/month
                                    ───────────
Subtotal:                           $50/month
```

**NO API COSTS** (using browser automation):
```
Reddit API (commercial):            $0 (was $12,000/year)
X/Twitter API (Basic):              $0 (was $100/month)
Facebook API:                       $0 (no good API anyway)
                                    ───────────
Savings vs API approach:            $13,200/year
```

**Total Monthly Cost**:
- During campaign: $95/month
- Maintenance: $45/month

**Annual cost** (running 4 campaigns/year):
- Infrastructure: $45 × 12 = $540
- Campaign months: $50 × 4 = $200
- **Total: $740/year**

### Cost Comparison: Browser Automation vs Paid APIs

| Approach | Year 1 Cost | Ongoing/Year | Notes |
|----------|-------------|--------------|-------|
| **Browser Automation** (this doc) | $740 + 60 hours setup | $740 | Requires more manual oversight |
| **Paid APIs** (if affordable) | $13,200 + 40 hours setup | $13,200 | More reliable, less manual work |
| **Fully Manual** | $0 + 400 hours/year | 400 hours | Not scalable |

**Break-even analysis**:
- Human time value: $100/hour
- Browser automation saves: ~260 hours/year (4 campaigns)
- Time savings value: $26,000/year
- Cost: $740/year
- **Net savings: $25,260/year**

Even with more manual intervention than API-based automation, browser automation provides massive ROI.

### Risk-Adjusted Expectations

**Realistic automation success rates** (browser automation):

| Task | Automation % | Manual % | Notes |
|------|--------------|----------|-------|
| **Scheduled posting** | 70% | 30% | CAPTCHAs, challenges require manual fallback |
| **Engagement monitoring** | 90% | 10% | Monitoring more reliable than posting |
| **Low-priority replies** | 60% | 40% | Higher failure rate for actions |
| **Analytics** | 100% | 0% | Internal system, fully automated |

**Overall automation rate**: ~70-75% (not 85-90%)

**Realistic daily time investment**:
- Monitor Slack alerts: 20 min/day
- Manual posting fallbacks: 30 min/day
- High-priority engagements: 45 min/day
- System maintenance: 15 min/day
- **Total: ~2 hours/day during campaign**

### Alternative: Hybrid Approach

**Option 1: Browser Automation Only** (this doc)
- Cost: $95/month during campaign
- Time: ~2 hours/day
- Reliability: 70-75%
- Ban risk: Medium

**Option 2: Hybrid (Browser + X API)**
- Add X API Basic tier: +$100/month = $195/month
- Reduces X ban risk significantly
- X posting becomes 95% reliable
- Still use browser for Reddit/Facebook
- **Recommended if budget allows**

**Option 3: Quality over Quantity**
- Reduce posting volume by 50%
- Increase manual posting percentage
- Focus on high-value communities only
- Lower ban risk, higher quality engagement
- Cost: Same ($95/month)
- Time: 1 hour/day

---

## Conclusion

This **browser automation stack** provides:
- ✅ **70-75% task automation** (realistic expectation)
- ✅ **$25,000+ annual savings** vs fully manual
- ✅ **Real-time monitoring** and alerts
- ✅ **Human-in-the-loop** for authenticity and fallbacks
- ✅ **Affordable** at $740/year vs $13,200 for paid APIs
- ⚠️ **Requires manual backup** for ~25-30% of posts
- ⚠️ **Account ban risk** - use dedicated accounts
- ⚠️ **Maintenance overhead** - platforms change UIs

**Key Success Factors**:
1. **Expect failures** - Browser automation is fragile, have manual backups ready
2. **Conservative rate limits** - Prevents bans but limits volume
3. **Dedicated accounts** - NEVER automate personal accounts
4. **Monitor closely** - Especially first 3-5 days of campaign
5. **Be ready to pivot** - If platform detects bot, switch to manual immediately
6. **Quality over quantity** - Better to post less with high reliability

**Realistic Expectations**:
- ~16 posts/day capacity across all platforms
- ~75 replies/day capacity
- 70-75% will automate successfully
- 25-30% will require manual posting
- 2 hours/day human oversight during campaign
- Some account challenges are inevitable

**When to Use This Approach**:
✅ Solo founder with limited budget
✅ Willing to do ~2 hours/day manual oversight
✅ OK with 70-75% automation rate
✅ Can create dedicated accounts for each platform
✅ Comfortable with technical troubleshooting

**When NOT to Use**:
❌ Need 95%+ reliability
❌ Can't afford 2 hours/day oversight
❌ Can't risk any account bans
❌ Have budget for $1,000+/month in APIs
❌ Need to scale beyond 20 posts/day

**Next Steps**:
1. **Week 1**: Set up infrastructure, save auth states
2. **Week 2**: Build n8n workflows, test with 1-2 posts per platform
3. **Week 3**: Run 3-day pilot (expect ~30% manual fallback)
4. **Week 4**: Launch campaign, monitor closely, adjust limits
5. **Ongoing**: Maintain auth states, refresh cookies, update selectors

**The Reality**:
Browser automation enables a solo founder to execute a multi-platform marketing campaign that would be impossible fully manually, but it's **not hands-off**. Think of it as a **force multiplier** (3-4x productivity) rather than full automation.

**Budget-conscious alternative to $13,200/year in API costs**, with the trade-off being higher manual involvement and maintenance.
