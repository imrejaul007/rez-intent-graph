/**
 * Weather Types - Weather-based Intent Signals
 * Core type definitions for weather service and intent integration
 */

// ── Weather Conditions ─────────────────────────────────────────────────────────

export type WeatherCondition =
  | 'clear'
  | 'sunny'
  | 'cloudy'
  | 'overcast'
  | 'rainy'
  | 'rain'
  | 'heavy_rain'
  | 'stormy'
  | 'snow'
  | 'cold'
  | 'hot'
  | 'windy'
  | 'foggy'
  | 'unknown';

// ── Weather Data ─────────────────────────────────────────────────────────────

export interface WeatherData {
  location: {
    lat: number;
    lon: number;
    city?: string;
    country?: string;
  };
  condition: WeatherCondition;
  temperature: {
    current: number; // Celsius
    feelsLike: number;
    min?: number;
    max?: number;
  };
  humidity: number;
  windSpeed: number; // km/h
  description: string;
  icon?: string;
  timestamp: Date;
  source: 'api' | 'cache';
}

// ── Intent Modifiers ─────────────────────────────────────────────────────────

export interface WeatherIntentModifiers {
  deliveryBoost: number;      // Boost for delivery-related intents
  diningBoost: number;        // Boost for dining/restaurant intents
  travelBoost: number;        // Boost for travel intents
  outdoorBoost: number;       // Boost for outdoor activities
  indoorBoost: number;         // Boost for indoor activities
  impulseBoost: number;       // Boost for impulse-driven categories
}

// ── Weather Signal ───────────────────────────────────────────────────────────

export interface WeatherSignal {
  userId: string;
  weather: WeatherData;
  modifiers: WeatherIntentModifiers;
  capturedAt: Date;
  expiresAt: Date;
}

// ── Scored Intent with Weather ───────────────────────────────────────────────

export interface WeatherEnrichedIntent {
  intentId: string;
  userId: string;
  intentKey: string;
  category: string;
  baseConfidence: number;
  weatherModifier: number;
  finalConfidence: number;
  weatherBoostReason: string;
}

// ── Weather API Response ─────────────────────────────────────────────────────

export interface OpenWeatherResponse {
  weather: Array<{
    id: number;
    main: string;
    description: string;
    icon: string;
  }>;
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    humidity: number;
  };
  wind: {
    speed: number;
  };
  coord?: {
    lat: number;
    lon: number;
  };
  name: string;
  sys: {
    country: string;
  };
  cod: number;
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface WeatherConfig {
  apiKey: string;
  baseUrl: string;
  cacheTtlSeconds: number;
  temperatureThresholds: {
    cold: number;      // Below this temp is considered cold
    hot: number;       // Above this temp is considered hot
    comfortable: number; // Comfortable temperature range
  };
}

// ── Default Intent Modifiers by Condition ───────────────────────────────────

export const DEFAULT_WEATHER_MODIFIERS: Record<WeatherCondition, WeatherIntentModifiers> = {
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
  rainy:
  {
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

export const CATEGORY_WEATHER_BOOST: Record<string, keyof WeatherIntentModifiers> = {
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
