# Adelaide Metro Transit App Backend & AI Copilot

This backend service provides:
1. **Live GTFS-Realtime vehicle tracking** (decoded from Protobuf and cached for 15s).
2. **AI Conversational Transit Copilot** powered by OpenRouter (`google/gemini-flash-1.5`).

---

## 1. Setting Your OpenRouter API Key

### Option A: Set in Terminal Session (Mac / Linux)
```bash
export OPENROUTER_API_KEY="your_openrouter_api_key_here"
```

### Option B: Run inline with the server
```bash
OPENROUTER_API_KEY="your_openrouter_api_key_here" npm start
```

---

## 2. Running the Server

1. Navigate to the folder:
   ```bash
   cd "Adelaide Metro App"
   ```

2. Start the server:
   ```bash
   npm start
   ```

---

## 3. API Endpoints

### 1. `GET /api/vehicles`
Returns the active vehicle fleet data decoded from Adelaide Metro's GTFS-RT Protobuf feed.

**Test:**
```bash
curl http://localhost:3000/api/vehicles
```

---

### 2. `POST /api/chat`
Answers transit queries using the live Adelaide vehicle fleet as context.

**Test:**
```bash
curl -X POST "http://localhost:3000/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "Are there any Glenelg trams or H30 buses running right now?"}'
```

**Response Example:**
```json
{
  "reply": "Yes, currently there are 3 H30 buses active along the route heading towards the city and Paradise, moving at speeds between 25-45 km/h. There are also 4 active Glenelg tram sets operating along the line."
}
```
