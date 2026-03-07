# 🏢 WorkSphere - AI-Powered Remote Workspace Finder

<div align="center">

![WorkSphere Banner](https://img.shields.io/badge/WorkSphere-AI%20Workspace%20Finder-blue?style=for-the-badge)

[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.2-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-57%20passing-success?style=flat-square)](./src/__tests__)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-purple?style=flat-square)](https://web.dev/progressive-web-apps/)

**A multi-agent AI platform that helps remote workers discover ideal workspaces like cafes, coworking spaces, and libraries based on WiFi quality, power outlets, noise levels, and more.**

[🚀 Live Demo](https://work-sphere-one.vercel.app/) • [🐛 Report Bug](https://github.com/SatyamPandey-07/WorkSphere/issues)

</div>

---


## 📋 Table of Contents

- [Recent Updates](#-recent-updates-mar-7-2026)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Testing](#-testing)
- [Database Schema](#-database-schema)
- [Pages](#-pages)
- [API Routes](#-api-routes)
- [Multi-Agent System](#-multi-agent-system)
- [Project Structure](#-project-structure)
- [Future Improvements](#-future-improvements)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Recent Updates (Mar 8, 2026 - 24 Hour Sprint)

| Area | Change |
|------|--------|
| ⭐ **Venue Rating System** | Built comprehensive rating dialog with WiFi quality, power outlets, noise levels, quietness |
| 📊 **Profile Dashboard** | Complete user analytics dashboard with "NEURAL LEDGER" booking history |
| 📄 **PDF Receipt Generation** | Serverless-compatible PDF receipts using **pdf-lib** (fixed PDFKit font loading issues) |
| 💾 **Download Receipts** | Download button for each booking with loading states and automatic file download |
| 🔗 **External Link to Map** | View any booked venue on the map from booking history with coordinate validation |
| 📝 **Venue Submission** | Users can submit new venues via modal form with full data collection |
| 📸 **Venue Photos** | Migrated from Unsplash → **Pexels API** (20k req/mo free, no billing required) |
| 📡 **Real-time Updates** | Added **Server-Sent Events (SSE)** stream — live ratings & crowd levels appear instantly |
| 🎨 **Landing Page** | Complete redesign: dark theme, animated blobs, stats strip, 8 feature cards |
| 🔒 **Security** | Photo API key proxied server-side — never reaches the browser |
| 🐛 **Critical Fixes** | Fixed Vercel build errors: Buffer handling, cuid string IDs, coordinate validation |

---

## ✨ Features

### 🤖 AI-Powered Search

- **Natural Language Queries**: "Find a quiet cafe with good WiFi near me"
- **Smart Intent Understanding**: Extracts work type, amenities, location preferences
- **Intelligent Scoring**: Ranks venues based on work-friendliness criteria

### 🗺️ Interactive Dark Theme Map

- **Dark Theme**: Beautiful CartoDB Dark Matter tiles
- **Real-time Markers**: Purple glowing venue markers with venue photos
- **Green Route Lines**: Real road routing with OSRM (not straight lines)
- **User Location**: Custom marker with Clerk user avatar
- **Auto-centering**: Map adjusts to show search results
- **Dark Popups**: Styled popups matching the theme

### 📡 Real-time Venue Updates (NEW)

- **Server-Sent Events (SSE)**: Live venue data pushed from server to client
- **Live Ratings**: See new reviews appear instantly without refreshing
- **Availability Updates**: Crowd levels update in real-time
- **Stable Connections**: Smart reconnect logic prevents connection spam

### 📸 Venue Photos (NEW)

- **Pexels Integration**: High-quality venue photos via Pexels API
- **Server-side Proxy**: API key never exposed to the browser
- **DB Caching**: Each venue fetched once, then served from cache
- **Lazy Loading**: Skeleton shimmer while photo loads, graceful fallback on error
- **Free tier**: 20,000 requests/month, no billing required

### 🏢 Venue Enrichment (100% FREE APIs)

- **OpenStreetMap Integration**: Real venue data from OSM Overpass API
- **Amenities Display**: WiFi, outdoor seating, accessibility from OSM
- **Opening Hours**: Real business hours when available
- **No Credit Card Required**: All APIs are completely free

### 🛣️ Real Road Routing

- **OSRM Integration**: Actual road paths instead of straight lines
- **Turn-by-turn Geometry**: Realistic routes on the map
- **Distance Calculation**: Accurate road distance to venues
- **Multiple Profiles**: Walking, driving, cycling routes

### 🎯 Multi-Agent Architecture

- **5 Specialized AI Agents** working together:
  - Orchestrator → Context → Data → Reasoning → Action
- **Transparent Reasoning**: See each agent's thought process
- **Parallel Processing**: Efficient query handling

### ⭐ User Features

- **Favorites System**: Save frequently visited spots
- **Crowdsourced Ratings**: Rate venues on WiFi quality, outlets, noise levels, quietness
- **Rating Dialog**: Beautiful modal with 5-star ratings for each amenity
- **Conversation History**: Resume previous searches
- **Venue Suggestions**: Submit new venues via modal form
- **Profile Dashboard**: Complete analytics dashboard showing booking history
- **"NEURAL LEDGER"**: Futuristic booking history with confirmation IDs, dates, venue details
- **Download Receipts**: PDF receipts for each booking with automatic download
- **View on Map**: External link button to view booked venues on the interactive map
- **Booking Status**: Visual status badges (Confirmed, Pending, Cancelled)

### 🔐 Authentication

- **Clerk Integration**: Secure sign-in/sign-up
- **User Profiles**: Personalized experience
- **Webhook Sync**: Real-time user data updates

### � PDF Receipt System

- **Serverless-Compatible**: Uses **pdf-lib** (not PDFKit) for AWS Lambda compatibility
- **Instant Generation**: PDF receipts generated on-demand for confirmed bookings
- **Professional Format**: Includes venue details, booking info, confirmation ID, timestamps
- **Embedded Fonts**: Helvetica and HelveticaBold loaded from pdf-lib (no filesystem dependencies)
- **Direct Download**: One-click download with loading states and error handling
- **Fixed Build Issues**: Resolved Buffer/Uint8Array compatibility and cuid ID string handling

### �📱 Progressive Web App (PWA)

- **Installable**: Add to home screen on mobile/desktop
- **Offline Support**: IndexedDB storage for venues and favorites
- **Service Worker**: Caches static assets for fast loading
- **Background Sync**: Queue actions when offline

### 🚀 Performance & Reliability

- **Rate Limiting**: API protection with configurable limits
- **Data Caching**: Multi-layer caching with TTL support
- **Error Boundaries**: Graceful error handling prevents crashes
- **Loading Skeletons**: Smooth loading states for better UX

### 📊 Analytics & Monitoring

- **Event Tracking**: Track searches, venue interactions, agent performance
- **Agent Metrics**: Monitor AI pipeline execution times
- **Search Patterns**: Understand user behavior and preferences

### 🧪 Comprehensive Testing

- **57 Unit Tests**: Full coverage with Jest & React Testing Library
- **E2E Testing**: Playwright configuration for end-to-end tests
- **API Tests**: Route handler testing
- **Component Tests**: UI component validation

---

## 🛠️ Tech Stack

| Category | Technology |
| -------- | ---------- |
| **Framework** | Next.js 15.5 (App Router) |
| **Language** | TypeScript 5.0 |
| **Styling** | Tailwind CSS 4.0, Custom UI Components |
| **AI/LLM** | Groq SDK (Llama 3.3 70B) |
| **Database** | Neon PostgreSQL + Prisma 7.2 ORM (with @prisma/adapter-pg) |
| **Authentication** | Clerk |
| **Maps** | React Leaflet + OpenStreetMap |
| **Venue Data** | OpenStreetMap (Overpass API) - FREE |
| **Venue Photos** | Pexels API - FREE (20k req/mo) |
| **Real-time** | Server-Sent Events (SSE) |
| **Routing** | OSRM (Open Source Routing Machine) - FREE |
| **PDF Generation** | pdf-lib 2.x (serverless-compatible) |
| **Testing** | Jest 29, React Testing Library, Playwright |
| **PWA** | Service Workers + IndexedDB |
| **Deployment** | Vercel |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │      Map (70%)          │  │     Chat (30%)              │  │
│  │  - Venue Markers        │  │  - Natural Language Input   │  │
│  │  - User Location        │  │  - Agent Transparency       │  │
│  │  - Route Polylines      │  │  - Venue Cards              │  │
│  │  - Auto-centering       │  │  - Action Buttons           │  │
│  └─────────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MULTI-AGENT PIPELINE                        │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Orchestrator │ -> │   Context    │ -> │     Data     │      │
│  │    Agent     │    │    Agent     │    │    Agent     │      │
│  │              │    │              │    │              │      │
│  │ Routes query │    │ Extracts     │    │ Fetches      │      │
│  │ to agents    │    │ intent &     │    │ venues via   │      │
│  │              │    │ parameters   │    │ Overpass API │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                  │               │
│                                                  ▼               │
│  ┌──────────────┐    ┌──────────────┐                          │
│  │    Action    │ <- │  Reasoning   │                          │
│  │    Agent     │    │    Agent     │                          │
│  │              │    │              │                          │
│  │ Updates UI,  │    │ Scores &     │                          │
│  │ map, chat    │    │ ranks venues │                          │
│  └──────────────┘    └──────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │  Neon Postgres  │  │   OpenStreetMap │  │     Clerk      │  │
│  │                 │  │                 │  │                │  │
│  │ - Users         │  │ - Overpass API  │  │ - Auth         │  │
│  │ - Venues        │  │ - Cafes         │  │ - User Sync    │  │
│  │ - Ratings       │  │ - Libraries     │  │ - Sessions     │  │
│  │ - Favorites     │  │ - Coworking     │  │                │  │
│  │ - Conversations │  │                 │  │                │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │   Pexels API    │  │    OSRM API     │                      │
│  │                 │  │                 │                      │
│  │ - Venue Photos  │  │ - Road Routing  │                      │
│  │ - 20k/mo FREE   │  │ - Polylines     │                      │
│  │ - Server Proxy  │  │ - FREE          │                      │
│  └─────────────────┘  └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/SatyamPandey-07/WorkSphere.git
   cd WorkSphere
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

4. **Set up the database**
   ```bash
   # Prisma 7 uses driver adapters - ensure DATABASE_URL is set
   npx prisma generate
   npx prisma db push
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open in browser**
   ```
   http://localhost:3000
   ```

---

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Watch Mode
```bash
npm run test:watch
```

### End-to-End Tests
```bash
npm run test:e2e
npm run test:e2e:ui  # With UI
```

### Test Coverage
- **57 Unit Tests** covering:
  - API Route Handlers
  - React Components  
  - Utility Functions
  - Rate Limiting
  - Analytics

---

## 🔐 Environment Variables

Create a `.env.local` file in the root directory:

```env
# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://user:password@host/database?sslmode=require"

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# AI (Groq)
GROQ_API_KEY=gsk_...

# Pexels (for venue photos - free at pexels.com/api)
PEXELS_API_KEY=your_pexels_key_here
```

### Getting API Keys

| Service | URL | Free Tier | Required |
|---------|-----|-----------|----------|
| **Neon** | [neon.tech](https://neon.tech) | 0.5GB storage | ✅ Yes |
| **Clerk** | [clerk.com](https://clerk.com) | 10,000 MAU | ✅ Yes |
| **Groq** | [console.groq.com](https://console.groq.com) | Free API access | ✅ Yes |
| **Pexels** | [pexels.com/api](https://www.pexels.com/api/) | 20,000 req/month | ❌ No (has fallback) |
| **OSM/OSRM** | N/A | Unlimited | ❌ No (public API) |

---

## 📊 Database Schema

```prisma
model User {
  id            String         @id
  email         String?        @unique
  createdAt     DateTime       @default(now())
  favorites     Favorite[]
  ratings       VenueRating[]
  conversations Conversation[]
}

model Venue {
  id           String        @id @default(cuid())
  placeId      String        @unique
  name         String
  latitude     Float
  longitude    Float
  category     String        // cafe, coworking, library
  address      String?
  rating       Float?
  wifiQuality  Int?          // 1-5 scale
  hasOutlets   Boolean       @default(false)
  noiseLevel   String?       // quiet, moderate, loud
  crowdsourced Boolean       @default(false)
  createdAt    DateTime      @default(now())
  ratings      VenueRating[]
  favorites    Favorite[]
}

model VenueRating {
  id          String   @id @default(cuid())
  userId      String
  venueId     String
  wifiQuality Int      // 1-5
  hasOutlets  Boolean
  noiseLevel  String   // quiet, moderate, loud
  comment     String?
  createdAt   DateTime @default(now())
  @@unique([userId, venueId])
}

model Favorite {
  id        String   @id @default(cuid())
  userId    String
  venueId   String
  createdAt DateTime @default(now())
  @@unique([userId, venueId])
}

model Conversation {
  id        String    @id @default(cuid())
  userId    String
  title     String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  role           String       // user, assistant
  content        String
  createdAt      DateTime     @default(now())
}
```

---

## � Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Landing Page | Hero section with product mockup, features showcase, CTAs |
| `/ai` | AI Workspace Finder | Main app with 70/30 map/chat split, dark theme |
| `/dashboard` | User Dashboard | Personal dashboard for authenticated users |
| `/offline` | Offline Page | PWA fallback when network unavailable |
| `/sign-in` | Sign In | Clerk authentication sign-in page |
| `/sign-up` | Sign Up | Clerk authentication sign-up page |

---

## �🔌 API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/chat` | Main chat endpoint with agent pipeline |
| `GET` | `/api/venues` | Search venues |
| `POST` | `/api/venues` | Add crowdsourced venue |
| `GET` | `/api/venues/enrich` | Enrich venue with OSM + Pexels data |
| `POST` | `/api/venues/[id]/rate` | Rate a venue |
| `POST` | `/api/venues/updates` | Bulk update venue photos |
| `GET` | `/api/favorites` | Get user's favorites |
| `POST` | `/api/favorites` | Add favorite |
| `DELETE` | `/api/favorites` | Remove favorite |
| `GET` | `/api/conversations` | List conversations |
| `POST` | `/api/conversations` | Create conversation |
| `GET` | `/api/conversations/[id]` | Get conversation |
| `DELETE` | `/api/conversations/[id]` | Delete conversation |
| `GET` | `/api/location` | IP-based location fallback |
| `POST` | `/api/webhook` | Clerk webhook for user sync |

---

## 🤖 Multi-Agent System

### Agent Pipeline Flow

```
User Query: "Find a quiet cafe with WiFi near me"
                    │
                    ▼
┌─────────────────────────────────────────────┐
│           ORCHESTRATOR AGENT                 │
│  • Analyzes query type                      │
│  • Determines: Context → Data → Reasoning   │
│  • Output: agentsToUse[], reasoning         │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│             CONTEXT AGENT                    │
│  • Extracts intent: workType = "focus"      │
│  • Parameters: amenities = [wifi, quiet]    │
│  • Output: structured intent object         │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│              DATA AGENT                      │
│  • Queries Overpass API for cafes           │
│  • Filters by location radius               │
│  • Output: venues[], conditions, meta       │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│            REASONING AGENT                   │
│  • Scores: WiFi(30%), Noise(25%),           │
│    Outlets(20%), Rating(15%), Distance(10%) │
│  • Ranks top venues with explanations       │
│  • Output: rankedVenues[], reasoning        │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│             ACTION AGENT                     │
│  • Updates map markers                      │
│  • Sets map view/zoom                       │
│  • Generates chat response                  │
│  • Output: UI updates, message              │
└─────────────────────────────────────────────┘
```

### Agent Transparency

The UI shows each agent's contribution:

```
🧠 Agent Pipeline (5 steps)
├─ 🎯 Orchestrator: Routing to Context, Data, Reasoning agents
├─ 🔍 Context: Extracted intent - focus work, needs WiFi
├─ 📊 Data: Found 12 cafes within 2km radius
├─ 💡 Reasoning: Top pick - Blue Bottle Coffee (score: 8.5/10)
└─ ⚡ Action: Updated map with 5 markers
```

---

## 📁 Project Structure

```
worksphere/
├── prisma/
│   └── schema.prisma          # Database schema
├── public/
│   ├── sw.js                  # Service worker for PWA
│   └── manifest.json          # PWA manifest
├── src/
│   ├── __tests__/             # Test files
│   │   ├── api/               # API route tests
│   │   ├── components/        # Component tests
│   │   └── lib/               # Utility tests
│   ├── agents/                # AI Agent implementations
│   │   ├── Orchestrator.tsx   # Routes queries to agents
│   │   ├── ContextAgent.tsx   # Extracts user intent
│   │   ├── DataAgent.tsx      # Fetches venue data
│   │   ├── ReasoningAgent.tsx # Scores and ranks venues
│   │   └── ActionAgent.tsx    # Updates UI
│   ├── app/
│   │   ├── api/               # API routes
│   │   │   ├── chat/          # Agent pipeline endpoint
│   │   │   ├── venues/        # Venue CRUD
│   │   │   │   └── enrich/    # OSM + Pexels enrichment
│   │   │   ├── favorites/     # User favorites
│   │   │   └── conversations/ # Chat history
│   │   ├── ai/                # Main app page
│   │   ├── sign-in/           # Auth pages
│   │   ├── sign-up/
│   │   ├── offline/           # Offline fallback
│   │   └── layout.tsx         # Root layout
│   ├── components/
│   │   ├── ai-elements/       # Reusable AI UI components
│   │   ├── ui/                # UI components
│   │   ├── EnhancedChatbot.tsx
│   │   ├── Map.tsx
│   │   ├── VenueCard.tsx      # Enhanced with photos, amenities
│   │   ├── VenueRatingDialog.tsx
│   │   ├── VenueSubmissionModal.tsx
│   │   └── ErrorBoundary.tsx
│   ├── hooks/
│   │   ├── usePWA.tsx         # PWA installation hook
│   │   └── useRealTime.tsx    # Real-time updates hook
│   ├── lib/
│   │   ├── prisma.ts          # Database client
│   │   ├── utils.ts           # Utilities
│   │   ├── rateLimit.ts       # Rate limiting
│   │   ├── analytics.ts       # Event tracking
│   │   ├── validations.ts     # Zod schemas
│   │   ├── venues.ts          # OSM + Pexels integration (NEW)
│   │   ├── routing.ts         # OSRM routing (NEW)
│   │   └── offlineStorage.ts  # IndexedDB for PWA
│   ├── tools/                 # AI Agent tools
│   └── types/                 # TypeScript types
├── e2e/                       # Playwright E2E tests
├── jest.config.js             # Jest configuration
├── playwright.config.ts       # Playwright configuration
└── package.json
```

---

## 🧪 Testing the App (User Guide)

### Quick Start Test

1. **Open the app** at `http://localhost:3000`
2. **Allow location access** when prompted
3. **Start chatting** with the AI assistant!

### Feature Testing Checklist

#### 🔍 AI Search
Try these natural language queries:
- "Find a quiet cafe with good WiFi near me"
- "Show me coworking spaces within 2km"
- "I need a library to study"

#### ⭐ Favorites & Ratings (Requires Sign-in)
1. Sign in with Clerk
2. Click heart icon on venue cards to favorite
3. Click "Rate" to submit ratings

#### 📱 PWA Installation
- **Desktop**: Click install icon in browser
- **Mobile**: "Add to Home Screen"

---

## 🚀 Deployment

### Deploy to Vercel

1. Push to GitHub
2. Connect repository to [Vercel](https://vercel.com)
3. Add environment variables
4. Deploy!

---

## 🔮 Future Improvements

| Priority | Feature | Description |
|----------|---------|-------------|
| 🔴 High | **Analytics Dashboard** | Admin page to view search patterns, popular venues, user metrics |
| � Medium | **Mobile App** | React Native version sharing the same API backend |
| 🟡 Medium | **AI Memory** | Cross-conversation learning for personalized recommendations |
| 🟡 Medium | **Social Features** | Share favorite workspaces, follow other remote workers |
| 🟢 Low | **Booking Integration** | Reserve desks at coworking spaces via API |
| 🟢 Low | **Noise Level API** | Real-time noise monitoring hardware integration |

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 👨‍💻 Author

**Satyam Pandey**
- GitHub: [@SatyamPandey-07](https://github.com/SatyamPandey-07)

---

<div align="center">

**⭐ Star this repo if you find it helpful!**

Made with ❤️ by [Satyam Pandey](https://github.com/SatyamPandey-07)

</div>
