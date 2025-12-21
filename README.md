# 🏢 WorkSphere - AI-Powered Remote Workspace Finder

<div align="center">

![WorkSphere Banner](https://img.shields.io/badge/WorkSphere-AI%20Workspace%20Finder-blue?style=for-the-badge)

[![Next.js](https://img.shields.io/badge/Next.js-15.4-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)

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
- **Amenity Filters**: WiFi, outlets, quiet zones

### 🔐 Authentication

- **Clerk Integration**: Secure sign-in/sign-up
- **User Profiles**: Personalized experience
- **Webhook Sync**: Real-time user data updates

### 📱 Progressive Web App (PWA)

- **Installable**: Add to home screen on mobile/desktop
- **Offline Support**: IndexedDB storage for venues and favorites
- **Service Worker**: Caches static assets for fast loading
- **Push Notifications**: Ready for future notification support

### 🚀 Performance & Reliability

- **Rate Limiting**: API protection with configurable limits
- **Data Caching**: Multi-layer caching with TTL support
- **Error Boundaries**: Graceful error handling prevents crashes
- **Loading Skeletons**: Smooth loading states for better UX

### 📊 Analytics & Monitoring

- **Event Tracking**: Track searches, venue interactions, agent performance
- **Agent Metrics**: Monitor AI pipeline execution times
- **Search Patterns**: Understand user behavior and preferences

### 📲 Mobile-First Design

- **Responsive Layout**: Optimized for all screen sizes
- **Mobile Toggle**: Switch between Chat and Map views on mobile
- **Touch-Friendly**: Large touch targets and swipe gestures
- **Offline Indicator**: Visual feedback when connection is lost

---

## 🛠️ Tech Stack

| Category | Technology |
| -------- | ---------- |
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript 5.0 |
| **Styling** | Tailwind CSS 3.4, shadcn/ui |
| **AI/LLM** | Groq SDK (Llama 3.3 70B) |
| **Database** | Neon PostgreSQL + Prisma ORM |
| **Authentication** | Clerk |
| **Maps** | React Leaflet + OpenStreetMap |
| **Venue Data** | Overpass API (OpenStreetMap) |
| **Testing** | Jest + React Testing Library |
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

## 🧪 Testing the App (User Guide)

### Quick Start Test

1. **Open the app** at `http://localhost:3000` (or port 3001/3002 if 3000 is busy)
2. **Allow location access** when prompted (or app will use IP-based location)
3. **Start chatting** with the AI assistant!

### Feature Testing Checklist

#### 🔍 AI Search (Core Feature)
Try these natural language queries in the chat:

```
"Find a quiet cafe with good WiFi near me"
"Show me coworking spaces within 2km"
"I need a library to study"
"Find cafes with power outlets"
"Show me the best rated workspace nearby"
```

**What to expect:**
- AI processes through 5 agents (visible in expandable pipeline)
- Map updates with venue markers
- Venue cards appear with scores and details
- Suggestions for follow-up queries

#### 🗺️ Map Interaction
- **Click markers** to see venue details
- **Mobile users**: Tap "Map" tab to see results
- **Zoom/Pan** the map freely
- **Watch auto-center** when new results load

#### ⭐ Favorites (Requires Sign-in)
1. Click **Sign In** (top right)
2. Create account or sign in with Clerk
3. Click the **heart icon** on any venue card
4. Favorites persist across sessions

#### ⭐ Rating Venues (Requires Sign-in)
1. Sign in to your account
2. Click **"Rate"** button on a venue card
3. Rate: WiFi quality, outlets, noise level
4. Add optional comment
5. Submit rating

#### 🔧 Filters
- Click **Filter** button in chat header
- Toggle: **WiFi** | **Outlets** | **Quiet**
- Results automatically re-filter

#### 📱 PWA Installation
- **Desktop**: Click install icon in browser address bar
- **Mobile**: "Add to Home Screen" from browser menu
- App works **offline** with cached venues

#### 🔄 Offline Mode Test
1. Search for some venues (they get cached)
2. Turn off WiFi/Network
3. App shows offline banner
4. Previously viewed venues still visible

#### 💬 Conversation History (Requires Sign-in)
1. Sign in to your account
2. Start a search conversation
3. Click **History** icon in chat header
4. Previous conversations are listed
5. Click to resume any conversation

### Testing Rate Limiting
- Send 20+ messages quickly
- After limit: "Rate limit exceeded" message appears
- Wait 60 seconds to reset

### Testing Caching
- Search for "cafes near me"
- Search same query again
- Second search is **instant** (cached)
- Cache expires after 5 minutes

### API Endpoints to Test

| Endpoint | Method | Test Command |
|----------|--------|--------------|
| `/api/chat` | POST | Main AI chat |
| `/api/favorites` | GET | List favorites |
| `/api/venues` | GET | Search venues |
| `/api/location` | GET | IP geolocation |
| `/api/conversations` | GET | List conversations |

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Getting location..." stuck | Allow location permission or wait for IP fallback |
| No venues found | Expand search radius or try different location |
| Rate limited | Wait 60 seconds |
| Sign-in not working | Check Clerk API keys in `.env.local` |
| Map not loading | Check browser console for Leaflet errors |

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

# Clerk Webhook (Svix)
SVIX_SECRET=whsec_...
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
  user        User     @relation(fields: [userId], references: [id])
  venueId     String
  venue       Venue    @relation(fields: [venueId], references: [id])
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
  user      User     @relation(fields: [userId], references: [id])
  venueId   String
  venue     Venue    @relation(fields: [venueId], references: [id])
  createdAt DateTime @default(now())
  @@unique([userId, venueId])
}

model Conversation {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  title     String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
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
| `POST` | `/api/conversations/[id]/messages` | Add message |
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
│   └── leaflet/               # Map marker icons
├── src/
│   ├── agents/                # AI Agent implementations
│   │   ├── Orchestrator.tsx   # Routes queries to agents
│   │   ├── ContextAgent.tsx   # Extracts user intent
│   │   ├── DataAgent.tsx      # Fetches venue data
│   │   ├── ReasoningAgent.tsx # Scores and ranks venues
│   │   ├── ActionAgent.tsx    # Updates UI
│   │   └── index.ts           # Agent exports
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/          # Main AI chat endpoint
│   │   │   ├── conversations/ # Conversation CRUD
│   │   │   ├── favorites/     # Favorites management
│   │   │   ├── venues/        # Venue search & rating
│   │   │   ├── location/      # IP geolocation
│   │   │   └── webhook/       # Clerk webhook
│   │   ├── ai/
│   │   │   └── page.tsx       # Main app page (map + chat)
│   │   ├── sign-in/           # Clerk sign-in page
│   │   ├── sign-up/           # Clerk sign-up page
│   │   ├── layout.tsx         # Root layout with providers
│   │   ├── page.tsx           # Landing page
│   │   └── globals.css        # Global styles
│   ├── components/
│   │   ├── ai-elements/       # Reusable AI UI components
│   │   ├── ui/                # shadcn/ui components
│   │   ├── EnhancedChatbot.tsx # Main chat interface
│   │   ├── Map.tsx            # React Leaflet map
│   │   ├── VenueCard.tsx      # Venue display card
│   │   └── VenueRatingDialog.tsx # Rating modal
│   ├── lib/
│   │   ├── prisma.ts          # Prisma client
│   │   └── utils.ts           # Utility functions
│   ├── tools/                 # AI Agent tools
│   │   ├── findWorkSpaces.ts  # Venue search
│   │   ├── getVenueDetails.ts # Venue details
│   │   ├── getCurrentLocation.ts
│   │   ├── reverseGeocode.ts
│   │   ├── updateMarkers.ts
│   │   ├── updateRoutes.ts
│   │   └── setMapView.ts
│   ├── types/                 # TypeScript types
│   └── middleware.ts          # Clerk auth middleware
├── .env.example               # Environment template
├── .env.local                 # Local environment (gitignored)
├── next.config.ts             # Next.js configuration
├── tailwind.config.ts         # Tailwind configuration
├── tsconfig.json              # TypeScript configuration
└── package.json               # Dependencies
```

---

## 🧪 Testing Scenarios

Try these queries to test the system:

1. **Basic Search**
   ```
   "Find a quiet cafe with good WiFi near me"
   ```

2. **Specific Need**
   ```
   "I need a place for a video call this afternoon"
   ```

3. **Distance-based**
   ```
   "Show me coworking spaces within 2 miles"
   ```

4. **Amenity Focus**
   ```
   "Find a library with outlets"
   ```

5. **Directions**
   ```
   "Get directions to the nearest cafe with WiFi"
   ```

---

## 🚀 Deployment

### Deploy to Vercel

1. Push to GitHub
2. Connect repository to [Vercel](https://vercel.com)
3. Add environment variables in Vercel dashboard
4. Deploy!

### Post-Deployment Checklist

- [ ] Configure Clerk webhook URL
- [ ] Verify database connection
- [ ] Test authentication flow
- [ ] Check map loads correctly
- [ ] Test agent pipeline end-to-end

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👨‍💻 Author

**Satyam Pandey**

- GitHub: [@SatyamPandey-07](https://github.com/SatyamPandey-07)

---

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - React framework
- [Clerk](https://clerk.com/) - Authentication
- [Neon](https://neon.tech/) - Serverless PostgreSQL
- [Groq](https://groq.com/) - Fast AI inference
- [OpenStreetMap](https://www.openstreetmap.org/) - Map data
- [React Leaflet](https://react-leaflet.js.org/) - Map components
- [shadcn/ui](https://ui.shadcn.com/) - UI components

---

<div align="center">

**⭐ Star this repo if you find it helpful!**

Made with ❤️ by [Satyam Pandey](https://github.com/SatyamPandey-07)

</div>
