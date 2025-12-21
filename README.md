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

[🚀 Live Demo](https://worksphere.vercel.app) • [📖 Documentation](#features) • [🐛 Report Bug](https://github.com/SatyamPandey-07/WorkSphere/issues)

</div>

---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Testing](#-testing)
- [Database Schema](#-database-schema)
- [API Routes](#-api-routes)
- [Multi-Agent System](#-multi-agent-system)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### 🤖 AI-Powered Search

- **Natural Language Queries**: "Find a quiet cafe with good WiFi near me"
- **Smart Intent Understanding**: Extracts work type, amenities, location preferences
- **Intelligent Scoring**: Ranks venues based on work-friendliness criteria

### 🗺️ Interactive Map

- **Real-time Markers**: Venue locations with category icons
- **Route Visualization**: Get directions to selected venues
- **User Location**: Custom marker with Clerk user avatar
- **Auto-centering**: Map adjusts to show search results

### 🎯 Multi-Agent Architecture

- **5 Specialized AI Agents** working together:
  - Orchestrator → Context → Data → Reasoning → Action
- **Transparent Reasoning**: See each agent's thought process
- **Parallel Processing**: Efficient query handling

### ⭐ User Features

- **Favorites System**: Save frequently visited spots
- **Crowdsourced Ratings**: Rate venues on WiFi, outlets, noise
- **Conversation History**: Resume previous searches
- **Venue Suggestions**: Submit new venues to the platform

### 🔐 Authentication

- **Clerk Integration**: Secure sign-in/sign-up
- **User Profiles**: Personalized experience
- **Webhook Sync**: Real-time user data updates

### 📱 Progressive Web App (PWA)

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
| **Venue Data** | Overpass API (OpenStreetMap) |
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
│  │  Neon Postgres  │  │   Overpass API  │  │     Clerk      │  │
│  │                 │  │                 │  │                │  │
│  │ - Users         │  │ - Cafes         │  │ - Auth         │  │
│  │ - Venues        │  │ - Libraries     │  │ - User Sync    │  │
│  │ - Ratings       │  │ - Coworking     │  │ - Sessions     │  │
│  │ - Favorites     │  │                 │  │                │  │
│  │ - Conversations │  │                 │  │                │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
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
```

### Getting API Keys

| Service | URL | Free Tier |
|---------|-----|-----------|
| **Neon** | [neon.tech](https://neon.tech) | 0.5GB storage |
| **Clerk** | [clerk.com](https://clerk.com) | 10,000 MAU |
| **Groq** | [console.groq.com](https://console.groq.com) | Free API access |

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

## 🔌 API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/chat` | Main chat endpoint with agent pipeline |
| `GET` | `/api/venues` | Search venues |
| `POST` | `/api/venues` | Add crowdsourced venue |
| `POST` | `/api/venues/[id]/rate` | Rate a venue |
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
│   │   ├── VenueCard.tsx
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
