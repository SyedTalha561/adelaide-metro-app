// Import required libraries
const express = require('express');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

// Initialize the Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON request bodies
app.use(express.json());

// Adelaide Metro GTFS-Realtime Vehicle Positions Feed URL
const FEED_URL = 'https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions';

// Cache configuration (15 seconds = 15,000 milliseconds)
const CACHE_DURATION_MS = 15 * 1000;
let cachedVehicles = null;
let lastFetchTime = 0;

/**
 * Fetches and decodes the GTFS-Realtime Protobuf feed from Adelaide Metro.
 * Caches the parsed vehicles list in-memory for 15 seconds.
 */
async function fetchVehiclesWithCache() {
  const currentTime = Date.now();
  const cacheAge = currentTime - lastFetchTime;

  // 1. Check if we have cached data that is newer than 15 seconds
  if (cachedVehicles && cacheAge < CACHE_DURATION_MS) {
    const remainingTimeSec = Math.ceil((CACHE_DURATION_MS - cacheAge) / 1000);
    console.log(`[Cache Hit] Serving cached data. Cache expires in ${remainingTimeSec}s`);
    return {
      source: 'cache',
      cacheAgeSeconds: Math.floor(cacheAge / 1000),
      count: cachedVehicles.length,
      vehicles: cachedVehicles
    };
  }

  // 2. Fetch fresh data from Adelaide Metro
  console.log('[Network] Fetching fresh vehicle positions from Adelaide Metro...');
  const response = await fetch(FEED_URL, {
    headers: {
      'Accept': 'application/x-google-protobuf'
    }
  });

  if (!response.ok) {
    throw new Error(`Adelaide Metro server responded with HTTP status ${response.status}: ${response.statusText}`);
  }

  // 3. Adelaide Metro returns binary Protobuf (.pb) data. Convert response to a buffer/Uint8Array
  const buffer = await response.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  // 4. Transform the raw GTFS entities into a clean, easy-to-read list for our app
  const parsedVehicles = [];

  for (const entity of feed.entity) {
    // Only process entities that contain vehicle position data
    if (entity.vehicle && entity.vehicle.position) {
      const vehicleData = entity.vehicle;
      const position = vehicleData.position;
      const trip = vehicleData.trip || {};
      const vehicleDescriptor = vehicleData.vehicle || {};

      parsedVehicles.push({
        id: vehicleDescriptor.id || entity.id,
        vehicleLabel: vehicleDescriptor.label || null,
        routeName: trip.routeId || 'Unassigned',
        tripId: trip.tripId || null,
        latitude: position.latitude,
        longitude: position.longitude,
        bearing: position.bearing !== undefined ? position.bearing : null,
        speed: position.speed !== undefined ? position.speed : null,
        timestamp: vehicleData.timestamp ? Number(vehicleData.timestamp) : null
      });
    }
  }

  // 5. Update our cache with the latest results
  cachedVehicles = parsedVehicles;
  lastFetchTime = currentTime;

  console.log(`[Success] Fetched & parsed ${parsedVehicles.length} active vehicles.`);

  return {
    source: 'live',
    cacheAgeSeconds: 0,
    count: parsedVehicles.length,
    vehicles: parsedVehicles
  };
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

// Friendly welcome message and test interface at http://localhost:3000
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Adelaide Metro Transit & AI Copilot</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 2rem; background: #f9f9fb; color: #222; }
        .card { background: white; max-width: 650px; margin: 0 auto; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        h2 { margin-top: 0; color: #004b87; }
        a { color: #0070f3; text-decoration: none; font-weight: 500; }
        a:hover { text-decoration: underline; }
        .endpoint { background: #f0f2f5; padding: 8px 12px; border-radius: 4px; font-family: monospace; display: block; margin: 8px 0; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Adelaide Metro Transit & AI Backend</h2>
        <p>Your backend server is up and running.</p>
        
        <h3>Available Endpoints:</h3>
        <p><strong>1. Live GTFS-RT Vehicles:</strong></p>
        <span class="endpoint"><a href="/api/vehicles">GET /api/vehicles</a></span>

        <p><strong>2. AI Transit Copilot:</strong></p>
        <span class="endpoint">POST /api/chat</span>
        <p style="font-size: 0.9rem; color: #666;">
          Send <code>{ "message": "Where is the H30 bus right now?" }</code> to interact with the AI assistant.
        </p>
      </div>
    </body>
    </html>
  `);
});

// GET /api/vehicles: Returns active vehicles with latitude, longitude & route
app.get('/api/vehicles', async (req, res) => {
  try {
    const result = await fetchVehiclesWithCache();
    res.json(result);
  } catch (error) {
    console.error('Error fetching vehicle positions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve vehicle positions from Adelaide Metro.',
      message: error.message
    });
  }
});

// POST /api/chat: AI Conversational Layer with live transit context
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    // Validate request body
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: "Missing or invalid 'message' in request body. Expected { \"message\": \"user question\" }"
      });
    }

    // Read the OpenRouter API key from environment variables
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'OPENROUTER_API_KEY environment variable is not configured on the server.'
      });
    }

    // Fetch or retrieve current cached live vehicle positions
    const vehicleData = await fetchVehiclesWithCache();
    const liveVehicles = vehicleData.vehicles || [];

    // Create a compact representation of live vehicles to optimize prompt context
    const vehicleSummary = liveVehicles.map(v => ({
      route: v.routeName,
      id: v.vehicleLabel || v.id,
      lat: v.latitude,
      lon: v.longitude,
      speed: v.speed,
      bearing: v.bearing
    }));

    // System prompt defining the Adelaide Metro transit copilot persona
    const systemPrompt = `You are a helpful transit copilot for Adelaide, South Australia.
Answer user questions concisely using the provided live vehicle data.
If the user asks about specific buses, trains, or trams (e.g., Glenelg tram, H30, 251), check matching vehicles from the live data and summarize their count, positions, and status.
Keep answers short, direct, and commuter-friendly.

Current Adelaide Metro Live Active Vehicles (${vehicleSummary.length} total active):
${JSON.stringify(vehicleSummary)}`;

    // Call the OpenRouter API
    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Adelaide Metro Copilot'
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: message
          }
        ]
      })
    });

    if (!openRouterResponse.ok) {
      const errorDetails = await openRouterResponse.text();
      console.error('[OpenRouter API Error]', openRouterResponse.status, errorDetails);
      return res.status(openRouterResponse.status).json({
        error: `OpenRouter API error: ${openRouterResponse.statusText}`,
        details: errorDetails
      });
    }

    const data = await openRouterResponse.json();
    const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

    // Return the clean AI response
    res.json({ reply });

  } catch (error) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({
      error: 'An internal error occurred while processing the chat request.',
      message: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` Adelaide Metro Transit Backend Server Running `);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` Vehicles API: http://localhost:${PORT}/api/vehicles`);
  console.log(` Chat API: POST http://localhost:${PORT}/api/chat`);
  console.log(` Cache duration: 15 seconds`);
  console.log(`===============================================`);
});
