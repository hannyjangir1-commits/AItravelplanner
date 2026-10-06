# AI Travel Planner

> **Personalized Destination Experience & Day-Wise Itinerary Generator**  
> A full-stack web application that creates customized, practical destination travel plans powered by Google Gemini AI with an intelligent offline/demo fallback engine.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Problem Statement](#problem-statement)
3. [Project Objectives](#project-objectives)
4. [Key Features](#key-features)
5. [How the System Works](#how-the-system-works)
6. [System Architecture](#system-architecture)
7. [Technology Stack](#technology-stack)
8. [Gemini AI Integration](#gemini-ai-integration)
9. [Travel-Plan Generation Workflow](#travel-plan-generation-workflow)
10. [Travel-Plan Modification Workflow](#travel-plan-modification-workflow)
11. [Authoritative Validation](#authoritative-validation)
12. [Error Handling & Reliability](#error-handling--reliability)
13. [Fallback & Demo Engine](#fallback--demo-engine)
14. [Client Session Storage](#client-session-storage)
15. [Project Structure](#project-structure)
16. [API Endpoints](#api-endpoints)
17. [Environment Variables](#environment-variables)
18. [Local Setup & Installation](#local-setup--installation)
19. [Development & Build Commands](#development--build-commands)
20. [Docker Deployment](#docker-deployment)
21. [Cloud Deployment Strategy](#cloud-deployment-strategy)
22. [Current Limitations](#current-limitations)
23. [Future Enhancements](#future-enhancements)
24. [User Interface Screenshots](#user-interface-screenshots)
25. [Important Disclaimer](#important-disclaimer)
26. [License](#license)

---

## Project Overview

**AI Travel Planner** is an intelligent, responsive web application designed to help travellers organize their time, budget, and activities after reaching their chosen destination. By inputting key parameters—including destination, duration (1 to 30 days), overall budget in INR, group size (1 to 20 travellers), preferred accommodation tier, activity pace, and specific personal interests—the system generates a complete, structured day-by-day itinerary.

The application communicates with Google's Gemini generative AI models using a structured JSON schema. If the live AI service is unreachable, rate-limited, or unconfigured, the system automatically activates a built-in deterministic fallback engine that synthesizes a high-quality multi-day plan. The interface remains fully functional, preserves all state across browser refreshes via safe `sessionStorage`, and allows conversational iterative modifications without corrupting existing data.

---

## Problem Statement

Planning a vacation or travel itinerary manually presents several persistent challenges:
- **Information Overload**: Travellers must browse dozens of disconnected blogs, review platforms, and forums to piece together daily schedules.
- **Pacing & Timing Mismatches**: Uncurated plans frequently overload days with too many sights or group geographically incompatible attractions together.
- **Budget Imbalances**: Estimating realistic daily allowances and money-saving opportunities in specific regional currencies (INR) is difficult without localized guidance.
- **Inflexible Modification**: Changing one aspect of a trip (e.g., asking for more food venues or relaxed mornings) often requires manually restructuring the entire schedule.
- **Vendor Focus Over Experience**: Most commercial travel portals prioritize selling flights and hotel bookings rather than guiding the traveller on what to experience, where to eat, and how to allocate daily hours once they arrive.

---

## Project Objectives

1. **Structured Destination Focus**: Deliver realistic, practical destination programs covering morning, afternoon, and evening slots, plus contingency alternative activities for inclement weather or fatigue.
2. **Strict Schema Reliability**: Enforce schema conformity so that every generated plan consistently includes accommodation advice, top attractions, regional dining suggestions, activity ideas, weather/packing guidance, and money-saving tips.
3. **Conversational Plan Modification**: Enable users to refine an existing plan via natural-language instructions (e.g., *"Make Day 2 more relaxed"* or *"Add vegetarian street food spots"*) while preserving unaffected days and trip parameters.
4. **Resilient Dual-Mode Operation**: Guarantee 100% uptime through a deterministic fallback system that delivers varied, realistic itineraries for up to 30 days even if the AI backend is offline.
5. **Privacy & Security Standards**: Never expose backend API keys or internal stack traces to the client, sanitize all logs, and prevent malformed data from crashing the user interface.

---

## Key Features

- **Custom Trip Duration (1 to 30 Days)**: Complete itinerary generation supporting quick weekend getaways up to month-long multi-week stays.
- **Structured Day-by-Day Itineraries**:
  - Divided into distinct **Morning**, **Afternoon**, and **Evening** periods.
  - Practical logistics and transit notes for each day.
  - Built-in **Alternative / Wet-Weather Backup Activity** for every day.
- **Comprehensive Destination Intelligence**:
  - **Accommodation Guidance**: Recommended neighborhoods and lodging styles tailored to the selected budget tier (Budget, Moderate, Premium).
  - **Places to Visit**: Curated sights with reasons to visit and best times of day.
  - **Food & Local Experiences**: Traditional dishes, regional culinary specialties, and neighborhood food markets.
  - **Targeted Activities**: Tailored to traveller interests (Culture, Adventure, Photography, Nature, Food, etc.).
  - **Weather & Packing Advice**: Practical seasonal overview and wardrobe essentials.
  - **Budget-Saving Tips**: Concrete, actionable tips in Indian Rupees (₹) to stay within budget.
- **Interactive Plan Modification Console**:
  - Enter custom modification prompts or select quick suggestion pills.
  - Returns the full updated plan while keeping intact all untouched days and settings.
- **Real-Time Generation Timestamps**:
  - Authoritative backend-generated `generatedAt` timestamp displayed in local date and time format on the results screen.
- **Transparency Indicators**:
  - Visually distinct status badges clearly communicating whether a plan was **"AI Generated"** or generated via the **"Demo / Fallback Plan"** engine.
- **Stage-Based Loading Experience**:
  - Realistic multi-stage progress indicators (*Preparing travel preferences*, *Generating recommendations*, *Building day-wise itinerary*, *Finalizing plan*) with form locking to prevent duplicate submissions.
- **Safe Session Persistence**:
  - Automatically preserves active plans and form details in `sessionStorage`.
  - Safely recovers from malformed data without touching foreign browser storage keys.

---

## How the System Works

```
                     +---------------------------------------+
                     |             User Browser              |
                     |  (React 19 + TypeScript + Vite UI)   |
                     +---------------------------------------+
                                         |
                                         | 1. Form Submission (Trip Details)
                                         v
                     +---------------------------------------+
                     |         Authoritative Validator       |
                     |        (Client & Server Checked)      |
                     +---------------------------------------+
                                         |
                        +----------------+----------------+
                        | Valid                           | Invalid
                        v                                 v
         +-----------------------------+     +--------------------------+
         |    Express Backend API      |     | Return HTTP 400 Bad Req  |
         |  (/api/generate-travel-plan)|     | { success: false, error }|
         +-----------------------------+     +--------------------------+
                        |
            +-----------+-----------+
            | Has GEMINI_API_KEY?   |
            v                       v
         [ YES ]                 [ NO ]
            |                       |
            v                       |
   +--------------------+           |
   | Call Gemini API    |           |
   | Priority Cascade:  |           |
   | 1. flash-lite      |           |
   | 2. flash-3.5       |           |
   | 3. flash-3.8       |           |
   +--------------------+           |
      |              |              |
   Success        Failure / Timeout |
      |              |              |
      v              v              v
+------------+  +-------------------------------+
| Parse JSON |  | Activate Deterministic Engine |
| Extract    |  | Generate 1-30 Day Curated     |
| Structured |  | Itinerary with Safe Defaults  |
| Response   |  +-------------------------------+
+------------+                  |
      |                         |
      +------------+------------+
                   |
                   v
   +-------------------------------+
   | Return HTTP 200 JSON Response |
   | { success: true, data, isDemo}|
   +-------------------------------+
                   |
                   v
   +-------------------------------+
   | Client UI Render & Store in   |
   | SessionStorage for Continuity |
   +-------------------------------+
```

---

## System Architecture

The application adopts a decoupled client-server architecture:

```
+---------------------------------------------------------------------------------+
|                                 CLIENT LAYER                                    |
|                                                                                 |
|  [Header]         [HeroLanding]       [TravelForm]         [PlanResult]         |
|                                                                                 |
|  * React 19 State Management & Custom UI System (index.css)                     |
|  * API Client (api.ts) with Network Protection & Non-JSON Fallbacks             |
|  * Safe Session Storage Manager (storage.ts) with Structural Schema Guard      |
+---------------------------------------------------------------------------------+
                                      |  HTTP / JSON (REST)
                                      v
+---------------------------------------------------------------------------------+
|                                 SERVER LAYER                                    |
|                                                                                 |
|  * Express Application (index.ts) with Global CORS, JSON & Error Middlewares    |
|  * Authoritative Input Validator (validation.ts)                               |
|  * AI Orchestration & Model Fallback Service (aiService.ts)                     |
|  * Deterministic Multi-Day Itinerary Engine (Up to 30 Days)                     |
+---------------------------------------------------------------------------------+
                                      |  HTTPS (Encrypted API Calls)
                                      v
+---------------------------------------------------------------------------------+
|                             EXTERNAL AI SERVICES                                |
|                                                                                 |
|  Google Gemini API (generativelanguage.googleapis.com)                          |
|  [gemini-3.1-flash-lite] -> [gemini-3.5-flash] -> [gemini-3.8-flash]            |
+---------------------------------------------------------------------------------+
```

---

## Technology Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React | 19.2.8 | Declarative component UI and reactive state |
| **Frontend Language** | TypeScript | 5.7+ / 6.0 | End-to-end type safety on all components |
| **Build Tool & Bundler**| Vite | 8.3.0 | Fast HMR development server and optimized bundle compilation |
| **Styling & Theme** | Vanilla CSS | CSS3 | Custom design system, dark mode, glassmorphism, responsive layout |
| **Typography** | Google Fonts | Web Fonts | Modern typography: *Outfit* (headings) & *Plus Jakarta Sans* (body) |
| **Backend Runtime** | Node.js | >= 18.0.0 | JavaScript runtime engine (tested on Node 20 & 24) |
| **Backend Framework** | Express | 4.21.2 | HTTP routing, request parsing, and error-handling middleware |
| **Server Language** | TypeScript | 5.7.2 | Type-safe backend handlers and schema interfaces |
| **Dev Execution** | tsx | 4.19.2 | High-performance TypeScript execution and watch daemon |
| **Environment Config** | dotenv | 16.4.7 | Server-side environment variable isolation |
| **CORS Middleware** | cors | 2.8.5 | Cross-Origin Resource Sharing control |
| **AI Integration** | Google Gemini REST | v1beta | Structured travel intelligence generation |
| **Containerization** | Docker | Multi-stage | Single portable container for production deployment |

---

## Gemini AI Integration

The backend interacts directly with the Google Gemini API using native `fetch` over HTTPS.

### 1. Ordered Model Cascade
To balance latency, availability, and quota constraints, the backend implements a structured model fallback hierarchy:
1. **`gemini-3.1-flash-lite`** *(Primary)*: Selected for minimal latency and high token throughput.
2. **`gemini-3.5-flash`** *(Secondary)*: Fallback for complex structural reasoning and adherence.
3. **`gemini-3.8-flash`** *(Tertiary)*: High-capability safety net if preceding models fail.

### 2. Request Configuration
- **Response Format**: Configured with `responseMimeType: 'application/json'` to enforce pure JSON output without Markdown wrapping.
- **Generation Controls**: Controlled temperature (`0.7`) to produce varied yet realistic destination recommendations.
- **Token Allowance**: Max output limit set to `8192` tokens to accommodate itineraries up to 30 days.
- **Strict 60-Second Timeout**: Every outgoing call is bound to an `AbortSignal.timeout(60000)` to prevent lingering hung sockets.

### 3. Balanced JSON Extraction
Generative language models occasionally prepend commentary or append text. The server includes a dedicated brace-balancing parser (`extractBalancedJsonObject`) that isolates the outermost `{ ... }` structure before executing `JSON.parse`.

### 4. API Key Protection
All incoming and outgoing logs pass through a sanitizer (`redactApiKey`) that strips both configured environment secrets and Google key patterns (`AIza...`) before writing to the server console.

---

## Travel-Plan Generation Workflow

1. **User Input**: The user specifies destination, duration (1-30 days), budget in INR, travellers (1-20), accommodation preference, activity pace, and optional notes.
2. **Client Pre-check**: The frontend validates input ranges and initiates stage-based progress indicators.
3. **HTTP Dispatch**: `POST /api/generate-travel-plan` is transmitted to the Express backend.
4. **Backend Validation**: `validateGeneratePlanRequest` strictly sanitizes and validates every field.
5. **AI Execution**:
   - If `GEMINI_API_KEY` is present, the server builds a structured prompt and queries the Gemini cascade.
   - If AI generation succeeds, the JSON is parsed and stamped with `generatedAt: ISOString`.
   - If AI generation fails (e.g. invalid key, timeout, rate limit), the server logs the issue safely and engages the fallback engine.
6. **Response Transmission**: The server returns `{ success: true, data: TravelPlan, isDemo: boolean, message: string }`.
7. **Client State & Storage**: The React client updates its state, saves the plan in `sessionStorage`, and smoothly scrolls down to the itinerary view.

---

## Travel-Plan Modification Workflow

1. **User Request**: The user enters a natural-language refinement (e.g., *"Focus on historic monuments and add more street food"*) or clicks a quick suggestion pill.
2. **Preservation Safeguard**: The client bundles the **original trip parameters**, the **current travel plan**, and the **modification request**.
3. **HTTP Dispatch**: `POST /api/modify-travel-plan` is transmitted.
4. **Backend Processing**:
   - The server makes an immutable deep copy of the current plan.
   - The user's modification request is submitted to Gemini alongside the existing plan JSON with instructions to return a complete, updated plan while preserving untouched fields.
   - If the AI call fails or returns an invalid structure, `validateAndMergeModifiedPlan` detects the defect, keeps the original plan completely intact, sets `isDemo: true`, and explains the situation in a clear status message.
5. **Client Update & Synchronization**: The client stores the verified plan, sets a temporary modification flag, and reloads the view smoothly positioned at the top of the plan with an alert confirmation.

---

## Authoritative Validation

The application adheres to defensive design principles: **client validation guides the user, but backend validation is authoritative.**

| Field | Validation Constraints | Failure Code | Error Message |
| :--- | :--- | :--- | :--- |
| `destination` | Required string, non-empty, max 150 characters | `400 Bad Request` | *"Destination is required and must be a valid text string."* |
| `numberOfDays` | Integer between `1` and `30` | `400 Bad Request` | *"Number of days must be a whole number between 1 and 30."* |
| `budgetInr` | Positive finite number, maximum `₹10,00,00,000` | `400 Bad Request` | *"Total budget in INR must be a positive number."* |
| `numberOfTravellers`| Integer between `1` and `20` | `400 Bad Request` | *"Number of travellers must be a whole number between 1 and 20."* |
| `accommodation` | Must be one of `'Budget'`, `'Moderate'`, `'Premium'` | `400 Bad Request` | *"Accommodation preference must be 'Budget', 'Moderate', or 'Premium'."* |
| `activityLevel` | Must be one of `'Relaxed'`, `'Moderate'`, `'Active'` | `400 Bad Request` | *"Activity level must be 'Relaxed', 'Moderate', or 'Active'."* |
| `interests` | Array of strings, max 15 items, max 50 chars each | Sanitized | Sanitized / filtered automatically |
| `additionalNotes` | Optional string, maximum 1000 characters | `400 Bad Request` | *"Additional notes must not exceed 1000 characters."* |
| `modificationRequest`| Required string, non-empty, max 1000 characters | `400 Bad Request` | *"Please enter a modification request."* |

---

## Error Handling & Reliability

The application handles 10 core failure scenarios cleanly:

1. **Invalid User Input**: Rejection with clean HTTP 400 responses and unambiguous field messages.
2. **Gemini API Failure (401, 403, 500)**: Fallback plan activated; user informed with clear messaging.
3. **Gemini Timeout**: 60-second client-side and server-side timeouts trigger graceful fallback.
4. **Gemini Rate Limiting (429 / 503)**: Handled with exponential backoff before cascading models or activating demo mode.
5. **Invalid Gemini JSON**: The JSON parser catches malformed syntax and falls back instead of corrupting data.
6. **Empty Gemini Response**: Detected when candidate text is missing; handled via model cascade or fallback.
7. **Server Error (500)**: Express global error middlewares intercept unexpected exceptions. Stack traces and file paths are never exposed to the client.
8. **Network Disconnection**: The frontend client wraps `fetch` calls in defensive `try/catch` handlers that explain connectivity issues clearly.
9. **Malformed Session Data**: The storage manager validates `sessionStorage` contents; if corrupted, it safely purges application keys and restores initial state without crashing.
10. **Modification Failure**: Deep copying prevents plan loss or truncation when modification attempts fail.

---

## Fallback & Demo Engine

When Gemini AI is unavailable or the API key is not configured, the built-in deterministic fallback engine in `server/src/aiService.ts` steps in automatically:

- **Full Duration Support**: Synthesizes varied itineraries for up to **30 consecutive days**.
- **Thematic Diversity**: Rotates through unique daily themes (e.g., *Arrival & Orientation*, *Heritage Citadel*, *Culinary Discovery*, *Nature Trail*, *Art & Craft Quarter*, *Scenic Overlooks*, *Day Excursions*).
- **Proportional Budget Allocation**: Computes realistic daily spending targets based on the user's total budget and party size.
- **Deterministic & Lightweight**: Zero external API calls, instantaneous execution, and 100% offline resilience.
- **Identical Schema**: Fallback plans match the exact JSON schema of live AI plans, ensuring zero UI breakage.

---

## Client Session Storage

To preserve user data across page refreshes and modification reloads without requiring an external database, the client utilizes browser `sessionStorage`:

### Managed Storage Keys
- `aitravel_plan`: JSON string of the active `TravelPlan`.
- `aitravel_details`: JSON string of the active `TripFormData`.
- `aitravel_is_demo`: String boolean (`"true"` / `"false"`).
- `aitravel_message`: Informational server notice.
- `aitravel_just_modified`: Ephemeral flag coordinating scroll restoration after modification.

### Storage Safety Guarantees
- **Deep Structural Validation**: The storage manager verifies that loaded objects contain required fields and an itinerary array with at least 1 day.
- **Isolated Key Eviction**: If stored session data is corrupt, the system removes **only** its own 5 keys, preserving any third-party keys in `sessionStorage`.

---

## Project Structure

```
AItravelplanner/
├── client/                          # React Frontend Application
│   ├── public/                      # Static assets
│   ├── src/
│   │   ├── components/              # UI Components
│   │   │   ├── Header.tsx           # Top navigation bar with New Plan trigger
│   │   │   ├── HeroLanding.tsx      # Welcome hero presentation
│   │   │   ├── TravelForm.tsx       # Input form with progressive stage loading
│   │   │   └── PlanResult.tsx       # Itinerary display, badges, & modification console
│   │   ├── api.ts                   # Type-safe API client with network guards
│   │   ├── App.tsx                  # Root application controller & coordinator
│   │   ├── index.css                # Custom responsive design system & theme tokens
│   │   ├── main.tsx                 # React DOM mount point
│   │   ├── storage.ts               # Resilient sessionStorage manager
│   │   └── types.ts                 # Frontend TypeScript interfaces
│   ├── package.json                 # Client dependencies & scripts
│   ├── tsconfig.json                # Client TypeScript configuration
│   └── vite.config.ts               # Vite bundler & dev proxy configuration
│
├── server/                          # Express Backend Application
│   ├── src/
│   │   ├── aiService.ts             # Gemini integration & 30-day fallback engine
│   │   ├── index.ts                 # Express server, routes & error middleware
│   │   ├── types.ts                 # Backend data contracts & schemas
│   │   └── validation.ts            # Authoritative input validation rules
│   ├── .env                         # Server environment configuration (API keys)
│   ├── package.json                 # Server dependencies & scripts
│   └── tsconfig.json                # Server TypeScript configuration
│
├── .dockerignore                    # Exclusions for container builds
├── Dockerfile                       # Multi-stage production container definition
├── open_app.bat                     # Windows one-click local launcher
├── package.json                     # Root orchestrator scripts (concurrent dev)
└── README.md                        # Project documentation
```

---

## API Endpoints

### 1. Health Check
- **Endpoint**: `GET /api/health`
- **Description**: Verifies service status without leaking internal configuration or secrets.
- **Response `200 OK`**:
```json
{
  "success": true,
  "status": "ok",
  "service": "AI Travel Agent API"
}
```

---

### 2. Generate Travel Plan
- **Endpoint**: `POST /api/generate-travel-plan`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "destination": "Kyoto, Japan",
  "numberOfDays": 4,
  "budgetInr": 120000,
  "numberOfTravellers": 2,
  "interests": ["Culture", "Food", "Photography"],
  "accommodationPreference": "Moderate",
  "activityLevel": "Moderate",
  "additionalNotes": "Prefer morning visits to avoid crowds."
}
```
- **Success Response `200 OK`**:
```json
{
  "success": true,
  "data": {
    "accommodationGuidance": "Stay near Gion or Central Kyoto for easy bus access...",
    "placesToVisit": [
      {
        "name": "Fushimi Inari Shrine",
        "reason": "Iconic torii gate trail through sacred wooded forest",
        "bestTime": "Early morning (7:00 AM)"
      }
    ],
    "foodAndLocalExperiences": [
      {
        "name": "Nishiki Market",
        "reason": "Narrow shopping street filled with skewers, matcha, and seafood"
      }
    ],
    "activities": [
      {
        "name": "Traditional Tea Ceremony",
        "reason": "Immersive cultural experience matching historical interests"
      }
    ],
    "weatherAdvice": "Pleasant mornings; carry a light jacket and comfortable walking shoes.",
    "budgetTips": [
      "Purchase a 1-day Kyoto subway & bus pass to save on daily transit.",
      "Enjoy set lunch menus (teishoku) which cost significantly less than dinner."
    ],
    "itinerary": [
      {
        "day": 1,
        "morning": "Arrive and check in. Stroll through the traditional preservation district.",
        "afternoon": "Explore Kiyomizu-dera temple overlooking the valley. Savor matcha soft-serve.",
        "evening": "Dinner along Pontocho Alley with lantern-lit dining over the river.",
        "notes": "Wear slip-on shoes as some temple halls require removing footwear.",
        "alternative": "Kyoto Museum of Crafts and Design in case of rain."
      }
    ],
    "generatedAt": "2026-10-05T10:30:00.000Z"
  },
  "isDemo": false,
  "message": "Plan generated successfully with Gemini AI."
}
```
- **Error Response `400 Bad Request`**:
```json
{
  "success": false,
  "error": "Number of days must be a whole number between 1 and 30."
}
```

---

### 3. Modify Travel Plan
- **Endpoint**: `POST /api/modify-travel-plan`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "originalDetails": {
    "destination": "Kyoto, Japan",
    "numberOfDays": 4,
    "budgetInr": 120000,
    "numberOfTravellers": 2,
    "interests": ["Culture", "Food"],
    "accommodationPreference": "Moderate",
    "activityLevel": "Moderate"
  },
  "currentPlan": { /* Existing TravelPlan JSON Object */ },
  "modificationRequest": "Add more budget street food options and make Day 3 more relaxed"
}
```
- **Success Response `200 OK`**:
```json
{
  "success": true,
  "data": { /* Complete updated TravelPlan JSON Object */ },
  "isDemo": false,
  "message": "Travel plan successfully updated for: \"Add more budget street food options and make Day 3 more relaxed\"."
}
```

---

## Environment Variables

Server environment variables are managed in `server/.env`.

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Optional | `""` | Google Gemini API Key from Google AI Studio. If omitted or default, the server runs in Demo / Fallback mode. |
| `PORT` | Optional | `5000` | Local port where the Express server listens. |

> **Security Note**: Never commit actual API keys to source control. The repository includes `.env` in `.gitignore` by default.

---

## Local Setup & Installation

### Prerequisites
- **Node.js**: Version `18.0.0` or higher (Node 20+ LTS recommended).
- **npm**: Version `9.0.0` or higher.
- **Git**: Installed on your development machine.

### Step 1: Clone the Repository
```bash
git clone https://github.com/your-username/AItravelplanner.git
cd AItravelplanner
```

### Step 2: Install Dependencies
Install dependencies for root, client, and server in one step:
```bash
npm run install:all
```
*Alternatively, install manually:*
```bash
npm install
npm install --prefix client
npm install --prefix server
```

### Step 3: Configure Environment Variables
Create or verify `server/.env`:
```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=5000
```
*(If you do not have an API key, leave it empty or use `your_gemini_api_key_here`; the application will automatically run in Demo Fallback mode.)*

---

## Development & Build Commands

### Running Locally in Development Mode
Run both frontend and backend concurrently with hot reloading:
```bash
npm run dev
```
- **Frontend App**: `http://localhost:5173`
- **Backend API**: `http://localhost:5000`

### Running on Windows (Quick Launcher)
Double-click `open_app.bat` or run:
```cmd
open_app.bat
```
This script installs missing packages, starts both services, and automatically launches your default browser.

### Independent Development
- Run backend only: `npm run dev:server`
- Run frontend only: `npm run dev:client`

---

## Production Build

### Compile Client & Server
```bash
npm run build
```
This triggers:
1. `npm run build --prefix server` (compiles TypeScript to `server/dist`).
2. `npm run build --prefix client` (compiles TypeScript and bundles production assets into `client/dist`).

### Launch Production Server
```bash
npm start
```
The Express server will start on port `5000` and automatically serve the pre-built React static files from `client/dist`. Access the application at `http://localhost:5000`.

---

## Docker Deployment

The repository includes an optimized multi-stage `Dockerfile` based on `node:20-alpine`.

### Build Docker Image
```bash
docker build -t ai-travel-planner .
```

### Run Docker Container
```bash
docker run -d \
  -p 5000:5000 \
  -e GEMINI_API_KEY="your_gemini_api_key_here" \
  --name travel-planner \
  ai-travel-planner
```
Access the application at `http://localhost:5000`.

---

## Cloud Deployment Strategy

The application is structured for simple containerized cloud deployment:

- **Google Cloud Run**: Native support. Container listens on the injected `PORT` environment variable.
- **Render / Railway**: Deploy directly as a Web Service by pointing to the root `Dockerfile` or running `npm run build && npm start`.
- **AWS ECS / DigitalOcean App Platform**: Deploy the single pre-built Docker image.

Because the Express backend serves the static React frontend from `client/dist`, no complex reverse proxy or multi-server configuration is required.

---

## Current Limitations

To maintain architectural transparency, the following technical boundaries are noted:
- **No Direct Bookings**: The system does **not** execute real-time flight, train, or hotel reservations. All lodging and dining details are suggestions.
- **No Live Weather Sensors**: Weather guidance represents seasonal climate expectations and packing tips rather than real-time meteorological sensor feeds.
- **Session-Scoped Storage**: Generated plans persist across reloads in the browser's `sessionStorage`. Plans are not saved to an external database or synchronized across devices.
- **Gemini Free Quotas**: Free-tier Gemini keys are subject to Google request-per-minute limitations. If quota is exceeded, the server automatically engages the fallback engine.

---

## Future Enhancements

- [ ] **Export to PDF & Calendar**: One-click download of the complete itinerary formatted for offline print or export to `.ics` format.
- [ ] **Interactive Map Integration**: Visual markers showing daily attractions and lunch spots on an embedded interactive map.
- [ ] **Multi-Currency Support**: Option to display budget targets and estimates in USD, EUR, GBP, or local destination currencies.
- [ ] **User Accounts & Database Sync**: Optional cloud profiles (PostgreSQL / Supabase) to save and share itineraries across devices.
- [ ] **Collaborative Planning**: Shareable link allowing travel companions to vote on activities or add notes.

---

## User Interface Screenshots

*Below are UI placement references representing core application screens:*

```
+-----------------------------------------------------------------------------------+
|  [Logo] AI Travel Planner                         [Plan Another Trip] [New Plan]  |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|                      Your Next Journey, Intelligently Planned                     |
|        Personalized destination itineraries tailored to your style and budget      |
|                                                                                   |
+-----------------------------------------------------------------------------------+
|  DESTINATION ITINERARY PLANNING                                                   |
|                                                                                   |
|  Destination: [ Kyoto, Japan                                                    ] |
|  Duration:    [ 4 Days       ]  Budget (INR): [ ₹1,20,000  ]  Travellers: [ 2   ] |
|  Stay Tier:   ( ) Budget        (*) Moderate        ( ) Premium                   |
|  Pace:        ( ) Relaxed       (*) Moderate        ( ) Active                    |
|  Interests:   [x] Culture  [x] Food  [x] Photography  [ ] Nature  [ ] Adventure   |
|                                                                                   |
|  [                     Generate My Travel Plan                     ]             |
+-----------------------------------------------------------------------------------+
```
*Figure 1: Landing Page & Travel Preference Submission Form*

```
+-----------------------------------------------------------------------------------+
|  [AI Generated]  Kyoto, Japan - 4 Days Itinerary      Generated on: 5 Oct 2026    |
|  Total Budget: ₹1,20,000 | 2 Travellers | Moderate Pace                           |
+-----------------------------------------------------------------------------------+
|  Accommodation Guidance  |  Places to Visit  |  Food & Dining  |  Activities      |
+-----------------------------------------------------------------------------------+
|  DAY 1 - ARRIVAL & ORIENTATION                                                    |
|  * Morning:   Check in to boutique stay in Gion. Walk through preserved streets.  |
|  * Afternoon: Visit Kiyomizu-dera wooden terrace. Sample street dango and matcha. |
|  * Evening:   Dinner along lantern-lit Pontocho Alley over the Kamogawa river.    |
|  Practical Note: Purchase local bus pass at Kyoto station upon arrival.           |
|  Alternative: Kyoto International Manga Museum if rain occurs.                    |
+-----------------------------------------------------------------------------------+
|  MODIFY TRAVEL PLAN                                                               |
|  [+ Add more food places] [+ Make Day 2 more relaxed] [+ Indoor alternatives]    |
|  [ Enter modification request...                              ] [ Modify Plan ]  |
+-----------------------------------------------------------------------------------+
```
*Figure 2: Generated Day-Wise Itinerary & Conversational Modification Console*

---

## Important Disclaimer

> **ADVISORY USE ONLY**: All travel plans, itineraries, accommodation suggestions, attractions, estimated costs, and regional advice generated by this application (via Gemini AI or the fallback engine) are provided solely for **informational and trip-planning purposes**.
>
> This application does **not** check live hotel vacancy, live flight schedules, table availability, current operating hours, ticket pricing, visa requirements, or real-time travel alerts. Travellers must **independently confirm** opening times, entry fees, transport connections, local laws, and travel advisories before committing to bookings or embarking on their trip.

---

## License

This project is open-source and available under the [MIT License](https://opensource.org/licenses/MIT). You are free to use, modify, and distribute this codebase for academic, personal, or commercial demonstration purposes.
