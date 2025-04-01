import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fetch from "node-fetch";
import { z } from "zod";

// Base URL for the Aviation Weather API
const API_BASE_URL = "https://aviationweather.gov/api/data";

// Create the MCP server
const server = new McpServer({
  name: "AviationWeather",
  version: "1.0.0",
  capabilities: {
    tools: {},
  },
});

// Define airport data interface
interface AirportData {
  id?: string;
  name?: string;
  city?: string;
  state?: string;
  country?: string;
  lat?: number;
  lon?: number;
  elevation?: number;
  runways?: Array<string | RunwayData>;
}

// Define runway data interface
interface RunwayData {
  id?: string;
  length?: number;
  width?: number;
  surface?: string;
}

// Helper function to make API requests
async function fetchAviationWeather(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const queryParams = new URLSearchParams();

  // Add parameters to query string
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value.toString());
    }
  });

  const url = `${API_BASE_URL}/${endpoint}?${queryParams.toString()}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    // For raw text format
    if (params.format === "raw") {
      return await response.text();
    }

    // Default to JSON
    return await response.json();
  } catch (error) {
    console.error(`Error fetching from ${url}:`, error);
    throw error;
  }
}

// Tool: Get METAR (current weather observation) for an airport
server.tool(
  "get-metar",
  {
    airport: z.string().describe("Airport ICAO code (e.g., KJFK)"),
  },
  async ({ airport }) => {
    try {
      const metarData = (await fetchAviationWeather("metar", {
        ids: airport,
        format: "raw",
      })) as string;

      return {
        content: [
          {
            type: "text",
            text: metarData.trim() || `No METAR data available for ${airport}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching METAR: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool: Get TAF (terminal aerodrome forecast) for an airport
server.tool(
  "get-taf",
  {
    airport: z.string().describe("Airport ICAO code (e.g., KJFK)"),
  },
  async ({ airport }) => {
    try {
      const tafData = (await fetchAviationWeather("taf", {
        ids: airport,
        format: "raw",
      })) as string;

      return {
        content: [
          {
            type: "text",
            text: tafData.trim() || `No TAF data available for ${airport}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching TAF: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool: Get PIREPs (pilot reports) near an airport
server.tool(
  "get-pireps",
  {
    airport: z.string().describe("Airport ICAO code (e.g., KJFK)"),
    radius: z
      .number()
      .optional()
      .describe("Search radius in miles (default: 50)"),
  },
  async ({ airport, radius = 50 }) => {
    try {
      // First get airport data to get coordinates
      const airportData = (await fetchAviationWeather("airport", {
        ids: airport,
        format: "json",
      })) as AirportData[];

      if (!airportData || !airportData[0]) {
        return {
          content: [
            {
              type: "text",
              text: `Could not find airport: ${airport}`,
            },
          ],
          isError: true,
        };
      }

      const { lat, lon } = airportData[0];

      // Now fetch PIREPs using the coordinates and radius
      const pirepData = (await fetchAviationWeather("pirep", {
        id: airport,
        format: "raw",
        distance: radius,
      })) as string;

      return {
        content: [
          {
            type: "text",
            text:
              pirepData.trim() ||
              `No PIREPs found within ${radius} miles of ${airport}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching PIREPs: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool: Get comprehensive route weather information
server.tool(
  "get-route-weather",
  {
    departure: z.string().describe("Departure airport ICAO code"),
    destination: z.string().describe("Destination airport ICAO code"),
  },
  async ({ departure, destination }) => {
    try {
      // Fetch airport data for both airports
      const depAirportData = (await fetchAviationWeather("airport", {
        ids: departure,
        format: "json",
      })) as AirportData[];

      const destAirportData = (await fetchAviationWeather("airport", {
        ids: destination,
        format: "json",
      })) as AirportData[];

      // Check if we got valid airport data
      if (!depAirportData[0] || !destAirportData[0]) {
        return {
          content: [
            {
              type: "text",
              text: `Could not find one or both airports: ${departure} / ${destination}`,
            },
          ],
          isError: true,
        };
      }

      // Fetch weather for both airports
      const depMetar = (await fetchAviationWeather("metar", {
        ids: departure,
        format: "raw",
      })) as string;

      const depTaf = (await fetchAviationWeather("taf", {
        ids: departure,
        format: "raw",
      })) as string;

      const destMetar = (await fetchAviationWeather("metar", {
        ids: destination,
        format: "raw",
      })) as string;

      const destTaf = (await fetchAviationWeather("taf", {
        ids: destination,
        format: "raw",
      })) as string;

      // Calculate approximate route distance and midpoint
      const depLat = depAirportData[0].lat ?? 0;
      const depLon = depAirportData[0].lon ?? 0;
      const destLat = destAirportData[0].lat ?? 0;
      const destLon = destAirportData[0].lon ?? 0;

      // Calculate midpoint for en-route information
      const midLat = (depLat + destLat) / 2;
      const midLon = (depLon + destLon) / 2;

      // Simplified distance calculation (nautical miles)
      const distance = Math.sqrt(
        ((destLat - depLat) * 60) ** 2 +
          ((destLon - depLon) *
            (Math.cos((((depLat + destLat) / 2) * Math.PI) / 180) * 60)) **
            2,
      );

      // Get en-route PIREPs (using midpoint and half the distance)
      const searchRadius = Math.max(50, distance / 3); // At least 50nm, or 1/3 of route
      const enroutePireps = (await fetchAviationWeather("pirep", {
        id: `${midLat},${midLon}`,
        format: "raw",
        distance: searchRadius,
      })) as string;

      // Compile the weather briefing
      const weatherBriefing = `
ROUTE WEATHER BRIEFING: ${departure} to ${destination}
Approximate Distance: ${Math.round(distance)} nm

DEPARTURE (${departure}):
${depAirportData[0].name || departure}
METAR: ${depMetar.trim() || "Not available"}

TAF: ${depTaf.trim() || "Not available"}

DESTINATION (${destination}):
${destAirportData[0].name || destination}
METAR: ${destMetar.trim() || "Not available"}

TAF: ${destTaf.trim() || "Not available"}

EN-ROUTE PIREPS (within ${Math.round(searchRadius)}nm of route midpoint):
${enroutePireps.trim() || "No PIREPs found en-route"}
`;

      return {
        content: [
          {
            type: "text",
            text: weatherBriefing,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting route weather: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool: Get adverse conditions (SIGMETs)
server.tool(
  "get-sigmets",
  {
    region: z
      .enum(["us", "international"])
      .optional()
      .describe("Region ('us' or 'international', default: 'us')"),
    hazard: z
      .enum(["conv", "turb", "ice", "ifr"])
      .optional()
      .describe("Filter by hazard type (convective, turbulence, icing, IFR)"),
  },
  async ({ region = "us", hazard }) => {
    try {
      const endpoint = region === "international" ? "isigmet" : "airsigmet";
      const params: Record<string, string | number | boolean | undefined> = {
        format: "raw",
      };

      if (hazard) {
        params.hazard = hazard;
      }

      const sigmetData = (await fetchAviationWeather(
        endpoint,
        params,
      )) as string;

      return {
        content: [
          {
            type: "text",
            text:
              sigmetData.trim() ||
              "No SIGMETs found for the specified criteria",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching SIGMETs: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Define GAirmet type
interface GAirmet {
  type?: string;
  hazard?: string;
  validTime?: string;
  area?: string;
}

// Tool: Get G-AIRMETs (Graphical AIRMETs)
server.tool(
  "get-gairmets",
  {
    type: z
      .enum(["sierra", "tango", "zulu"])
      .optional()
      .describe(
        "G-AIRMET type (sierra: IFR/Mountain obscuration, tango: Turbulence, zulu: Icing)",
      ),
    hazard: z
      .enum([
        "turb-hi",
        "turb-lo",
        "llws",
        "sfc_wind",
        "ifr",
        "mtn_obs",
        "ice",
        "fzlvl",
      ])
      .optional()
      .describe(
        "Specific hazard (turbulence high/low, low-level wind shear, surface winds, IFR, mountain obscuration, icing, freezing level)",
      ),
  },
  async ({ type, hazard }) => {
    try {
      const params: Record<string, string | number | boolean | undefined> = {
        format: "decoded",
      };

      if (type) {
        params.type = type;
      }

      if (hazard) {
        params.hazard = hazard;
      }

      const gairmetData = await fetchAviationWeather("gairmet", params);

      if (typeof gairmetData === "string") {
        return {
          content: [
            {
              type: "text",
              text:
                gairmetData.trim() ||
                "No G-AIRMETs found for the specified criteria",
            },
          ],
        };
      }
      // Format JSON response into readable text
      let formattedData = "G-AIRMET Summary:\n\n";

      if (Array.isArray(gairmetData)) {
        const gairmets = gairmetData as GAirmet[];
        gairmets.forEach((item, index) => {
          formattedData += `G-AIRMET #${index + 1}:\n`;
          formattedData += `Type: ${item.type || "Not specified"}\n`;
          formattedData += `Hazard: ${item.hazard || "Not specified"}\n`;
          formattedData += `Valid: ${item.validTime || "Not specified"}\n`;
          formattedData += `Area: ${item.area || "Not specified"}\n\n`;
        });
      } else {
        formattedData += JSON.stringify(gairmetData, null, 2);
      }

      return {
        content: [
          {
            type: "text",
            text:
              formattedData || "No G-AIRMETs found for the specified criteria",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching G-AIRMETs: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Tool: Get airport information
server.tool(
  "get-airport-info",
  {
    airport: z.string().describe("Airport ICAO code (e.g., KJFK)"),
  },
  async ({ airport }) => {
    try {
      const airportData = (await fetchAviationWeather("airport", {
        ids: airport,
        format: "json",
      })) as AirportData[];

      if (!airportData || !airportData[0]) {
        return {
          content: [
            {
              type: "text",
              text: `Could not find airport: ${airport}`,
            },
          ],
          isError: true,
        };
      }

      const data = airportData[0];
      const info = `
AIRPORT INFORMATION for ${airport}

Name: ${data.name || "Not available"}
City: ${data.city || "Not available"}
State: ${data.state || "Not available"}
Country: ${data.country || "Not available"}

Location: ${data.lat?.toFixed(4) || "?"}, ${data.lon?.toFixed(4) || "?"}
Elevation: ${data.elevation !== undefined ? `${data.elevation} ft` : "Not available"}

Runways: ${data.runways ? formatRunways(data.runways) : "Not available"}

`;

      return {
        content: [
          {
            type: "text",
            text: info,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching airport information: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Helper function to format runway information
function formatRunways(runways: Array<string | RunwayData>): string {
  if (!Array.isArray(runways) || runways.length === 0) {
    return "None listed";
  }

  return runways
    .map((runway) => {
      if (typeof runway === "string") {
        return runway;
      }
      if (typeof runway === "object") {
        const length = runway.length ? `${runway.length} ft` : "";
        const width = runway.width ? `${runway.width} ft` : "";
        const surface = runway.surface || "";

        let dimensions = "";
        if (length || width) {
          dimensions = `(${[length, width].filter(Boolean).join(" x ")})`;
        }

        return `${runway.id || ""} ${dimensions} ${surface}`.trim();
      }
      return "Unknown runway format";
    })
    .join("\n  - ");
}

// Start the server
async function main() {
  console.error("Starting Aviation Weather MCP Server...");

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Server connected and running");
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main();
