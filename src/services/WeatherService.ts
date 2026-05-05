/**
 * Weather Service - Weather-based Intent Signals
 * Fetches weather data and maps conditions to intent modifiers
 * Supports OpenWeatherMap API with Redis caching (30 minutes TTL)
 */

import { sharedMemory } from '../agents/shared-memory.js';
import type {
  WeatherData,
  WeatherCondition,
  WeatherIntentModifiers,
  WeatherSignal,
  OpenWeatherResponse,
  WeatherConfig,
} from '../types/weather.js';

// ── Logger ───────────────────────────────────────────────────────────────────

const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[WeatherService] ${msg}`, meta || ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[WeatherService] ${msg}`, meta || ''),
  error: (msg: string, meta?: unknown) => console.error(`[WeatherService] ${msg}`, meta || ''),
};

// ── Cache Keys ────────────────────────────────────────────────────────────────

const WEATHER_KEY_PREFIX = 'weather:location:';
const WEATHER_TTL_SECONDS = 1800; // 30 minutes

// ── Default Configuration ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: WeatherConfig = {
  apiKey: process.env.WEATHER_API_KEY || '',
  baseUrl: 'https://api.openweathermap.org/data/2.5/weather',
  cacheTtlSeconds: WEATHER_TTL_SECONDS,
  temperatureThresholds: {
    cold: 10,       // Below 10°C is cold
    hot: 30,        // Above 30°C is hot
    comfortable: 25, // Comfortable temperature range
  },
};

// ── Condition Mapping ─────────────────────────────────────────────────────────

const WEATHER_CODE_TO_CONDITION: Record<number, WeatherCondition> = {
  // Thunderstorm
  200: 'stormy',
  201: 'stormy',
  202: 'stormy',
  210: 'stormy',
  211: 'stormy',
  212: 'stormy',
  221: 'stormy',
  230: 'stormy',
  231: 'stormy',
  232: 'stormy',

  // Drizzle
  300: 'rainy',
  301: 'rainy',
  302: 'rainy',
  310: 'rainy',
  311: 'rainy',
  312: 'rainy',
  313: 'rainy',
  314: 'rainy',
  321: 'rainy',

  // Rain
  500: 'rain',
  501: 'rain',
  502: 'heavy_rain',
  503: 'heavy_rain',
  504: 'heavy_rain',
  511: 'rain', // Freezing rain
  520: 'heavy_rain',
  521: 'heavy_rain',
  522: 'heavy_rain',
  531: 'heavy_rain',

  // Snow
  600: 'snow',
  601: 'snow',
  602: 'snow',
  611: 'snow', // Sleet
  612: 'snow',
  613: 'snow',
  615: 'snow',
  616: 'snow',
  620: 'snow',
  621: 'snow',
  622: 'snow',

  // Atmosphere (fog, mist, etc.)
  701: 'foggy',
  711: 'foggy',
  721: 'foggy',
  731: 'windy', // Dust
  741: 'foggy', // Fog
  751: 'windy', // Sand
  761: 'windy', // Dust
  762: 'unknown', // Ash (volcanic)
  771: 'windy', // Squall
  781: 'stormy', // Tornado

  // Clear
  800: 'clear',

  // Clouds
  801: 'sunny',
  802: 'cloudy',
  803: 'overcast',
  804: 'overcast',
};

// ── Default Modifiers ─────────────────────────────────────────────────────────

const DEFAULT_WEATHER_MODIFIERS: Record<WeatherCondition, WeatherIntentModifiers> = {
  clear: {
    deliveryBoost: 0.0,
    diningBoost: 0.15,
    travelBoost: 0.2,
    outdoorBoost: 0.25,
    indoorBoost: 0.0,
    impulseBoost: 0.1,
  },
  sunny: {
    deliveryBoost: 0.0,
    diningBoost: 0.15,
    travelBoost: 0.2,
    outdoorBoost: 0.3,
    indoorBoost: 0.0,
    impulseBoost: 0.15,
  },
  cloudy: {
    deliveryBoost: 0.05,
    diningBoost: 0.05,
    travelBoost: 0.1,
    outdoorBoost: 0.1,
    indoorBoost: 0.05,
    impulseBoost: 0.05,
  },
  overcast: {
    deliveryBoost: 0.1,
    diningBoost: 0.0,
    travelBoost: 0.0,
    outdoorBoost: 0.0,
    indoorBoost: 0.1,
    impulseBoost: 0.0,
  },
  rainy: {
    deliveryBoost: 0.25,
    diningBoost: -0.1,
    travelBoost: -0.15,
    outdoorBoost: -0.2,
    indoorBoost: 0.15,
    impulseBoost: 0.1,
  },
  rain: {
    deliveryBoost: 0.25,
    diningBoost: -0.1,
    travelBoost: -0.15,
    outdoorBoost: -0.2,
    indoorBoost: 0.15,
    impulseBoost: 0.1,
  },
  heavy_rain: {
    deliveryBoost: 0.35,
    diningBoost: -0.2,
    travelBoost: -0.25,
    outdoorBoost: -0.3,
    indoorBoost: 0.25,
    impulseBoost: 0.15,
  },
  stormy: {
    deliveryBoost: 0.4,
    diningBoost: -0.25,
    travelBoost: -0.3,
    outdoorBoost: -0.35,
    indoorBoost: 0.3,
    impulseBoost: 0.2,
  },
  snow: {
    deliveryBoost: 0.35,
    diningBoost: -0.1,
    travelBoost: -0.25,
    outdoorBoost: -0.3,
    indoorBoost: 0.2,
    impulseBoost: 0.15,
  },
  cold: {
    deliveryBoost: 0.2,
    diningBoost: 0.1,
    travelBoost: 0.0,
    outdoorBoost: -0.15,
    indoorBoost: 0.15,
    impulseBoost: 0.1,
  },
  hot: {
    deliveryBoost: 0.15,
    diningBoost: 0.2,
    travelBoost: -0.1,
    outdoorBoost: 0.1,
    indoorBoost: 0.15,
    impulseBoost: 0.15,
  },
  windy: {
    deliveryBoost: 0.1,
    diningBoost: -0.05,
    travelBoost: -0.1,
    outdoorBoost: -0.1,
    indoorBoost: 0.1,
    impulseBoost: 0.05,
  },
  foggy: {
    deliveryBoost: 0.1,
    diningBoost: 0.0,
    travelBoost: -0.1,
    outdoorBoost: -0.05,
    indoorBoost: 0.1,
    impulseBoost: 0.0,
  },
  unknown: {
    deliveryBoost: 0.0,
    diningBoost: 0.0,
    travelBoost: 0.0,
    outdoorBoost: 0.0,
    indoorBoost: 0.0,
    impulseBoost: 0.0,
  },
};

// ── Category Mapping ─────────────────────────────────────────────────────────

const CATEGORY_WEATHER_BOOST: Record<string, keyof WeatherIntentModifiers> = {
  // Delivery categories
  delivery: 'deliveryBoost',
  food_delivery: 'deliveryBoost',
  grocery: 'deliveryBoost',
  pharmacy: 'deliveryBoost',

  // Dining categories
  dining: 'diningBoost',
  restaurant: 'diningBoost',
  cafe: 'diningBoost',
  bar: 'diningBoost',
  food: 'diningBoost',

  // Travel categories
  travel: 'travelBoost',
  hotel: 'travelBoost',
  flight: 'travelBoost',
  taxi: 'travelBoost',
  ride: 'travelBoost',

  // Outdoor categories
  outdoor: 'outdoorBoost',
  activity: 'outdoorBoost',
  park: 'outdoorBoost',
  beach: 'outdoorBoost',

  // Indoor categories
  indoor: 'indoorBoost',
  entertainment: 'indoorBoost',
  movie: 'indoorBoost',
  shopping: 'indoorBoost',

  // Impulse categories
  retail: 'impulseBoost',
  fashion: 'impulseBoost',
  electronics: 'impulseBoost',
};

/**
 * Weather Service
 * Fetches weather data and calculates intent modifiers for personalization
 */
export class WeatherService {
  private config: WeatherConfig;

  constructor(config: Partial<WeatherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get weather data for a location (with caching)
   */
  async getWeatherByCoordinates(lat: number, lon: number): Promise<WeatherData | null> {
    const cacheKey = this.getCacheKey(lat, lon);

    // Try cache first
    const cached = await this.getCachedWeather(cacheKey);
    if (cached) {
      logger.info('Weather cache hit', { lat, lon });
      return cached;
    }

    // Fetch from API
    try {
      const weather = await this.fetchWeatherFromApi(lat, lon);
      if (weather) {
        await this.cacheWeather(cacheKey, weather);
      }
      return weather;
    } catch (error) {
      logger.error('Failed to fetch weather', { lat, lon, error });
      return null;
    }
  }

  /**
   * Get weather data by city name
   */
  async getWeatherByCity(city: string, countryCode?: string): Promise<WeatherData | null> {
    const cacheKey = this.getCacheKey(city, countryCode || '');

    // Try cache first
    const cached = await this.getCachedWeather(cacheKey);
    if (cached) {
      logger.info('Weather cache hit', { city });
      return cached;
    }

    // Fetch from API
    try {
      const weather = await this.fetchWeatherByCity(city, countryCode);
      if (weather) {
        await this.cacheWeather(cacheKey, weather);
      }
      return weather;
    } catch (error) {
      logger.error('Failed to fetch weather for city', { city, error });
      return null;
    }
  }

  /**
   * Get weather signal for a user at a location
   */
  async getWeatherSignal(
    userId: string,
    lat: number,
    lon: number
  ): Promise<WeatherSignal | null> {
    const weather = await this.getWeatherByCoordinates(lat, lon);
    if (!weather) return null;

    const modifiers = this.getIntentModifiers(weather);
    const expiresAt = new Date(Date.now() + WEATHER_TTL_SECONDS * 1000);

    return {
      userId,
      weather,
      modifiers,
      capturedAt: new Date(),
      expiresAt,
    };
  }

  /**
   * Get weather signal by city name
   */
  async getWeatherSignalByCity(
    userId: string,
    city: string,
    countryCode?: string
  ): Promise<WeatherSignal | null> {
    const weather = await this.getWeatherByCity(city, countryCode);
    if (!weather) return null;

    const modifiers = this.getIntentModifiers(weather);
    const expiresAt = new Date(Date.now() + WEATHER_TTL_SECONDS * 1000);

    return {
      userId,
      weather,
      modifiers,
      capturedAt: new Date(),
      expiresAt,
    };
  }

  /**
   * Get weather modifier for a specific category
   */
  getCategoryModifier(
    modifiers: WeatherIntentModifiers,
    category: string
  ): number {
    const boostKey = CATEGORY_WEATHER_BOOST[category.toLowerCase()];
    if (!boostKey) return 0;
    return modifiers[boostKey] || 0;
  }

  /**
   * Get weather-based boost for ranking calculations
   */
  getWeatherBoost(
    condition: WeatherCondition,
    category: string
  ): number {
    const modifiers = DEFAULT_WEATHER_MODIFIERS[condition];
    return this.getCategoryModifier(modifiers, category);
  }

  /**
   * Map weather data to intent modifiers
   */
  private getIntentModifiers(weather: WeatherData): WeatherIntentModifiers {
    const { condition, temperature } = weather;

    // Start with base modifiers for condition
    let modifiers = { ...DEFAULT_WEATHER_MODIFIERS[condition] };

    // Adjust based on temperature
    if (temperature.current < this.config.temperatureThresholds.cold) {
      // Cold weather adjustments
      modifiers.deliveryBoost = Math.max(modifiers.deliveryBoost, 0.2);
      modifiers.indoorBoost = Math.max(modifiers.indoorBoost, 0.15);
      modifiers.outdoorBoost = Math.min(modifiers.outdoorBoost, -0.15);
    } else if (temperature.current > this.config.temperatureThresholds.hot) {
      // Hot weather adjustments
      modifiers.deliveryBoost = Math.max(modifiers.deliveryBoost, 0.15);
      modifiers.diningBoost = Math.max(modifiers.diningBoost, 0.2);
      modifiers.travelBoost = Math.min(modifiers.travelBoost, -0.1);
    }

    // Wind adjustments
    if (weather.windSpeed > 30) {
      modifiers.outdoorBoost = Math.min(modifiers.outdoorBoost, -0.1);
      modifiers.indoorBoost = Math.max(modifiers.indoorBoost, 0.1);
    }

    return modifiers;
  }

  /**
   * Map OpenWeatherMap weather code to condition
   */
  private mapWeatherCode(code: number): WeatherCondition {
    return WEATHER_CODE_TO_CONDITION[code] || 'unknown';
  }

  /**
   * Map OpenWeatherMap response to WeatherData
   */
  private mapApiResponse(
    response: OpenWeatherResponse,
    lat: number,
    lon: number
  ): WeatherData {
    const weatherCode = response.weather[0]?.id || 800;
    const condition = this.mapWeatherCode(weatherCode);
    const temp = response.main.temp - 273.15; // Kelvin to Celsius
    const feelsLike = response.main.feels_like - 273.15;

    return {
      location: {
        lat,
        lon,
        city: response.name,
        country: response.sys.country,
      },
      condition,
      temperature: {
        current: Math.round(temp * 10) / 10,
        feelsLike: Math.round(feelsLike * 10) / 10,
        min: Math.round((response.main.temp_min - 273.15) * 10) / 10,
        max: Math.round((response.main.temp_max - 273.15) * 10) / 10,
      },
      humidity: response.main.humidity,
      windSpeed: response.wind.speed * 3.6, // m/s to km/h
      description: response.weather[0]?.description || 'Unknown',
      icon: response.weather[0]?.icon,
      timestamp: new Date(),
      source: 'api',
    };
  }

  /**
   * Fetch weather from OpenWeatherMap API
   */
  private async fetchWeatherFromApi(lat: number, lon: number): Promise<WeatherData | null> {
    if (!this.config.apiKey) {
      logger.warn('WEATHER_API_KEY not configured, using mock data');
      return this.getMockWeatherData(lat, lon);
    }

    const url = `${this.config.baseUrl}?lat=${lat}&lon=${lon}&appid=${this.config.apiKey}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const data = (await response.json()) as OpenWeatherResponse;
      return this.mapApiResponse(data, lat, lon);
    } catch (error) {
      logger.error('API fetch failed', { error });
      return this.getMockWeatherData(lat, lon);
    }
  }

  /**
   * Fetch weather by city name
   */
  private async fetchWeatherByCity(
    city: string,
    countryCode?: string
  ): Promise<WeatherData | null> {
    if (!this.config.apiKey) {
      logger.warn('WEATHER_API_KEY not configured, using mock data');
      return this.getMockWeatherData(0, 0, city);
    }

    const query = countryCode ? `${city},${countryCode}` : city;
    const url = `${this.config.baseUrl}?q=${encodeURIComponent(query)}&appid=${this.config.apiKey}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const data = (await response.json()) as OpenWeatherResponse;
      return this.mapApiResponse(data, data.coord?.lat || 0, data.coord?.lon || 0);
    } catch (error) {
      logger.error('City weather fetch failed', { error });
      return this.getMockWeatherData(0, 0, city);
    }
  }

  /**
   * Get cache key for location (coordinates or city name)
   */
  private getCacheKey(lat: number | string, lon: number | string): string {
    if (typeof lat === 'string' || typeof lon === 'string') {
      // City-based cache key
      const latStr = typeof lat === 'string' ? lat : String(lat);
      const lonStr = typeof lon === 'string' ? lon : String(lon);
      return `${WEATHER_KEY_PREFIX}city:${encodeURIComponent(latStr)}:${encodeURIComponent(lonStr)}`;
    }
    // Round to 2 decimal places for cache efficiency
    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLon = Math.round(lon * 100) / 100;
    return `${WEATHER_KEY_PREFIX}${roundedLat}:${roundedLon}`;
  }

  /**
   * Get cached weather data
   */
  private async getCachedWeather(key: string): Promise<WeatherData | null> {
    try {
      const cached = await sharedMemory.get<WeatherData>(key);
      return cached;
    } catch (error) {
      logger.warn('Cache read failed', { error });
      return null;
    }
  }

  /**
   * Cache weather data
   */
  private async cacheWeather(key: string, weather: WeatherData): Promise<void> {
    try {
      weather.source = 'cache';
      await sharedMemory.set(key, weather, WEATHER_TTL_SECONDS);
      logger.info('Weather cached', { key, ttl: WEATHER_TTL_SECONDS });
    } catch (error) {
      logger.warn('Cache write failed', { error });
    }
  }

  /**
   * Generate mock weather data for testing without API key
   */
  private getMockWeatherData(lat: number, lon: number, city?: string): WeatherData {
    // Use hour of day to determine condition for realistic mock
    const hour = new Date().getHours();
    let condition: WeatherCondition = 'clear';

    if (hour >= 6 && hour < 12) {
      condition = 'sunny';
    } else if (hour >= 12 && hour < 18) {
      condition = 'cloudy';
    } else if (hour >= 18 && hour < 22) {
      condition = 'clear';
    } else {
      condition = 'overcast';
    }

    return {
      location: {
        lat,
        lon,
        city: city || 'Unknown',
      },
      condition,
      temperature: {
        current: 22,
        feelsLike: 23,
        min: 18,
        max: 28,
      },
      humidity: 65,
      windSpeed: 12,
      description: condition === 'sunny' ? 'Clear sky' : `${condition} weather`,
      icon: '01d',
      timestamp: new Date(),
      source: 'api',
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WeatherConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<{
    apiKeyConfigured: boolean;
    cacheTtl: number;
    redisAvailable: boolean;
  }> {
    return {
      apiKeyConfigured: !!this.config.apiKey,
      cacheTtl: this.config.cacheTtlSeconds,
      redisAvailable: sharedMemory.isRedisAvailable(),
    };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const weatherService = new WeatherService();
