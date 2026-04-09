import { Hono } from "hono";
import { sqlite } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

/**
 * Google Maps proxy — ALL Google API calls go through here.
 * The API key NEVER reaches the client. It lives as a Fly.io secret.
 *
 * Security:
 * - Key read from process.env.GOOGLE_MAPS_API_KEY (set via `fly secrets set`)
 * - All endpoints require authentication
 * - Rate limiting can be added here if needed
 * - Google Console should restrict the key to Geocoding + Places + Maps Static APIs
 */

const mapsRoutes = new Hono();
mapsRoutes.use("/*", requireAuth);

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

if (!GOOGLE_API_KEY) {
  console.warn("⚠ GOOGLE_MAPS_API_KEY not set — geocoding and maps will not work");
}


// ── ADDRESS AUTOCOMPLETE (Places API v1 — "New") ────────────
// Client types an address, we proxy to Google Places Autocomplete (New)
// Uses POST with JSON body and API key in header — works with the new Places API
mapsRoutes.get("/autocomplete", async (c) => {
  const input = c.req.query("input");
  if (!input || input.length < 3) return c.json({ predictions: [] });

  if (!GOOGLE_API_KEY) return c.json({ error: "Maps API not configured" }, 503);

  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
        },
        body: JSON.stringify({
          input,
          includedPrimaryTypes: ["street_address", "subpremise", "premise", "route"],
          includedRegionCodes: ["us"],
        }),
      }
    );

    const data = await res.json() as any;

    if (data.error) {
      console.error("Google Places API error:", data.error.status, data.error.message);
      return c.json({ predictions: [], googleStatus: data.error.status, googleError: data.error.message });
    }

    const predictions = (data.suggestions || [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => {
        const p = s.placePrediction;
        return {
          placeId: p.placeId,
          description: p.text?.text || "",
          mainText: p.structuredFormat?.mainText?.text || "",
          secondaryText: p.structuredFormat?.secondaryText?.text || "",
        };
      });

    return c.json({ predictions });
  } catch (err: any) {
    console.error("Autocomplete error:", err.message);
    return c.json({ error: "Autocomplete failed" }, 500);
  }
});


// ── PLACE DETAILS (Places API v1 — "New") ───────────────────
// After user selects an address, we get the full details + coordinates
mapsRoutes.get("/place-details", async (c) => {
  const placeId = c.req.query("placeId");
  if (!placeId) return c.json({ error: "placeId required" }, 400);

  if (!GOOGLE_API_KEY) return c.json({ error: "Maps API not configured" }, 503);

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          "X-Goog-FieldMask": "formattedAddress,location,addressComponents",
        },
      }
    );

    const data = await res.json() as any;

    if (data.error) {
      console.error("Place details error:", data.error.status, data.error.message);
      return c.json({ error: data.error.message || "Place details failed" }, 500);
    }

    return c.json({
      address: data.formattedAddress,
      latitude: data.location?.latitude,
      longitude: data.location?.longitude,
      components: (data.addressComponents || []).map((ac: any) => ({
        long: ac.longText,
        short: ac.shortText,
        types: ac.types,
      })),
    });
  } catch (err: any) {
    console.error("Place details error:", err.message);
    return c.json({ error: "Place details failed" }, 500);
  }
});


// ── GEOCODE (address string → lat/lng) ───────────────────────
// Fallback if we don't have a place_id — direct address geocoding
mapsRoutes.get("/geocode", async (c) => {
  const address = c.req.query("address");
  if (!address) return c.json({ error: "address required" }, 400);

  if (!GOOGLE_API_KEY) return c.json({ error: "Maps API not configured" }, 503);

  try {
    const params = new URLSearchParams({
      address,
      key: GOOGLE_API_KEY,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`
    );
    const data = await res.json() as any;

    if (!data.results?.length) return c.json({ error: "No results found" }, 404);

    const result = data.results[0];
    return c.json({
      address: result.formatted_address,
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
    });
  } catch (err: any) {
    console.error("Geocode error:", err.message);
    return c.json({ error: "Geocoding failed" }, 500);
  }
});


// ── REVERSE GEOCODE (lat/lng → address) ──────────────────────
// Used by mobile app to get street address from GPS coordinates
mapsRoutes.get("/reverse-geocode", async (c) => {
  const lat = c.req.query("lat");
  const lng = c.req.query("lng");
  if (!lat || !lng) return c.json({ error: "lat and lng required" }, 400);

  if (!GOOGLE_API_KEY) return c.json({ error: "Maps API not configured" }, 503);

  try {
    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: GOOGLE_API_KEY,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`
    );
    const data = await res.json() as any;

    if (!data.results?.length) return c.json({ error: "No results" }, 404);

    return c.json({
      address: data.results[0].formatted_address,
    });
  } catch (err: any) {
    console.error("Reverse geocode error:", err.message);
    return c.json({ error: "Reverse geocoding failed" }, 500);
  }
});


// ── STATIC MAP IMAGE ─────────────────────────────────────────
// Returns a map image URL for embedding in reports/emails
// The actual image is served by Google, but we construct the URL server-side
// so the key isn't in the client HTML
mapsRoutes.get("/static-map", async (c) => {
  const lat = c.req.query("lat");
  const lng = c.req.query("lng");
  const zoom = c.req.query("zoom");
  const size = c.req.query("size") || "600x300";
  const markers = c.req.query("markers");     // pipe-separated blue: "lat,lng|lat,lng"
  const jobMarker = c.req.query("jobMarker"); // "lat,lng" — shown as green pin for job site

  if (!GOOGLE_API_KEY) return c.json({ error: "Maps API not configured" }, 503);

  try {
    const params = new URLSearchParams({
      size,
      maptype: "roadmap",
      key: GOOGLE_API_KEY,
    });

    // If center/zoom given, use explicit positioning; otherwise Google auto-fits to markers
    if (lat && lng && zoom) {
      params.set("center", `${lat},${lng}`);
      params.set("zoom", zoom);
    }

    // Red pin for primary point (clock-in location)
    if (lat && lng) {
      params.append("markers", `color:red|${lat},${lng}`);
    }

    // Blue pins for additional markers (clock-out, etc.)
    if (markers) {
      for (const m of markers.split("|")) {
        params.append("markers", `color:blue|${m}`);
      }
    }

    // Green pin for job site location
    if (jobMarker) {
      params.append("markers", `color:green|label:J|${jobMarker}`);
    }

    // Proxy the image through our server so key stays hidden
    const res = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`);
    if (!res.ok) return c.json({ error: "Map generation failed" }, 500);

    const imageBuffer = await res.arrayBuffer();
    return new Response(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: any) {
    console.error("Static map error:", err.message);
    return c.json({ error: "Static map failed" }, 500);
  }
});


// ── GEOCODE JOB (convenience: geocode + update job in one call) ─
// Updates the job's lat/lng from its address field
mapsRoutes.post("/geocode-job/:jobId", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = Number(c.req.param("jobId"));

  const job = sqlite.query(
    `SELECT id, address FROM jobs WHERE id = ? AND company_id = ?`
  ).get(jobId, companyId) as any;

  if (!job) return c.json({ error: "Job not found" }, 404);
  if (!job.address) return c.json({ error: "Job has no address" }, 400);

  if (!GOOGLE_API_KEY) return c.json({ error: "Maps API not configured" }, 503);

  try {
    const params = new URLSearchParams({
      address: job.address,
      key: GOOGLE_API_KEY,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`
    );
    const data = await res.json() as any;

    if (!data.results?.length) return c.json({ error: "Could not geocode address" }, 404);

    const loc = data.results[0].geometry.location;
    const formattedAddress = data.results[0].formatted_address;

    sqlite.query(`
      UPDATE jobs SET latitude = ?, longitude = ?, address = ?, updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `).run(loc.lat, loc.lng, formattedAddress, jobId, companyId);

    return c.json({
      success: true,
      job: {
        id: jobId,
        address: formattedAddress,
        latitude: loc.lat,
        longitude: loc.lng,
      },
    });
  } catch (err: any) {
    console.error("Geocode job error:", err.message);
    return c.json({ error: "Geocoding failed" }, 500);
  }
});


export { mapsRoutes };
